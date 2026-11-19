import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/domain/payments';
import { handlePaymentFailed, handlePaymentSucceeded } from '@/lib/domain/bookings';
import { getPool, one } from '@/lib/db';
import { audit, SYSTEM } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Stripe webhook: signature verified, every event stored once (replays ignored), handlers idempotent. */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return new NextResponse('Stripe not configured', { status: 503 });
  const raw = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, req.headers.get('stripe-signature') ?? '', secret);
  } catch {
    await audit(null, { id: null, type: 'anonymous', ip: req.headers.get('x-forwarded-for') }, 'webhook.invalid_signature', 'webhook', null, undefined, { provider: 'stripe' });
    return new NextResponse('Invalid signature', { status: 400 });
  }
  const inserted = await one(`INSERT INTO webhook_events (provider, event_id, event_type, payload) VALUES ('stripe',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [event.id, event.type, raw]);
  if (!inserted) {
    const prev = await one<{ processed_at: string | null }>(`SELECT processed_at FROM webhook_events WHERE provider='stripe' AND event_id=$1`, [event.id]);
    if (prev?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  }
  try {
    const obj: any = event.data.object;
    const paymentId = obj?.metadata?.payment_id;
    if (paymentId) {
      if (event.type === 'checkout.session.completed' && obj.payment_status === 'paid') await handlePaymentSucceeded(paymentId);
      if (event.type === 'checkout.session.async_payment_succeeded') await handlePaymentSucceeded(paymentId);
      if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') await handlePaymentFailed(paymentId);
    }
    await getPool().query(`UPDATE webhook_events SET processed_at=now(), error=NULL WHERE provider='stripe' AND event_id=$1`, [event.id]);
    return NextResponse.json({ received: true });
  } catch (e) {
    await getPool().query(`UPDATE webhook_events SET error=$2 WHERE provider='stripe' AND event_id=$1`, [event.id, (e as Error).message.slice(0, 500)]);
    await audit(null, SYSTEM, 'webhook.processing_failed', 'webhook', null, undefined, { event: event.id, error: (e as Error).message });
    return new NextResponse('Processing failed', { status: 500 }); // Stripe retries
  }
}
