import { describe, it, expect, beforeAll } from 'vitest';
import { getPool, one } from '../lib/db';
import { user, property, d } from './factory';
import { computeMemberDiscount, memberDiscount } from '../lib/domain/memberDiscount';
import { approveBooking, requestBooking, handlePaymentSucceeded, requestCancellation } from '../lib/domain/bookings';

const set = (k: string, v: string) => getPool().query(`UPDATE platform_settings SET value=$2 WHERE key=$1`, [k, v]);

describe('member discount: standard + individual override + loyalty steps', () => {
  beforeAll(async () => { await set('member_base_discount_pct', '5'); await set('member_loyalty_step_pct', '1'); await set('member_loyalty_max_pct', '10'); });

  it('pure rules: +1 % per booking, loyalty capped at 10 %', () => {
    expect(computeMemberDiscount(5, null, 0, 1, 10).totalPct).toBe(5);
    expect(computeMemberDiscount(5, null, 3, 1, 10).totalPct).toBe(8);
    expect(computeMemberDiscount(5, null, 25, 1, 10)).toMatchObject({ loyaltyPct: 10, totalPct: 15, atMax: true });
    expect(computeMemberDiscount(5, 12, 2, 1, 10)).toMatchObject({ basePct: 12, baseIsOverride: true, totalPct: 14, nextTotalPct: 15 });
  });

  it('each confirmed booking raises the next price; cancelled bookings stop counting; the member is told', async () => {
    const pid = await property();
    const admin = { id: (await user('admin')).id, type: 'admin' as const };
    const m = await user('member', { invite_tier: 'admin_invited' });
    const book = async (s: number) => {
      const b = await requestBooking(m, { propertyId: pid, startDate: d(s), endDate: d(s + 2), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
      await approveBooking(b.id, admin);
      const p = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) SELECT id,'stripe_card','mock',price_total_ore,'d'||id FROM bookings WHERE id=$1 RETURNING id`, [b.id]);
      await handlePaymentSucceeded(p!.id);
      return (await one<{ id: string; stay_price_ore: number }>('SELECT id, stay_price_ore FROM bookings WHERE id=$1', [b.id]))!;
    };
    const first = await book(40);   // 0 earlier bookings → 5 %
    const second = await book(50);  // 1 earlier booking  → 6 %
    expect(first.stay_price_ore).toBe(2 * 100000 * 0.95);
    expect(second.stay_price_ore).toBe(2 * 100000 * 0.94);
    expect((await memberDiscount(m.id)).totalPct).toBe(7);
    expect(await one(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='discount_increased'`, [m.id])).toBeTruthy();
    await requestCancellation(second.id, m, { id: m.id, type: 'member' });
    expect((await memberDiscount(m.id)).totalPct).toBe(6);
  });

  it('admin override replaces the standard for that member only', async () => {
    const a = await user('member', { member_discount_override_pct: 20 });
    const b = await user('member');
    expect((await memberDiscount(a.id)).totalPct).toBe(20);
    expect((await memberDiscount(b.id)).totalPct).toBe(5);
  });
});
