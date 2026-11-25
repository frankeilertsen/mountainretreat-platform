import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appUrl } from '../notify';
import { decrypt, encrypt } from '../crypto';
import { getPool, one } from '../db';

/**
 * Vipps MobilePay ePayment API (direct merchant agreement).
 * Flow: create payment (WEB_REDIRECT) → customer approves in the Vipps app → AUTHORIZED → we capture at once
 * (the stay is booked and the dates are held) → booking confirmed. Status comes from webhooks, the return page
 * and a background check, all verified against the API, so a lost webhook never leaves a booking hanging.
 *
 * Environment: VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN, VIPPS_ENV ('test' | 'production').
 * The webhook secret is returned by Vipps when the webhook is registered (admin → Innstillinger) and stored encrypted.
 */
export const vippsConfigured = () =>
  !!(process.env.VIPPS_CLIENT_ID && process.env.VIPPS_CLIENT_SECRET && process.env.VIPPS_SUBSCRIPTION_KEY && process.env.VIPPS_MSN);
export const vippsEnv = () => (process.env.VIPPS_ENV === 'production' ? 'production' : 'test');
const base = () => process.env.VIPPS_BASE_URL || (vippsEnv() === 'production' ? 'https://api.vipps.no' : 'https://apitest.vipps.no');

const SYSTEM_HEADERS = { 'Vipps-System-Name': 'mountainretreat', 'Vipps-System-Version': '1.0.0', 'Vipps-System-Plugin-Name': 'retreat-club', 'Vipps-System-Plugin-Version': '1.0.0' };

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const r = await fetch(`${base()}/accesstoken/get`, {
    method: 'POST',
    headers: {
      client_id: process.env.VIPPS_CLIENT_ID!, client_secret: process.env.VIPPS_CLIENT_SECRET!,
      'Ocp-Apim-Subscription-Key': process.env.VIPPS_SUBSCRIPTION_KEY!, 'Merchant-Serial-Number': process.env.VIPPS_MSN!, ...SYSTEM_HEADERS,
    },
  });
  if (!r.ok) throw new Error(`Vipps access token failed (${r.status})`);
  const j = await r.json() as { access_token: string; expires_in: string | number };
  token = { value: j.access_token, until: Date.now() + Number(j.expires_in) * 1000 };
  return token.value;
}

async function api<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`, 'Ocp-Apim-Subscription-Key': process.env.VIPPS_SUBSCRIPTION_KEY!,
      'Merchant-Serial-Number': process.env.VIPPS_MSN!, 'Content-Type': 'application/json', ...SYSTEM_HEADERS,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Vipps ${method} ${path} failed (${r.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const nok = (ore: number) => ({ currency: 'NOK', value: ore });
/** Our reference for a payment: letters, digits and hyphens, unique per sales unit. */
export const vippsReference = (paymentId: string) => `mr-${paymentId}`;

export type VippsPayment = {
  state: 'CREATED' | 'AUTHORIZED' | 'ABORTED' | 'EXPIRED' | 'TERMINATED';
  aggregate: { authorizedAmount: { value: number }; capturedAmount: { value: number }; refundedAmount: { value: number }; cancelledAmount: { value: number } };
};

export async function createVippsPayment(r: { paymentId: string; amountOre: number; description: string; idempotencyKey: string }) {
  const reference = vippsReference(r.paymentId);
  const res = await api<{ redirectUrl: string; reference: string }>('POST', '/epayment/v1/payments', {
    amount: nok(r.amountOre),
    paymentMethod: { type: 'WALLET' },
    reference,
    returnUrl: appUrl(`/betaling/vipps/retur?ref=${encodeURIComponent(reference)}`),
    userFlow: 'WEB_REDIRECT',
    paymentDescription: r.description.slice(0, 100),
  }, r.idempotencyKey);
  return { providerReference: reference, checkoutUrl: res.redirectUrl };
}

export const getVippsPayment = (reference: string) => api<VippsPayment>('GET', `/epayment/v1/payments/${encodeURIComponent(reference)}`);
export const captureVipps = (reference: string, amountOre: number, idem: string) =>
  api('POST', `/epayment/v1/payments/${encodeURIComponent(reference)}/capture`, { modificationAmount: nok(amountOre) }, idem);
export const refundVipps = (reference: string, amountOre: number, idem: string) =>
  api<{ pspReference?: string }>('POST', `/epayment/v1/payments/${encodeURIComponent(reference)}/refund`, { modificationAmount: nok(amountOre) }, idem);
export const cancelVipps = (reference: string, idem: string) =>
  api('POST', `/epayment/v1/payments/${encodeURIComponent(reference)}/cancel`, {}, idem);

// ------------------------------------------------------------------ webhooks

export const VIPPS_EVENTS = [
  'epayments.payment.authorized.v1', 'epayments.payment.captured.v1', 'epayments.payment.aborted.v1',
  'epayments.payment.expired.v1', 'epayments.payment.terminated.v1', 'epayments.payment.cancelled.v1', 'epayments.payment.refunded.v1',
];
const SETTING = 'vipps_webhook';

/** Register (or re-register) our webhook with Vipps and keep the secret encrypted in the settings. */
export async function registerVippsWebhook(): Promise<{ id: string; url: string }> {
  const url = appUrl('/api/webhooks/vipps');
  const existing = await api<{ webhooks: { id: string; url: string }[] }>('GET', '/webhooks/v1/webhooks');
  for (const w of existing.webhooks ?? []) if (w.url === url) await api('DELETE', `/webhooks/v1/webhooks/${w.id}`);
  const res = await api<{ id: string; secret: string }>('POST', '/webhooks/v1/webhooks', { url, events: VIPPS_EVENTS });
  const value = JSON.stringify({ id: res.id, url, env: vippsEnv(), secret: encrypt(res.secret), registered_at: new Date().toISOString() });
  await getPool().query(`INSERT INTO platform_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [SETTING, value]);
  return { id: res.id, url };
}

export async function vippsWebhookInfo(): Promise<{ id: string; url: string; env: string; registered_at: string; secret: string } | null> {
  const r = await one<{ v: string }>(`SELECT value AS v FROM platform_settings WHERE key=$1`, [SETTING]);
  if (!r?.v) return null;
  try { const j = JSON.parse(r.v); return { ...j, secret: decrypt(j.secret) }; } catch { return null; }
}

/**
 * Verify a webhook from Vipps: SHA-256 of the raw body must match x-ms-content-sha256, and
 * HMAC-SHA256("POST\n<path?query>\n<x-ms-date>;<host>;<content hash>", secret) must match the Authorization header.
 */
export function verifyVippsSignature(p: { secret: string; method: string; pathAndQuery: string; hosts: string[]; headers: Headers; rawBody: string }): boolean {
  const date = p.headers.get('x-ms-date'), hash = p.headers.get('x-ms-content-sha256'), auth = p.headers.get('authorization');
  if (!date || !hash || !auth) return false;
  if (!eq(createHash('sha256').update(p.rawBody).digest('base64'), hash)) return false;
  return p.hosts.some(host => {
    const sig = createHmac('sha256', p.secret).update(`${p.method.toUpperCase()}\n${p.pathAndQuery}\n${date};${host};${hash}`).digest('base64');
    return eq(`HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`, auth);
  });
}
function eq(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

// ------------------------------------------------------------------ processing (shared by webhook, return page and job)

/**
 * Bring our payment in line with Vipps. Idempotent – safe to call from the webhook, the return page and the
 * background check at the same time. AUTHORIZED → capture the full amount → confirm the booking.
 */
export async function syncVippsPayment(reference: string): Promise<'confirmed' | 'pending' | 'failed' | 'unknown'> {
  const p = await one<{ id: string; status: string; amount_ore: number }>(
    `SELECT id, status, amount_ore FROM payments WHERE provider='vipps' AND provider_reference=$1`, [reference]);
  if (!p) return 'unknown';
  if (p.status === 'succeeded') return 'confirmed';
  if (p.status !== 'pending') return 'failed';
  const v = await getVippsPayment(reference);
  const { handlePaymentSucceeded, handlePaymentFailed } = await import('../domain/bookings');
  if (v.state === 'AUTHORIZED') {
    const captured = v.aggregate?.capturedAmount?.value ?? 0;
    if (captured < p.amount_ore) await captureVipps(reference, p.amount_ore - captured, `cap_${p.id}`);
    await handlePaymentSucceeded(p.id);
    return 'confirmed';
  }
  if (v.state === 'ABORTED' || v.state === 'EXPIRED' || v.state === 'TERMINATED') { await handlePaymentFailed(p.id); return 'failed'; }
  return 'pending';
}

/** Background safety net: check open Vipps payments (in case a webhook was lost). */
export async function checkOpenVippsPayments(): Promise<number> {
  if (!vippsConfigured()) return 0;
  const rows = await (await import('../db')).q<{ ref: string }>(
    `SELECT provider_reference AS ref FROM payments WHERE provider='vipps' AND status='pending' AND provider_reference IS NOT NULL
       AND created_at < now() - interval '1 minute' AND created_at > now() - interval '3 days' LIMIT 50`);
  let n = 0;
  for (const r of rows) { try { if ((await syncVippsPayment(r.ref)) !== 'pending') n++; } catch (e) { console.error('[vipps] check', r.ref, (e as Error).message); } }
  return n;
}
