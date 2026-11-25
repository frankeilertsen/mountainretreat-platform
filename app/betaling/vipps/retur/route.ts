import { NextRequest } from 'next/server';
import { one } from '@/lib/db';
import { syncVippsPayment } from '@/lib/payments/vipps';
import { redirectTo } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Where Vipps sends the customer back. The URL can be opened several times, so it only *reads* the status
 * (verified with Vipps) – the confirmation itself is idempotent – and then shows the booking.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref') ?? '';
  const p = await one<{ booking_ref: string }>(
    `SELECT b.reference AS booking_ref FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.provider='vipps' AND p.provider_reference=$1`, [ref]);
  if (!p) return redirectTo('/medlem/bookinger');
  let state: string = 'pending';
  try { state = await syncVippsPayment(ref); } catch (e) { console.error('[vipps] return', (e as Error).message); }
  if (state === 'confirmed') return redirectTo(`/medlem/bookinger?betalt=${encodeURIComponent(p.booking_ref)}`, 303);
  if (state === 'failed') return redirectTo(`/medlem/bookinger?avbrutt=${encodeURIComponent(p.booking_ref)}`, 303);
  return redirectTo(`/medlem/bookinger?venter=${encodeURIComponent(p.booking_ref)}`, 303);
}
