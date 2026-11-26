import { describe, it, expect } from 'vitest';
import { getPool, one, q, tx } from '../lib/db';
import { user, property, referral, d } from './factory';
import { qualifyReferralForBooking, rewardBalance, adjustRewards, revokeCredit, vestAndExpireRewards } from '../lib/domain/rewards';
import { approveBooking, requestBooking, rejectBooking, completeStays, handlePaymentSucceeded } from '../lib/domain/bookings';

async function completedBookingFor(memberId: string, pid: string, stayOre = 300000) {
  return (await one<{ id: string }>(`INSERT INTO bookings (reference, property_id, member_id, start_date, end_date, status, stay_price_ore, price_total_ore)
    VALUES ('T-'||substr(md5(random()::text),1,8), $1, $2, current_date - 10, current_date - 7, 'completed', $3, $3) RETURNING id`, [pid, memberId, stayOre]))!.id;
}

describe('referral rewards', () => {
  it('a completed qualifying stay grants exactly one credit to each party, even when triggered repeatedly', async () => {
    const pid = await property();
    const referrer = await user('member', { invite_tier: 'admin_invited' });
    const referred = await user('member', { invite_tier: 'member_invited' });
    await referral(referrer.id, referred.id);
    const b = await completedBookingFor(referred.id, pid);
    // simulate duplicate webhooks / job reruns, concurrently
    await Promise.allSettled([1, 2, 3].map(() => tx(c => qualifyReferralForBooking(c, b))));
    await tx(c => qualifyReferralForBooking(c, b));
    const rows = (await getPool().query(`SELECT user_id, role_in_referral, amount_ore, status FROM reward_credits WHERE referral_id IS NOT NULL AND user_id = ANY($1)`, [[referrer.id, referred.id]])).rows;
    expect(rows.length).toBe(2);
    expect(rows.every(r => r.amount_ore === 50000 && r.status === 'pending_vest')).toBe(true);
    // vesting
    await getPool().query(`UPDATE reward_credits SET vests_at = now() - interval '1 second' WHERE user_id = ANY($1)`, [[referrer.id, referred.id]]);
    await vestAndExpireRewards();
    expect((await rewardBalance(referrer.id)).available).toBe(50000);
  });

  it('only the FIRST completed stay qualifies; second stay grants nothing', async () => {
    const pid = await property();
    const a = await user('member'); const b = await user('member');
    await referral(a.id, b.id);
    const first = await completedBookingFor(b.id, pid);
    const second = await completedBookingFor(b.id, pid);
    await tx(c => qualifyReferralForBooking(c, first));
    await tx(c => qualifyReferralForBooking(c, second));
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM reward_credits WHERE user_id = ANY($1)`, [[a.id, b.id]]);
    expect(n!.n).toBe(2);
  });

  it('percentage rewards are computed from the stay price and capped', async () => {
    await getPool().query(`UPDATE platform_settings SET value='percentage' WHERE key='referral_reward_type'`);
    await getPool().query(`UPDATE platform_settings SET value='10' WHERE key='referral_reward_percentage'`);
    await getPool().query(`UPDATE platform_settings SET value='40000' WHERE key='referral_reward_max_ore'`);
    try {
      const pid = await property();
      const a = await user('member'); const b = await user('member');
      await referral(a.id, b.id);
      const bk = await completedBookingFor(b.id, pid, 300000); // 10 % = 30 000 øre
      await tx(c => qualifyReferralForBooking(c, bk));
      const r = await one<{ amount_ore: number }>(`SELECT amount_ore FROM reward_credits WHERE user_id=$1`, [b.id]);
      expect(r!.amount_ore).toBe(30000);
      const a2 = await user('member'); const b2 = await user('member');
      await referral(a2.id, b2.id);
      const big = await completedBookingFor(b2.id, pid, 2000000); // 10 % = 200 000 → capped 40 000
      await tx(c => qualifyReferralForBooking(c, big));
      expect((await one<{ amount_ore: number }>(`SELECT amount_ore FROM reward_credits WHERE user_id=$1`, [b2.id]))!.amount_ore).toBe(40000);
    } finally {
      await getPool().query(`UPDATE platform_settings SET value='fixed' WHERE key='referral_reward_type'`);
    }
  });

  it('stays below the minimum qualifying amount do not qualify', async () => {
    const pid = await property();
    const a = await user('member'); const b = await user('member');
    await referral(a.id, b.id);
    const bk = await completedBookingFor(b.id, pid, 50000); // below 1000 kr default
    expect(await tx(c => qualifyReferralForBooking(c, bk))).toBe(false);
  });

  it('self-referral is impossible at the database level', async () => {
    const a = await user('member');
    await expect(referral(a.id, a.id)).rejects.toThrow();
  });

  it('suspended referrer receives nothing; referred member still does', async () => {
    const pid = await property();
    const a = await user('member', { status: 'suspended' }); const b = await user('member');
    await referral(a.id, b.id);
    await tx(async c => qualifyReferralForBooking(c, await completedBookingFor(b.id, pid)));
    expect(await one(`SELECT 1 FROM reward_credits WHERE user_id=$1`, [a.id])).toBeNull();
    expect(await one(`SELECT 1 FROM reward_credits WHERE user_id=$1`, [b.id])).toBeTruthy();
  });

  it('up to 5 bonuses are used per booking (those expiring first) and they are returned on rejection/expiry', async () => {
    const pid = await property();
    const admin = await user('admin');
    const m = await user('member', { invite_tier: 'admin_invited' });
    await adjustRewards(m.id, 30000, 'Kompensasjon', { id: admin.id, type: 'admin' });
    await adjustRewards(m.id, 20000, 'Bonus', { id: admin.id, type: 'admin' });
    await getPool().query(`UPDATE reward_credits SET expires_at = expires_at - interval '1 month' WHERE user_id=$1 AND amount_ore=20000`, [m.id]);
    const bal0 = await rewardBalance(m.id);
    expect(bal0).toMatchObject({ available: 50000, unused: 2 });
    expect(bal0.next!.amount).toBe(50000);
    await getPool().query(`UPDATE platform_settings SET value='1' WHERE key='referral_reward_max_per_booking'`);
    expect((await rewardBalance(m.id)).next!.amount).toBe(20000);
    const b = await requestBooking(m, { propertyId: pid, startDate: d(10), endDate: d(12), adults: 2, children: 0, infants: 0, addOns: [], useRewards: true }, { id: m.id, type: 'member' });
    await approveBooking(b.id, { id: admin.id, type: 'admin' });
    const row = await one<{ price_total_ore: number; reward_discount_ore: number }>('SELECT price_total_ore, reward_discount_ore FROM bookings WHERE id=$1', [b.id]);
    await getPool().query(`UPDATE platform_settings SET value='5' WHERE key='referral_reward_max_per_booking'`);
    expect(row!.reward_discount_ore).toBe(20000);
    expect(row!.price_total_ore).toBe(2 * 90000 + 50000 - 20000);
    expect((await rewardBalance(m.id)).available).toBe(30000);
    // hold expires → the bonus comes back
    await getPool().query(`UPDATE booking_holds SET expires_at = now() - interval '1 minute' WHERE booking_id=$1`, [b.id]);
    const { expireHolds } = await import('../lib/domain/bookings');
    await expireHolds();
    expect((await rewardBalance(m.id)).available).toBe(50000);
  });

  it('bonuses are valid 24 months from earning, and a reminder goes out 30 days before expiry', async () => {
    const admin = await user('admin');
    const m = await user('member', { invite_tier: 'admin_invited' });
    await adjustRewards(m.id, 50000, 'Test', { id: admin.id, type: 'admin' });
    const cr = (await one<{ months: number }>(`SELECT (extract(year from age(expires_at, granted_at)) * 12 + extract(month from age(expires_at, granted_at)))::int AS months FROM reward_credits WHERE user_id=$1`, [m.id]))!;
    expect(cr.months).toBe(24);
    await getPool().query(`UPDATE reward_credits SET expires_at = now() + interval '20 days' WHERE user_id=$1`, [m.id]);
    await vestAndExpireRewards(); await vestAndExpireRewards();
    expect((await q(`SELECT 1 FROM notifications WHERE type='reward_expiring' AND user_id=$1`, [m.id])).length).toBe(1);
  });

  it('a booking fully covered by rewards is confirmed without payment', async () => {
    const pid = await property();
    const admin = await user('admin');
    const m = await user('member', { invite_tier: 'admin_invited' });
    await adjustRewards(m.id, 1000000, 'Stor bonus', { id: admin.id, type: 'admin' });
    const b = await requestBooking(m, { propertyId: pid, startDate: d(20), endDate: d(22), adults: 1, children: 0, infants: 0, addOns: [], useRewards: true }, { id: m.id, type: 'member' });
    const r = await approveBooking(b.id, { id: admin.id, type: 'admin' });
    expect(r.status).toBe('confirmed');
    expect((await rewardBalance(m.id)).available).toBe(1000000 - 230000);
  });

  it('admin can debit and revoke; ledger records every movement; balance never negative', async () => {
    const admin = await user('admin');
    const m = await user('member');
    const actor = { id: admin.id, type: 'admin' as const };
    await adjustRewards(m.id, 10000, 'Test', actor);
    await expect(adjustRewards(m.id, -20000, 'For mye', actor)).rejects.toThrow(/bare/);
    await adjustRewards(m.id, -4000, 'Korrigering', actor);
    expect((await rewardBalance(m.id)).available).toBe(6000);
    const credit = await one<{ id: string }>(`SELECT id FROM reward_credits WHERE user_id=$1`, [m.id]);
    await revokeCredit(credit!.id, actor);
    expect((await rewardBalance(m.id)).available).toBe(0);
    const ledger = await one<{ n: number; sum: number }>(`SELECT count(*)::int AS n, sum(amount_ore)::int AS sum FROM reward_transactions WHERE user_id=$1`, [m.id]);
    expect(ledger).toEqual({ n: 3, sum: 0 });
  });

  it('end-to-end: invited member completes a paid stay → both get rewards via completeStays job', async () => {
    const pid = await property();
    const admin = await user('admin');
    const inviter = await user('member', { invite_tier: 'admin_invited' });
    const m = await user('member', { invite_tier: 'member_invited' });
    await referral(inviter.id, m.id);
    const b = await requestBooking(m, { propertyId: pid, startDate: d(150), endDate: d(152), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
    await approveBooking(b.id, { id: admin.id, type: 'admin' });
    const p = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) VALUES ($1,'stripe_card','mock',230000,'e2e') RETURNING id`, [b.id]);
    await handlePaymentSucceeded(p!.id);
    await getPool().query(`UPDATE bookings SET start_date = current_date - 3, end_date = current_date - 1 WHERE id=$1`, [b.id]);
    await completeStays(); await completeStays();
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM reward_credits WHERE user_id = ANY($1)`, [[inviter.id, m.id]]);
    expect(n!.n).toBe(2);
  });
});

describe('referral bonus cap', () => {
  it('a member can hold at most N unused referral bonuses', async () => {
    await getPool().query(`UPDATE platform_settings SET value='2' WHERE key='referral_reward_max_unused'`);
    try {
      const pid = await property();
      const inviter = await user('member', { invite_tier: 'admin_invited' });
      for (let i = 0; i < 3; i++) {
        const friend = await user('member');
        await referral(inviter.id, friend.id);
        const bk = (await one<{ id: string }>(`INSERT INTO bookings (reference, property_id, member_id, start_date, end_date, status, stay_price_ore, price_total_ore)
          VALUES ('C-'||substr(md5(random()::text),1,8), $1, $2, current_date - 10, current_date - 7, 'completed', 300000, 300000) RETURNING id`, [pid, friend.id]))!.id;
        await tx(c => qualifyReferralForBooking(c, bk));
      }
      const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM reward_credits WHERE user_id=$1`, [inviter.id]);
      expect(n!.n).toBe(2);
      expect(await one(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='reward_cap'`, [inviter.id])).toBeTruthy();
    } finally { await getPool().query(`UPDATE platform_settings SET value='10' WHERE key='referral_reward_max_unused'`); }
  });
});
