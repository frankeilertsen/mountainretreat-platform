import { NextRequest, NextResponse } from 'next/server';
import { getPool, one } from '@/lib/db';
import { audit, SYSTEM } from '@/lib/audit';
import { syncVippsPayment, verifyVippsSignature, vippsConfigured, vippsWebhookInfo } from '@/lib/payments/vipps';

export const dynamic = 'force-dynamic';

/**
 * Vipps MobilePay webhook. HMAC-verified with the secret from registration; every event stored once.
 * The event only tells us *that* something happened – the payment state is always read back from the API.
 */
export async function POST(req: NextRequest) {
  const hook = vippsConfigured() ? await vippsWebhookInfo() : null;
  if (!hook) return new NextResponse('Vipps not configured', { status: 503 });
  const raw = await req.text();
  const url = new URL(req.url);
  const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host'), new URL(hook.url).host].filter((h, i, a): h is string => !!h && a.indexOf(h) === i);
  if (!verifyVippsSignature({ secret: hook.secret, method: 'POST', pathAndQuery: url.pathname + url.search, hosts, headers: req.headers, rawBody: raw })) {
    await audit(null, { id: null, type: 'anonymous', ip: req.headers.get('x-forwarded-for') }, 'webhook.invalid_signature', 'webhook', null, undefined, { provider: 'vipps' });
    return new NextResponse('Invalid signature', { status: 401 });
  }
  let ev: { reference?: string; pspReference?: string; name?: string };
  try { ev = JSON.parse(raw); } catch { return new NextResponse('Bad payload', { status: 400 }); }
  const eventId = `${ev.pspReference ?? ''}:${ev.name ?? ''}:${ev.reference ?? ''}`;
  const inserted = await one(`INSERT INTO webhook_events (provider, event_id, event_type, payload) VALUES ('vipps',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [eventId, ev.name ?? 'unknown', raw]);
  if (!inserted) {
    const prev = await one<{ processed_at: string | null }>(`SELECT processed_at FROM webhook_events WHERE provider='vipps' AND event_id=$1`, [eventId]);
    if (prev?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  }
  try {
    if (ev.reference && ['AUTHORIZED', 'CAPTURED', 'ABORTED', 'EXPIRED', 'TERMINATED'].includes(ev.name ?? '')) await syncVippsPayment(ev.reference);
    await getPool().query(`UPDATE webhook_events SET processed_at=now(), error=NULL WHERE provider='vipps' AND event_id=$1`, [eventId]);
    return NextResponse.json({ received: true });
  } catch (e) {
    await getPool().query(`UPDATE webhook_events SET error=$2 WHERE provider='vipps' AND event_id=$1`, [eventId, (e as Error).message.slice(0, 500)]);
    await audit(null, SYSTEM, 'webhook.processing_failed', 'webhook', null, undefined, { provider: 'vipps', event: eventId, error: (e as Error).message });
    return new NextResponse('Processing failed', { status: 500 }); // Vipps retries
  }
}
