import { Db, getPool, one } from '../db';
import { getNum } from '../settings';

/**
 * Member discount on the stay price (not cleaning fee / add-ons):
 *   total = base (platform standard, or the member's individual override)
 *         + loyalty (step % per booking made, capped at max %)
 * "Booking made" = the member's bookings that are confirmed / completed (cancelled ones don't count).
 */
export type MemberDiscount = {
  basePct: number; baseIsOverride: boolean; standardPct: number;
  bookingsCounted: number; stepPct: number; loyaltyMaxPct: number; loyaltyPct: number;
  totalPct: number; nextTotalPct: number; atMax: boolean;
};

export async function memberDiscount(userId: string, db: Db = getPool(), excludeBookingId?: string | null): Promise<MemberDiscount> {
  const standard = await getNum('member_base_discount_pct', 5, db);
  const step = await getNum('member_loyalty_step_pct', 1, db);
  const max = await getNum('member_loyalty_max_pct', 10, db);
  const row = await one<{ override: string | null; n: number }>(
    `SELECT u.member_discount_override_pct AS override,
            (SELECT count(*) FROM bookings b WHERE b.member_id=u.id AND b.status IN ('confirmed','completed','cancellation_requested') AND b.id IS DISTINCT FROM $2)::int AS n
     FROM users u WHERE u.id=$1`, [userId, excludeBookingId ?? null], db);
  return computeMemberDiscount(standard, row?.override == null ? null : Number(row.override), row?.n ?? 0, step, max);
}

export function computeMemberDiscount(standardPct: number, overridePct: number | null, bookings: number, stepPct: number, maxPct: number): MemberDiscount {
  const basePct = overridePct ?? standardPct;
  const loyaltyPct = Math.min(maxPct, bookings * stepPct);
  const nextLoyalty = Math.min(maxPct, (bookings + 1) * stepPct);
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return {
    basePct, baseIsOverride: overridePct != null, standardPct, bookingsCounted: bookings, stepPct, loyaltyMaxPct: maxPct, loyaltyPct,
    totalPct: clamp(basePct + loyaltyPct), nextTotalPct: clamp(basePct + nextLoyalty), atMax: loyaltyPct >= maxPct,
  };
}
