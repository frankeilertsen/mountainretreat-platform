import { describe, it, expect } from 'vitest';
import { getPool, one } from '../lib/db';
import { user, property, d } from './factory';
import { approveBooking, rejectBooking, requestBooking, handlePaymentSucceeded, expireHolds, requestCancellation, startPayment, completeStays, decideCancellation, autoResolveCancellations } from '../lib/domain/bookings';
import { createManualBlock } from '../lib/domain/availability';

const actorOf = (u: any) => ({ id: u.id, type: 'member' as const });

async function setup() {
  const admin = await user('admin');
  const m1 = await user('member', { invite_tier: 'admin_invited' });
  const m2 = await user('member', { invite_tier: 'admin_invited' });
  const pid = await property();
  return { admin, m1, m2, pid, adminActor: { id: admin.id, type: 'admin' as const } };
}
const req = (m: any, pid: string, s: number, e: number, extra = {}) =>
  requestBooking(m, { propertyId: pid, startDate: d(s), endDate: d(e), adults: 2, children: 0, infants: 0, addOns: [], ...extra }, actorOf(m));

async function pay(bookingId: string, m: any) {
  const r = await startPayment(bookingId, m, 'stripe_card'); // mock provider in tests
  const p = await one<{ id: string }>(`SELECT id FROM payments WHERE booking_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`, [bookingId]);
  expect(r).toHaveProperty('checkoutUrl');
  return p!.id;
}

describe('booking workflow', () => {
  it('request → approve (price locked, dates held) → pay → confirmed + cleaning task', async () => {
    const { m1, pid, adminActor } = await setup();
    const b = await req(m1, pid, 10, 13);
    const row1 = await one('SELECT status, price_total_ore FROM bookings WHERE id=$1', [b.id]);
    expect(row1).toMatchObject({ status: 'pending_review', price_total_ore: 3 * 90000 + 50000 });
    // pending requests never hold dates
    expect(await one(`SELECT 1 FROM availability_blocks WHERE reference_id=$1`, [b.id])).toBeNull();

    await approveBooking(b.id, adminActor);
    // Price changes after approval must not affect the locked price
    await getPool().query(`UPDATE season_categories SET price_per_night_ore = 999900 WHERE property_id=$1`, [pid]);
    const pid1 = await pay(b.id, m1);
    const p = await one<{ amount_ore: number }>('SELECT amount_ore FROM payments WHERE id=$1', [pid1]);
    expect(p!.amount_ore).toBe(320000);
    expect(await handlePaymentSucceeded(pid1)).toBe('confirmed');
    const row = await one('SELECT status, price_locked_at FROM bookings WHERE id=$1', [b.id]);
    expect(row.status).toBe('confirmed');
    expect(row.price_locked_at).not.toBeNull();
    const task = await one(`SELECT task_type, status FROM cleaning_tasks WHERE booking_id=$1 AND task_type='turnover'`, [b.id]);
    expect(task).toBeTruthy();
  });

  it('two simultaneous approvals of overlapping requests → exactly one succeeds', async () => {
    const { m1, m2, pid, adminActor } = await setup();
    const a = await req(m1, pid, 20, 24);
    const b = await req(m2, pid, 22, 26);
    const results = await Promise.allSettled([approveBooking(a.id, adminActor), approveBooking(b.id, adminActor)]);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('dates_taken');
    const blocks = await one<{ n: number }>(`SELECT count(*)::int AS n FROM availability_blocks WHERE property_id=$1`, [pid]);
    expect(blocks!.n).toBe(1);
    // the loser stays pending_review (rolled back), never half-approved
    const statuses = (await getPool().query(`SELECT status FROM bookings WHERE id = ANY($1)`, [[a.id, b.id]])).rows.map(r => r.status).sort();
    expect(statuses).toEqual(['awaiting_payment', 'pending_review']);
  });

  it('20 concurrent approvals of the same dates under contention → one block', async () => {
    const { pid, adminActor } = await setup();
    const members = await Promise.all(Array.from({ length: 20 }, () => user('member', { invite_tier: 'admin_invited' })));
    const reqs = [];
    for (const m of members) reqs.push(await req(m, pid, 40, 43));
    const results = await Promise.allSettled(reqs.map(r => approveBooking(r.id, adminActor)));
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
  });

  it('request is rejected up front when dates are blocked (manual block)', async () => {
    const { m1, pid, adminActor } = await setup();
    await createManualBlock(pid, d(50), d(55), 'Vedlikehold', adminActor);
    await expect(req(m1, pid, 52, 54)).rejects.toThrow(/ikke ledige/);
  });

  it('payment webhook replay is idempotent', async () => {
    const { m1, pid, adminActor } = await setup();
    const b = await req(m1, pid, 60, 63);
    await approveBooking(b.id, adminActor);
    const p = await pay(b.id, m1);
    const results = await Promise.all([handlePaymentSucceeded(p), handlePaymentSucceeded(p), handlePaymentSucceeded(p)]);
    expect(results.filter(r => r === 'confirmed').length).toBe(1);
    expect(results.filter(r => r === 'already').length).toBe(2);
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action='booking.confirmed' AND entity_id=$1`, [b.id]);
    expect(n!.n).toBe(1);
  });

  it('expired hold releases dates; a late payment is refunded automatically', async () => {
    const { m1, m2, pid, adminActor } = await setup();
    const b = await req(m1, pid, 70, 73);
    await approveBooking(b.id, adminActor);
    const p = await pay(b.id, m1);
    await getPool().query(`UPDATE booking_holds SET expires_at = now() - interval '1 minute' WHERE booking_id=$1`, [b.id]);
    await getPool().query(`UPDATE payments SET created_at = now() - interval '2 hours' WHERE id=$1`, [p]); // no in-flight grace
    expect(await expireHolds()).toBeGreaterThanOrEqual(1);
    expect((await one('SELECT status FROM bookings WHERE id=$1', [b.id])).status).toBe('expired');
    // dates are free again for someone else
    const b2 = await req(m2, pid, 70, 73);
    await approveBooking(b2.id, adminActor);
    // the stale checkout completes anyway → must not confirm, must refund
    await getPool().query(`UPDATE payments SET status='pending' WHERE id=$1`, [p]);
    expect(await handlePaymentSucceeded(p)).toBe('refunded');
    const refund = await one(`SELECT status, reason FROM refunds WHERE payment_id=$1`, [p]);
    expect(refund).toMatchObject({ status: 'succeeded', reason: 'conflict_auto_refund' });
  });

  it('rejecting frees nothing (never held) and notifies the member', async () => {
    const { m1, pid, adminActor } = await setup();
    const b = await req(m1, pid, 80, 83);
    await rejectBooking(b.id, 'Opptatt av familien', adminActor);
    expect((await one('SELECT status FROM bookings WHERE id=$1', [b.id])).status).toBe('rejected');
    expect(await one(`SELECT 1 FROM notifications WHERE type='booking_rejected' AND user_id=$1`, [m1.id])).toBeTruthy();
  });

  it('cancellation: ≥30 days → 100 % refund, block removed; <10 days → needs approval, auto-approved after timeout', async () => {
    const { m1, pid, adminActor } = await setup();
    const b = await req(m1, pid, 90, 93);
    await approveBooking(b.id, adminActor);
    await handlePaymentSucceeded(await pay(b.id, m1));
    expect(await requestCancellation(b.id, m1, actorOf(m1))).toBe('cancelled');
    expect(await one(`SELECT 1 FROM availability_blocks WHERE reference_id=$1`, [b.id])).toBeNull();
    const r = await one<{ amount_ore: number; status: string }>(`SELECT r.amount_ore, r.status FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.booking_id=$1`, [b.id]);
    expect(r).toMatchObject({ amount_ore: 320000 - (Math.round(320000 * 2.99 / 100) + 200), status: 'succeeded' });
    expect((await one(`SELECT status FROM cleaning_tasks WHERE booking_id=$1 AND task_type='turnover'`, [b.id])).status).toBe('cancelled');

    const late = await req(m1, pid, 3, 5);
    await approveBooking(late.id, adminActor);
    await handlePaymentSucceeded(await pay(late.id, m1));
    expect(await requestCancellation(late.id, m1, actorOf(m1))).toBe('requested');
    await getPool().query(`UPDATE bookings SET cancellation_requested_at = now() - interval '49 hours' WHERE id=$1`, [late.id]);
    await autoResolveCancellations();
    const row = await one(`SELECT status, cancelled_reason FROM bookings WHERE id=$1`, [late.id]);
    expect(row).toMatchObject({ status: 'cancelled', cancelled_reason: 'timeout_auto_approval' });
  });

  it('admin can deny a cancellation request (booking stays confirmed)', async () => {
    const { m1, pid, adminActor } = await setup();
    const b = await req(m1, pid, 2, 4);
    await approveBooking(b.id, adminActor);
    await handlePaymentSucceeded(await pay(b.id, m1));
    await requestCancellation(b.id, m1, actorOf(m1));
    await decideCancellation(b.id, false, adminActor);
    expect((await one('SELECT status FROM bookings WHERE id=$1', [b.id])).status).toBe('confirmed');
  });

  it('double-submitted request with same idempotency key creates one booking', async () => {
    const { m1, pid } = await setup();
    const [a, b] = await Promise.all([req(m1, pid, 100, 103, { idempotencyKey: 'k1' }), req(m1, pid, 100, 103, { idempotencyKey: 'k1' })]);
    expect(a.id).toBe(b.id);
  });

  it('members cannot pay or cancel other members’ bookings', async () => {
    const { m1, m2, pid, adminActor } = await setup();
    const b = await req(m1, pid, 110, 113);
    await approveBooking(b.id, adminActor);
    await expect(startPayment(b.id, m2, 'stripe_card')).rejects.toThrow(/tilgang/);
    await expect(requestCancellation(b.id, m2, actorOf(m2))).rejects.toThrow(/tilgang/);
  });

  it('helpers cannot request bookings', async () => {
    const { pid } = await setup();
    const h = await user('helper');
    await expect(req(h, pid, 120, 123)).rejects.toThrow(/tilgang/);
  });

  it('completeStays marks past confirmed stays completed', async () => {
    const { m1, pid, adminActor } = await setup();
    const b = await req(m1, pid, 130, 133);
    await approveBooking(b.id, adminActor);
    await handlePaymentSucceeded(await pay(b.id, m1));
    await getPool().query(`UPDATE bookings SET start_date = current_date - 5, end_date = current_date - 2 WHERE id=$1`, [b.id]);
    await completeStays();
    expect((await one('SELECT status FROM bookings WHERE id=$1', [b.id])).status).toBe('completed');
  });
});
