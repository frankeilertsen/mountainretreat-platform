import { Db, getPool, one } from '../db';
import { getNum, getStr } from '../settings';

/**
 * Member discount on the stay price (not cleaning fee / add-ons):
 *   total = base (platform standard, or the member's individual override)
 *         + loyalty (grows per booking made, following the loyalty steps, capped at max %)
 * Loyalty steps: one increment per booking, e.g. "1;1;1;1;1;1.5;1.5;1.5;1.5;2;2" (= 15 % after 11 bookings).
 * If no steps are set, the uniform step % per booking is used.
 * "Booking made" = the member's bookings that are confirmed / completed (cancelled ones don't count).
 */
export type MemberDiscount = {
  /** Base discount in low and high season. */
  basePct: number; baseIsOverride: boolean; standardPct: number;
  /** Base discount in holiday periods (season kind 'holiday'). */
  holidayBasePct: number;
  /** Loyalty also applies in holiday periods? */
  loyaltyInHoliday: boolean;
  /** Extra launch-campaign discount for bookings made in the campaign window (all seasons). */
  launchPct: number; launchUntil: string | null;
  /** Total discount never exceeds this (per night). */
  capPct: number;
  /** Total in holiday periods. */
  holidayTotalPct: number;
  bookingsCounted: number;
  /** Increment the NEXT booking gives (0 when the maximum is reached). */
  stepPct: number;
  /** One increment per booking. */
  steps: number[];
  /** Loyalty % after 0, 1, 2 … bookings, up to the maximum. */
  ladder: number[];
  loyaltyMaxPct: number; loyaltyPct: number;
  totalPct: number; nextTotalPct: number; atMax: boolean;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export function parseSteps(raw: string | null | undefined): number[] {
  return String(raw ?? '').split(/[;\s]+/).map(x => Number(x.replace(',', '.'))).filter(x => Number.isFinite(x) && x > 0);
}

export async function loyaltySettings(db: Db = getPool()) {
  const step = await getNum('member_loyalty_step_pct', 1, db);
  const max = await getNum('member_loyalty_max_pct', 10, db);
  const steps = parseSteps(await getStr('member_loyalty_steps', '', db));
  return { step, max, steps };
}

export type DiscountExtras = { holidayBasePct?: number | null; loyaltyInHoliday?: boolean; launchPct?: number; launchUntil?: string | null; capPct?: number };

/** Launch campaign: extra % for bookings made (requested) between from and to (Oslo dates, inclusive). */
export async function launchFor(at: Date, db: Db = getPool()) {
  const pct = await getNum('launch_discount_pct', 0, db);
  const from = await getStr('launch_discount_from', '', db), to = await getStr('launch_discount_to', '', db);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(at);
  return pct > 0 && from && to && day >= from && day <= to ? { pct, until: to } : { pct: 0, until: null };
}

/** at = when the booking is/was made (affects the launch campaign). For an existing booking pass its id as excludeBookingId: its own request time is used. */
export async function memberDiscount(userId: string, db: Db = getPool(), excludeBookingId?: string | null, at?: Date): Promise<MemberDiscount> {
  const standard = await getNum('member_base_discount_pct', 5, db);
  const holidayStd = await getNum('member_holiday_discount_pct', standard, db);
  const cap = await getNum('member_discount_cap_pct', 100, db);
  const loyaltyInHoliday = (await getNum('member_loyalty_in_holiday', 1, db)) === 1;
  const { step, max, steps } = await loyaltySettings(db);
  const row = await one<{ override: string | null; n: number; made: Date | null }>(
    `SELECT u.member_discount_override_pct AS override,
            (SELECT count(*) FROM bookings b WHERE b.member_id=u.id AND b.status IN ('confirmed','completed','cancellation_requested') AND b.id IS DISTINCT FROM $2)::int AS n,
            (SELECT created_at FROM bookings WHERE id=$2) AS made
     FROM users u WHERE u.id=$1`, [userId, excludeBookingId ?? null], db);
  const override = row?.override == null ? null : Number(row.override);
  const launch = await launchFor(at ?? row?.made ?? new Date(), db);
  return computeMemberDiscount(standard, override, row?.n ?? 0, steps.length ? steps : step, max,
    { holidayBasePct: override ?? holidayStd, loyaltyInHoliday, launchPct: launch.pct, launchUntil: launch.until, capPct: cap });
}

/** The parts of the discount for one night of the given season kind, after the cap (launch is trimmed first, then loyalty). */
export function discountForKind(d: MemberDiscount, kind: string | null | undefined) {
  const holiday = kind === 'holiday';
  const base = holiday ? d.holidayBasePct : d.basePct;
  const loyalty = holiday && !d.loyaltyInHoliday ? 0 : d.loyaltyPct;
  const cap = Math.max(0, Math.min(100, d.capPct));
  const b = Math.min(base, cap), l = Math.min(loyalty, cap - b), x = Math.min(d.launchPct, cap - b - l);
  return { base: round2(b), loyalty: round2(l), launch: round2(x), total: round2(b + l + x) };
}

/** stepsOrStep: a list with one increment per booking, or one uniform increment. */
export function computeMemberDiscount(standardPct: number, overridePct: number | null, bookings: number, stepsOrStep: number | number[], maxPct: number, extras: DiscountExtras = {}): MemberDiscount {
  const uniform = typeof stepsOrStep === 'number';
  const stepAt = (i: number) => uniform ? (stepsOrStep as number) : ((stepsOrStep as number[])[i] ?? 0);
  const ladder = [0];
  for (let i = 0; ladder[ladder.length - 1] < maxPct && i < 200; i++) {
    const s = stepAt(i); if (s <= 0) break;
    ladder.push(round2(Math.min(maxPct, ladder[ladder.length - 1] + s)));
  }
  const top = ladder[ladder.length - 1];
  const at = (n: number) => ladder[Math.min(n, ladder.length - 1)];
  const loyaltyPct = at(bookings), nextLoyalty = at(bookings + 1);
  const basePct = overridePct ?? standardPct;
  const clamp = (v: number) => round2(Math.min(100, Math.max(0, v)));
  const steps = ladder.slice(1).map((v, i) => round2(v - ladder[i]));
  const capPct = extras.capPct ?? 100, launchPct = extras.launchPct ?? 0;
  const holidayBasePct = extras.holidayBasePct ?? basePct, loyaltyInHoliday = extras.loyaltyInHoliday ?? true;
  const capped = (v: number) => clamp(Math.min(capPct, v));
  return {
    basePct, baseIsOverride: overridePct != null, standardPct, holidayBasePct, loyaltyInHoliday, launchPct, launchUntil: extras.launchUntil ?? null, capPct,
    bookingsCounted: bookings, stepPct: round2(nextLoyalty - loyaltyPct), steps, ladder,
    loyaltyMaxPct: top, loyaltyPct, totalPct: capped(basePct + loyaltyPct + launchPct), nextTotalPct: capped(basePct + nextLoyalty + launchPct), atMax: loyaltyPct >= top,
    holidayTotalPct: capped(holidayBasePct + (loyaltyInHoliday ? loyaltyPct : 0) + launchPct),
  };
}

/** "1 % for each of the first 5 bookings, 1.5 % for the next 4 and 2 % for the last 2" */
export function describeSteps(steps: number[], lang: 'no' | 'en' = 'no'): string {
  const fmt = (n: number) => n.toLocaleString(lang === 'en' ? 'en-GB' : 'nb-NO', { maximumFractionDigits: 2 });
  const groups: { v: number; n: number }[] = [];
  for (const s of steps) { const g = groups[groups.length - 1]; if (g && g.v === s) g.n++; else groups.push({ v: s, n: 1 }); }
  if (groups.length === 1) return lang === 'en' ? `${fmt(groups[0].v)} % per booking` : `${fmt(groups[0].v)} % per booking`;
  const parts = groups.map((g, i) => {
    const which = i === 0 ? (lang === 'en' ? `the first ${g.n}` : `de ${g.n} første`) : i === groups.length - 1 ? (lang === 'en' ? `the last ${g.n}` : `de ${g.n} siste`) : (lang === 'en' ? `the next ${g.n}` : `de neste ${g.n}`);
    return i === 0 ? (lang === 'en' ? `${fmt(g.v)} % per booking for ${which}` : `${fmt(g.v)} % per booking for ${which}`) : `${fmt(g.v)} % ${lang === 'en' ? 'for' : 'for'} ${which}`;
  });
  return parts.slice(0, -1).join(', ') + (lang === 'en' ? ' and ' : ' og ') + parts[parts.length - 1];
}
