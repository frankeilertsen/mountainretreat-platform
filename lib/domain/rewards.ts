import { PoolClient } from 'pg';
import { Db, getPool, one, q, tx } from '../db';
import { audit, Actor, SYSTEM } from '../audit';
import { enqueue } from '../notify';
import { getNum, getStr } from '../settings';
import { DomainError } from '../errors';
import { nok } from '../format';

/** Statuses of a bonus that still has value and counts toward the "max unused" limit. */
export const UNUSED_STATUSES = `('pending_vest','available','partially_used')`;

/**
 * available = sum of usable bonuses; next = what can be used on the next booking:
 * up to `referral_reward_max_per_booking` bonuses (default 5), those that expire first.
 */
export async function rewardBalance(userId: string, db: Db = getPool()) {
  const r = await one<{ available: string; pending: string; unused: number }>(
    `SELECT COALESCE(SUM(remaining_amount_ore) FILTER (WHERE status IN ('available','partially_used') AND expires_at > now()),0) AS available,
            COALESCE(SUM(remaining_amount_ore) FILTER (WHERE status = 'pending_vest'),0) AS pending,
            (count(*) FILTER (WHERE status IN ${UNUSED_STATUSES} AND expires_at > now() AND remaining_amount_ore > 0))::int AS unused
     FROM reward_credits WHERE user_id=$1`, [userId], db);
  const perBooking = await maxPerBooking(db);
  const firsts = await q<{ amount: number; expires_at: string }>(
    `SELECT remaining_amount_ore AS amount, expires_at FROM reward_credits
     WHERE user_id=$1 AND status IN ('available','partially_used') AND expires_at > now() AND remaining_amount_ore > 0
     ORDER BY expires_at, granted_at LIMIT $2`, [userId, perBooking], db);
  return { available: Number(r?.available ?? 0), pending: Number(r?.pending ?? 0), unused: r?.unused ?? 0, perBooking,
    next: firsts.length ? { amount: firsts.reduce((s, x) => s + Number(x.amount), 0), count: firsts.length, expiresAt: firsts[0].expires_at } : null };
}

async function validityMonths(db: Db) { return getNum('referral_reward_validity_months', 24, db); }
async function maxPerBooking(db: Db) { return Math.max(1, await getNum('referral_reward_max_per_booking', 5, db)); }

/** Computes the reward for one party from admin settings (fixed amount or % of the qualifying stay, capped). */
export async function computeRewardAmount(role: 'referrer' | 'referred', qualifyingStayOre: number, db: Db = getPool()): Promise<number> {
  const type = await getStr('referral_reward_type', 'fixed', db);
  if (type === 'percentage') {
    const pct = await getNum('referral_reward_percentage', 10, db);
    const cap = await getNum('referral_reward_max_ore', 100000, db);
    return Math.max(0, Math.min(cap, Math.round(qualifyingStayOre * pct / 100)));
  }
  return getNum(role === 'referrer' ? 'referral_reward_referrer_ore' : 'referral_reward_referred_ore', 50000, db);
}

/**
 * Called when a booking becomes `completed`. Idempotent: the referral row is locked and the unique index
 * (referral_id, role_in_referral) makes duplicate credits impossible even if called repeatedly.
 */
export async function qualifyReferralForBooking(c: PoolClient, bookingId: string): Promise<boolean> {
  const b = await one<{ member_id: string; status: string; stay_price_ore: number }>(
    'SELECT member_id, status, stay_price_ore FROM bookings WHERE id=$1', [bookingId], c);
  if (!b || b.status !== 'completed') return false;
  const ref = await one<{ id: string; referrer_user_id: string; status: string }>(
    `SELECT id, referrer_user_id, status FROM referrals WHERE referred_user_id=$1 FOR UPDATE`, [b.member_id], c);
  if (!ref || ref.status !== 'pending') return false;
  const min = await getNum('referral_min_qualifying_amount_ore', 0, c);
  if (b.stay_price_ore < min) return false;
  const users = await q<{ id: string; status: string; email: string; name: string }>(
    'SELECT id, status, email, name FROM users WHERE id = ANY($1)', [[ref.referrer_user_id, b.member_id]], c);
  const referrer = users.find(u => u.id === ref.referrer_user_id);
  const referred = users.find(u => u.id === b.member_id)!;
  await c.query(`UPDATE referrals SET status='qualified', qualifying_booking_id=$2, qualified_at=now() WHERE id=$1`, [ref.id, bookingId]);

  const vestDays = await getNum('referral_reward_vesting_days', 7, c);
  const validMonths = await validityMonths(c);
  const parties: { user: typeof referred; role: 'referrer' | 'referred' }[] = [{ user: referred, role: 'referred' }];
  // Abuse guard: a suspended/revoked referrer gets nothing
  if (referrer && referrer.status === 'active') parties.push({ user: referrer, role: 'referrer' });
  const maxUnused = await getNum('referral_reward_max_unused', 10, c);
  const perBooking = await maxPerBooking(c);
  for (const p of parties) {
    const amount = await computeRewardAmount(p.role, b.stay_price_ore, c);
    if (amount <= 0) continue;
    // Cap: a member can hold at most N unused referral bonuses; they must use some before earning more
    const unused = await one<{ n: number }>(`SELECT count(*)::int AS n FROM reward_credits WHERE user_id=$1 AND status IN ${UNUSED_STATUSES} AND expires_at > now() AND remaining_amount_ore > 0`, [p.user.id], c);
    if (maxUnused > 0 && (unused?.n ?? 0) >= maxUnused) {
      await audit(c, SYSTEM, 'reward.skipped_cap_reached', 'user', p.user.id, undefined, { referral: ref.id, maxUnused });
      await enqueue({ userId: p.user.id, to: p.user.email, type: 'reward_cap', dedupeKey: `reward_cap:${ref.id}:${p.role}`,
        subject: 'Du har nådd maks antall ubrukte vervebonuser',
        body: `Hei ${p.user.name}! Du har ${unused!.n} ubrukte vervebonuser, som er maksimum. Derfor fikk du ikke ny bonus denne gangen. Bruk bonuser på en booking (opptil ${perBooking} per booking) for å kunne tjene nye.` }, c);
      continue;
    }
    const credit = await one<{ id: string; exp: string }>(
      `INSERT INTO reward_credits (user_id, referral_id, source, role_in_referral, amount_ore, remaining_amount_ore, vests_at, expires_at)
       VALUES ($1,$2,'referral',$3,$4,$4, now() + make_interval(days => $5), now() + make_interval(months => $6))
       ON CONFLICT DO NOTHING RETURNING id, to_char(expires_at AT TIME ZONE 'Europe/Oslo','DD.MM.YYYY') AS exp`, [p.user.id, ref.id, p.role, amount, vestDays, validMonths], c);
    if (!credit) continue;
    await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, booking_id, kind, amount_ore, note) VALUES ($1,$2,$3,'granted',0,$4)`,
      [p.user.id, credit.id, bookingId, `Vervebonus ${nok(amount)} – tilgjengelig om ${vestDays} dager, utløper ${credit.exp}`]);
    await audit(c, SYSTEM, 'reward.granted', 'reward_credit', credit.id, undefined, { amount, role: p.role, referral: ref.id });
    await enqueue({ userId: p.user.id, to: p.user.email, type: 'reward_granted', dedupeKey: `reward_granted:${credit.id}`,
      subject: `Du har fått ${nok(amount)} i vervebonus`,
      body: p.role === 'referrer'
        ? `Hei ${p.user.name}! ${referred.name} har fullført sitt første opphold. Du har fått ${nok(amount)} i bonus, som blir tilgjengelig om ${vestDays} dager.${rulesText(credit.exp, maxUnused, perBooking)}`
        : `Hei ${p.user.name}! Takk for oppholdet. Du har fått ${nok(amount)} i velkomstbonus, som blir tilgjengelig om ${vestDays} dager.${rulesText(credit.exp, maxUnused, perBooking)}` }, c);
  }
  return true;
}

const rulesText = (exp: string, max: number, per: number) =>
  `\n\nBonusen må brukes innen ${exp} (24 måneder etter at den ble opptjent), ellers utløper den. Du kan bruke opptil ${per} bonuser per booking, og ha maks ${max} ubrukte bonuser om gangen. Bonusen kan ikke tas ut i penger.`;

/** Uses up to N bonuses per booking (default 5), those that expire first. Never exceeds the amount due. */
export async function redeemForBooking(c: PoolClient, userId: string, bookingId: string, maxOre: number): Promise<number> {
  if (maxOre <= 0) return 0;
  if (await one(`SELECT 1 FROM reward_redemptions WHERE booking_id=$1 AND reversed_at IS NULL`, [bookingId], c)) return 0;
  const credits = await q<{ id: string; remaining_amount_ore: number }>(
    `SELECT id, remaining_amount_ore FROM reward_credits
     WHERE user_id=$1 AND status IN ('available','partially_used') AND expires_at > now() AND remaining_amount_ore > 0
     ORDER BY expires_at, granted_at LIMIT $2 FOR UPDATE`, [userId, await maxPerBooking(c)], c);
  let left = maxOre, used = 0;
  for (const cr of credits) {
    if (left <= 0) break;
    const take = Math.min(left, cr.remaining_amount_ore);
    await c.query(`UPDATE reward_credits SET remaining_amount_ore = remaining_amount_ore - $2,
                    status = CASE WHEN remaining_amount_ore - $2 = 0 THEN 'fully_used' ELSE 'partially_used' END WHERE id=$1`, [cr.id, take]);
    await c.query(`INSERT INTO reward_redemptions (reward_credit_id, booking_id, amount_applied_ore) VALUES ($1,$2,$3)`, [cr.id, bookingId, take]);
    await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, booking_id, kind, amount_ore, note) VALUES ($1,$2,$3,'redeemed',$4,'Brukt som rabatt')`,
      [userId, cr.id, bookingId, -take]);
    left -= take; used += take;
  }
  return used;
}

/** Gives credits back when a booking that used them is rejected/expired/cancelled. Idempotent via reversed_at. */
export async function reverseRedemptions(c: PoolClient, bookingId: string): Promise<number> {
  const rows = await q<{ id: string; reward_credit_id: string; amount_applied_ore: number; user_id: string }>(
    `UPDATE reward_redemptions rr SET reversed_at = now() FROM reward_credits rc
     WHERE rr.booking_id=$1 AND rr.reversed_at IS NULL AND rc.id = rr.reward_credit_id
     RETURNING rr.id, rr.reward_credit_id, rr.amount_applied_ore, rc.user_id`, [bookingId], c);
  let total = 0;
  for (const r of rows) {
    await c.query(`UPDATE reward_credits SET remaining_amount_ore = remaining_amount_ore + $2,
                    status = CASE WHEN status IN ('expired','revoked') THEN status
                                  WHEN remaining_amount_ore + $2 = amount_ore THEN 'available' ELSE 'partially_used' END WHERE id=$1`,
      [r.reward_credit_id, r.amount_applied_ore]);
    await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, booking_id, kind, amount_ore, note) VALUES ($1,$2,$3,'redemption_reversed',$4,'Bonus tilbakeført')`,
      [r.user_id, r.reward_credit_id, bookingId, r.amount_applied_ore]);
    total += r.amount_applied_ore;
  }
  return total;
}

export async function vestAndExpireRewards(): Promise<{ vested: number; expired: number }> {
  return tx(async c => {
    const vested = await q<{ id: string; user_id: string; remaining_amount_ore: number }>(
      `UPDATE reward_credits SET status='available' WHERE status='pending_vest' AND vests_at <= now() RETURNING id, user_id, remaining_amount_ore`, [], c);
    for (const v of vested) {
      await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, kind, amount_ore, note) VALUES ($1,$2,'vested',$3,'Bonus tilgjengelig')`, [v.user_id, v.id, v.remaining_amount_ore]);
      await audit(c, SYSTEM, 'reward.vested', 'reward_credit', v.id);
    }
    const expired = await q<{ id: string; user_id: string; remaining_amount_ore: number; prev: string }>(
      `UPDATE reward_credits SET status='expired' WHERE status IN ('pending_vest','available','partially_used') AND expires_at <= now()
       RETURNING id, user_id, remaining_amount_ore`, [], c);
    for (const e of expired) {
      await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, kind, amount_ore, note) VALUES ($1,$2,'expired',$3,'Bonus utløpt')`, [e.user_id, e.id, -e.remaining_amount_ore]);
      await audit(c, SYSTEM, 'reward.expired', 'reward_credit', e.id);
    }
    // Reminder 30 days before a bonus expires (once per bonus)
    const soon = await q<{ id: string; user_id: string; email: string; name: string; remaining_amount_ore: number; exp: string; lang: string | null }>(
      `UPDATE reward_credits rc SET expiry_reminded_at = now() FROM users u
       WHERE u.id = rc.user_id AND u.status='active' AND rc.status IN ('available','partially_used') AND rc.remaining_amount_ore > 0
         AND rc.expiry_reminded_at IS NULL AND rc.expires_at > now() AND rc.expires_at <= now() + interval '30 days'
       RETURNING rc.id, rc.user_id, u.email, u.name, rc.remaining_amount_ore, to_char(rc.expires_at AT TIME ZONE 'Europe/Oslo','DD.MM.YYYY') AS exp, u.preferred_lang AS lang`, [], c);
    for (const r of soon) {
      const en = r.lang === 'en';
      await enqueue({ userId: r.user_id, to: r.email, type: 'reward_expiring', dedupeKey: `reward_expiring:${r.id}`,
        subject: en ? `Your bonus of ${nok(r.remaining_amount_ore)} expires on ${r.exp}` : `Bonusen din på ${nok(r.remaining_amount_ore)} utløper ${r.exp}`,
        body: en ? `Hi ${r.name}!\n\nYou have a bonus of ${nok(r.remaining_amount_ore)} that expires on ${r.exp}. Book a stay before then and the bonus is deducted from the price. After that date it can no longer be used.`
                 : `Hei ${r.name}!\n\nDu har en bonus på ${nok(r.remaining_amount_ore)} som utløper ${r.exp}. Book et opphold før det, så trekkes bonusen fra prisen. Etter denne datoen kan den ikke lenger brukes.` }, c);
    }
    return { vested: vested.length, expired: expired.length };
  });
}

/** Admin: positive amount grants a manual credit; negative amount consumes balance FIFO. */
export async function adjustRewards(userId: string, amountOre: number, note: string, actor: Actor) {
  if (!Number.isInteger(amountOre) || amountOre === 0) throw new DomainError('bad_amount', 'Beløpet må være forskjellig fra 0.');
  if (!note.trim()) throw new DomainError('note_required', 'Skriv en begrunnelse.');
  await tx(async c => {
    if (amountOre > 0) {
      const cr = await one<{ id: string }>(
        `INSERT INTO reward_credits (user_id, source, amount_ore, remaining_amount_ore, vests_at, expires_at, status, note, granted_by_user_id)
         VALUES ($1,'manual_adjustment',$2,$2, now(), now() + make_interval(months => $3), 'available', $4, $5) RETURNING id`,
        [userId, amountOre, await validityMonths(c), note.trim(), actor.id], c);
      await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, kind, amount_ore, note, actor_user_id) VALUES ($1,$2,'adjusted',$3,$4,$5)`,
        [userId, cr!.id, amountOre, note.trim(), actor.id]);
      await audit(c, actor, 'reward.manual_credit', 'reward_credit', cr!.id, undefined, { amountOre, note });
    } else {
      const credits = await q<{ id: string; remaining_amount_ore: number }>(
        `SELECT id, remaining_amount_ore FROM reward_credits WHERE user_id=$1 AND status IN ('available','partially_used','pending_vest') AND remaining_amount_ore>0
         ORDER BY expires_at FOR UPDATE`, [userId], c);
      let left = -amountOre;
      const total = credits.reduce((s, x) => s + x.remaining_amount_ore, 0);
      if (total < left) throw new DomainError('insufficient', `Medlemmet har bare ${nok(total)} i bonus.`);
      for (const cr of credits) {
        if (left <= 0) break;
        const take = Math.min(left, cr.remaining_amount_ore);
        await c.query(`UPDATE reward_credits SET remaining_amount_ore=remaining_amount_ore-$2,
                        status = CASE WHEN remaining_amount_ore-$2=0 THEN 'fully_used' ELSE 'partially_used' END WHERE id=$1`, [cr.id, take]);
        await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, kind, amount_ore, note, actor_user_id) VALUES ($1,$2,'adjusted',$3,$4,$5)`,
          [userId, cr.id, -take, note.trim(), actor.id]);
        left -= take;
      }
      await audit(c, actor, 'reward.manual_debit', 'user', userId, undefined, { amountOre, note });
    }
  });
}

export async function revokeCredit(creditId: string, actor: Actor) {
  await tx(async c => {
    const cr = await one<{ user_id: string; status: string; remaining_amount_ore: number }>(
      'SELECT user_id, status, remaining_amount_ore FROM reward_credits WHERE id=$1 FOR UPDATE', [creditId], c);
    if (!cr) throw new DomainError('not_found', 'Fant ikke bonusen.');
    if (['revoked', 'expired', 'fully_used'].includes(cr.status)) throw new DomainError('not_revocable', 'Bonusen kan ikke trekkes tilbake.');
    await c.query(`UPDATE reward_credits SET status='revoked', revoked_by_user_id=$2, revoked_at=now() WHERE id=$1`, [creditId, actor.id]);
    await c.query(`INSERT INTO reward_transactions (user_id, reward_credit_id, kind, amount_ore, note, actor_user_id) VALUES ($1,$2,'revoked',$3,'Trukket tilbake av administrator',$4)`,
      [cr.user_id, creditId, -cr.remaining_amount_ore, actor.id]);
    await audit(c, actor, 'reward.revoked', 'reward_credit', creditId, { status: cr.status }, { status: 'revoked' });
  });
}
