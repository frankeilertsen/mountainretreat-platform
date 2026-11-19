import { NextRequest, NextResponse } from 'next/server';
import { mockProvider, mockSignature } from '@/lib/domain/payments';
import { handlePaymentFailed, handlePaymentSucceeded } from '@/lib/domain/bookings';
import { safeEqual } from '@/lib/crypto';
import { one, getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** DEV ONLY webhook for the mock provider. Same verification + idempotency path as the real one. */
export async function POST(req: NextRequest) {
  if (!mockProvider.configured()) return new NextResponse('Disabled', { status: 404 });
  const raw = await req.text();
  if (!safeEqual(req.headers.get('x-test-signature') ?? '', mockSignature(raw))) return new NextResponse('Invalid signature', { status: 400 });
  const evt = JSON.parse(raw) as { id: string; type: 'payment.succeeded' | 'payment.failed'; payment_id: string };
  const ins = await one(`INSERT INTO webhook_events (provider, event_id, event_type, payload) VALUES ('mock',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [evt.id, evt.type, raw]);
  if (!ins) return NextResponse.json({ duplicate: true });
  const r = evt.type === 'payment.succeeded' ? await handlePaymentSucceeded(evt.payment_id) : await handlePaymentFailed(evt.payment_id);
  await getPool().query(`UPDATE webhook_events SET processed_at=now() WHERE provider='mock' AND event_id=$1`, [evt.id]);
  return NextResponse.json({ ok: true, result: r });
}
