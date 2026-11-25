import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { createHash, createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { user, property, d } from './factory';
import { getPool, one } from '../lib/db';
import { approveBooking, requestBooking, startPayment } from '../lib/domain/bookings';
import { registerVippsWebhook, syncVippsPayment, verifyVippsSignature, checkOpenVippsPayments } from '../lib/payments/vipps';
import { vippsProvider } from '../lib/domain/payments';

/** A stand-in for the Vipps MobilePay API (access token, ePayment, Webhooks), so the integration is tested offline. */
const payments = new Map<string, { amount: number; state: string; captured: number; refunded: number }>();
const calls: { method: string; path: string; idem?: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
let server: http.Server;
const env = { ...process.env };
const SECRET = 'whsec-test-123';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const path = req.url!;
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      calls.push({ method: req.method!, path, idem: req.headers['idempotency-key'] as string, headers: req.headers, body });
      const json = (code: number, o: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (path === '/accesstoken/get') return req.headers.client_secret === 'sec' ? json(200, { access_token: 'tok', expires_in: '3600' }) : json(401, {});
      if (req.headers.authorization !== 'Bearer tok' || req.headers['ocp-apim-subscription-key'] !== 'sub' || req.headers['merchant-serial-number'] !== '123456') return json(401, {});
      let m: RegExpMatchArray | null;
      if (path === '/epayment/v1/payments' && req.method === 'POST') {
        if (!req.headers['idempotency-key']) return json(400, {});
        payments.set(body.reference, { amount: body.amount.value, state: 'CREATED', captured: 0, refunded: 0 });
        return json(201, { redirectUrl: `https://landing.vipps.test/?token=${body.reference}`, reference: body.reference });
      }
      if ((m = path.match(/^\/epayment\/v1\/payments\/([^/]+)$/))) {
        const p = payments.get(decodeURIComponent(m[1])); if (!p) return json(404, {});
        return json(200, { state: p.state, aggregate: { authorizedAmount: { value: p.state === 'AUTHORIZED' ? p.amount : 0 }, capturedAmount: { value: p.captured }, refundedAmount: { value: p.refunded }, cancelledAmount: { value: 0 } } });
      }
      if ((m = path.match(/^\/epayment\/v1\/payments\/([^/]+)\/(capture|refund)$/))) {
        const p = payments.get(decodeURIComponent(m[1])); if (!p) return json(404, {});
        if (m[2] === 'capture') { if (p.state !== 'AUTHORIZED') return json(400, {}); p.captured += body.modificationAmount.value; }
        else { if (body.modificationAmount.value > p.captured - p.refunded) return json(400, {}); p.refunded += body.modificationAmount.value; }
        return json(200, { pspReference: `psp-${m[2]}-${calls.length}` });
      }
      if (path === '/webhooks/v1/webhooks' && req.method === 'GET') return json(200, { webhooks: [] });
      if (path === '/webhooks/v1/webhooks' && req.method === 'POST') return json(201, { id: 'wh-1', secret: SECRET });
      json(404, {});
    });
  });
  await new Promise<void>(r => server.listen(0, r));
  Object.assign(process.env, {
    VIPPS_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, VIPPS_CLIENT_ID: 'cid', VIPPS_CLIENT_SECRET: 'sec',
    VIPPS_SUBSCRIPTION_KEY: 'sub', VIPPS_MSN: '123456', APP_URL: 'https://mountainretreat.no',
  });
  await getPool().query(`INSERT INTO payment_method_settings (method, enabled) VALUES ('vipps', true) ON CONFLICT (method) DO UPDATE SET enabled=true`);
});
afterAll(async () => { process.env = env; await new Promise(r => server.close(r)); });

async function payableBooking(start: number) {
  const admin = await user('admin');
  const pid = await property();
  const m = await user('member', { invite_tier: 'admin_invited' });
  const b = await requestBooking(m, { propertyId: pid, startDate: d(start), endDate: d(start + 3), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
  await approveBooking(b.id, { id: admin.id, type: 'admin' });
  return { b, m };
}

describe('Vipps MobilePay (ePayment API)', () => {
  it('pay with Vipps: redirect, approve in the app, capture, booking confirmed – once, however often we hear about it', async () => {
    const { b, m } = await payableBooking(40);
    const r = await startPayment(b.id, m, 'vipps');
    expect('checkoutUrl' in r && r.checkoutUrl).toMatch(/^https:\/\/landing\.vipps\.test\//);
    const p = (await one<{ id: string; provider_reference: string; amount_ore: number }>(`SELECT id, provider_reference, amount_ore FROM payments WHERE booking_id=$1 AND provider='vipps'`, [b.id]))!;
    const create = calls.find(c => c.path === '/epayment/v1/payments')!;
    expect(create.body).toMatchObject({ amount: { currency: 'NOK', value: p.amount_ore }, paymentMethod: { type: 'WALLET' }, userFlow: 'WEB_REDIRECT', reference: p.provider_reference });
    expect(create.body.returnUrl).toBe(`https://mountainretreat.no/betaling/vipps/retur?ref=${p.provider_reference}`);
    expect(create.idem!.length).toBeLessThanOrEqual(50);
    expect(p.provider_reference).toMatch(/^[a-zA-Z0-9-]{8,64}$/);

    // Not approved yet → still waiting
    expect(await syncVippsPayment(p.provider_reference)).toBe('pending');
    // Customer approves in the app
    payments.get(p.provider_reference)!.state = 'AUTHORIZED';
    expect(await syncVippsPayment(p.provider_reference)).toBe('confirmed');
    expect(await syncVippsPayment(p.provider_reference)).toBe('confirmed');
    expect(payments.get(p.provider_reference)!.captured).toBe(p.amount_ore);
    expect(calls.filter(c => c.path.endsWith('/capture') && c.path.includes(p.provider_reference)).length).toBe(1);
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id=$1`, [b.id]))!.status).toBe('confirmed');

    // Refund through the provider
    const rf = await vippsProvider.refund(p.provider_reference, 10000, 'rf-test-1');
    expect(rf.status).toBe('succeeded');
    expect(payments.get(p.provider_reference)!.refunded).toBe(10000);
  });

  it('a cancelled Vipps payment leaves the booking waiting for payment; the background check catches lost webhooks', async () => {
    const { b, m } = await payableBooking(50);
    await startPayment(b.id, m, 'vipps');
    const p = (await one<{ id: string; provider_reference: string }>(`SELECT id, provider_reference FROM payments WHERE booking_id=$1 AND provider='vipps'`, [b.id]))!;
    payments.get(p.provider_reference)!.state = 'ABORTED';
    await getPool().query(`UPDATE payments SET created_at = now() - interval '5 minutes' WHERE id=$1`, [p.id]);
    expect(await checkOpenVippsPayments()).toBeGreaterThanOrEqual(1);
    expect((await one<{ status: string }>(`SELECT status FROM payments WHERE id=$1`, [p.id]))!.status).toBe('failed');
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id=$1`, [b.id]))!.status).toBe('awaiting_payment');
  });

  it('webhook: registered secret is stored encrypted; signed events are processed, forged ones rejected', async () => {
    await registerVippsWebhook();
    const stored = (await one<{ value: string }>(`SELECT value FROM platform_settings WHERE key='vipps_webhook'`))!.value;
    expect(stored).not.toContain(SECRET);

    const { b, m } = await payableBooking(60);
    await startPayment(b.id, m, 'vipps');
    const p = (await one<{ provider_reference: string }>(`SELECT provider_reference FROM payments WHERE booking_id=$1 AND provider='vipps'`, [b.id]))!;
    payments.get(p.provider_reference)!.state = 'AUTHORIZED';

    const body = JSON.stringify({ msn: '123456', reference: p.provider_reference, pspReference: 'psp-auth-1', name: 'AUTHORIZED', amount: { currency: 'NOK', value: 1 }, timestamp: new Date().toISOString(), success: true });
    const date = new Date().toUTCString(), host = 'mountainretreat.no', path = '/api/webhooks/vipps';
    const hash = createHash('sha256').update(body).digest('base64');
    const sig = createHmac('sha256', SECRET).update(`POST\n${path}\n${date};${host};${hash}`).digest('base64');
    const headers = { host, 'x-ms-date': date, 'x-ms-content-sha256': hash, authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`, 'content-type': 'application/json' };
    expect(verifyVippsSignature({ secret: SECRET, method: 'POST', pathAndQuery: path, hosts: [host], headers: new Headers(headers), rawBody: body })).toBe(true);
    expect(verifyVippsSignature({ secret: SECRET, method: 'POST', pathAndQuery: path, hosts: [host], headers: new Headers(headers), rawBody: body.replace('AUTHORIZED', 'ABORTED') })).toBe(false);

    const { POST } = await import('../app/api/webhooks/vipps/route');
    const forged = await POST(new NextRequest(`https://mountainretreat.no${path}`, { method: 'POST', body, headers: { ...headers, authorization: 'HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=AAAA' } }));
    expect(forged.status).toBe(401);
    const ok = await POST(new NextRequest(`https://mountainretreat.no${path}`, { method: 'POST', body, headers }));
    expect(ok.status).toBe(200);
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id=$1`, [b.id]))!.status).toBe('confirmed');
    const again = await POST(new NextRequest(`https://mountainretreat.no${path}`, { method: 'POST', body, headers }));
    expect(await again.json()).toMatchObject({ duplicate: true });
  });
});
