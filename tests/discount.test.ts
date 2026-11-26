import { describe, it, expect, beforeAll } from 'vitest';
import { getPool, one } from '../lib/db';
import { user, property, d } from './factory';
import { computeMemberDiscount, memberDiscount } from '../lib/domain/memberDiscount';
import { approveBooking, requestBooking, handlePaymentSucceeded, requestCancellation } from '../lib/domain/bookings';

const set = (k: string, v: string) => getPool().query(`UPDATE platform_settings SET value=$2 WHERE key=$1`, [k, v]);

describe('member discount: standard + individual override + loyalty steps', () => {
  beforeAll(async () => { await set('member_base_discount_pct', '5'); await set('member_loyalty_step_pct', '1'); await set('member_loyalty_max_pct', '10'); });

  it('pure rules: +1 % per booking, loyalty capped at 10 %; tiered steps', async () => {
    expect(computeMemberDiscount(5, null, 0, 1, 10).totalPct).toBe(5);
    expect(computeMemberDiscount(5, null, 3, 1, 10).totalPct).toBe(8);
    expect(computeMemberDiscount(5, null, 25, 1, 10)).toMatchObject({ loyaltyPct: 10, totalPct: 15, atMax: true });
    const tiers = [1, 1, 1, 1, 1, 1.5, 1.5, 1.5, 1.5, 2, 2];
    expect(computeMemberDiscount(10, null, 5, tiers, 15)).toMatchObject({ loyaltyPct: 5, stepPct: 1.5, nextTotalPct: 16.5 });
    expect(computeMemberDiscount(10, null, 9, tiers, 15)).toMatchObject({ loyaltyPct: 11, stepPct: 2 });
    expect(computeMemberDiscount(10, null, 11, tiers, 15)).toMatchObject({ loyaltyPct: 15, totalPct: 25, atMax: true, stepPct: 0 });
    expect(computeMemberDiscount(10, null, 30, tiers, 15).ladder).toHaveLength(12);
    const { describeSteps } = await import('../lib/domain/memberDiscount');
    expect(describeSteps(tiers)).toBe('1 % per booking for de 5 første, 1,5 % for de neste 4 og 2 % for de 2 siste');
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

describe('season-aware discount (Dec 2026 model)', () => {
  it('20 % low/high, 15 % holiday, loyalty max 5 % only outside holidays, launch +5 %, capped at 25 %', async () => {
    const { computeMemberDiscount, discountForKind } = await import('../lib/domain/memberDiscount');
    const steps = [1, 1, 1, 1, 1];
    const extras = { holidayBasePct: 15, loyaltyInHoliday: false, capPct: 25 };
    const d0 = computeMemberDiscount(20, null, 0, steps, 5, extras);
    expect(discountForKind(d0, 'high_season')).toMatchObject({ base: 20, loyalty: 0, launch: 0, total: 20 });
    expect(discountForKind(d0, 'holiday').total).toBe(15);
    const d3 = computeMemberDiscount(20, null, 3, steps, 5, extras);
    expect(discountForKind(d3, 'low_season').total).toBe(23);
    expect(discountForKind(d3, 'holiday')).toMatchObject({ loyalty: 0, total: 15 });
    const d9 = computeMemberDiscount(20, null, 9, steps, 5, extras);
    expect(d9.loyaltyPct).toBe(5);
    expect(discountForKind(d9, 'high_season').total).toBe(25);
    const launch = computeMemberDiscount(20, null, 2, steps, 5, { ...extras, launchPct: 5 });
    expect(discountForKind(launch, 'high_season')).toMatchObject({ base: 20, loyalty: 2, launch: 3, total: 25 });
    expect(discountForKind(launch, 'holiday')).toMatchObject({ base: 15, loyalty: 0, launch: 5, total: 20 });
  });

  it('a quote mixes holiday and normal nights and splits the discount', async () => {
    const { computeQuote } = await import('../lib/domain/pricing');
    const { computeMemberDiscount, discountForKind } = await import('../lib/domain/memberDiscount');
    const hi = { id: 'h', kind: 'high_season', name: 'Høy', price_per_night_ore: 100000, min_nights: 1, max_nights: null };
    const ho = { id: 'f', kind: 'holiday', name: 'Ferie', price_per_night_ore: 100000, min_nights: 1, max_nights: null };
    const per = (id: string, c: string, s: string, e: string) => ({ id, season_category_id: c, name: id, start_date: s, end_date: e, price_per_night_ore: null, min_nights: null, max_nights: null, booking_mode: 'flexible' as const, changeover_weekday: null, priority: 0 });
    const d = computeMemberDiscount(20, null, 0, [1, 1, 1, 1, 1], 5, { holidayBasePct: 15, loyaltyInHoliday: false, capPct: 25, launchPct: 5 });
    const q = computeQuote({ startDate: '2030-03-01', endDate: '2030-03-05', guests: 2, maxGuests: 6, categories: [hi, ho], periods: [per('a', 'h', '2030-03-01', '2030-03-02'), per('b', 'f', '2030-03-03', '2030-03-10')],
      losDiscounts: [], cleaningFeeOre: 0, addOns: [], selectedAddOns: [], pricingMode: 'manual', discountByKind: k => discountForKind(d, k) });
    expect(q.nightLines.map(n => n.member_discount_pct)).toEqual([25, 25, 20, 20]);
    expect(q.stay_ore).toBe(75000 * 2 + 80000 * 2);
    expect(q.base_discount_ore).toBe(20000 * 2 + 15000 * 2);
    expect(q.launch_discount_ore).toBe(5000 * 4);
    expect(q.loyalty_discount_ore).toBe(0);
  });
});
