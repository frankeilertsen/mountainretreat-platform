import { Db, getPool, q, one } from '../db';
import { addDays, isoWeekday, nightsBetween } from '../format';
import { DomainError } from '../errors';
import { memberDiscount } from './memberDiscount';

export type SeasonCategory = { id: string; kind: string; name: string; price_per_night_ore: number;
  min_nights: number; max_nights: number | null; color?: string | null };
export type PricingPeriod = { id: string; season_category_id: string; name: string; start_date: string; end_date: string;
  price_per_night_ore: number | null; min_nights: number | null; max_nights: number | null;
  booking_mode: 'flexible' | 'whole_period' | 'fixed_changeover_day'; changeover_weekday: number | null; priority: number };
export type LosDiscount = { season_category_id: string | null; min_nights: number; discount_percentage: number };
export type AddOnItem = { id: string; name: string; price_type: 'flat' | 'per_night' | 'per_unit' | 'per_guest'; unit_price_ore: number; mandatory: boolean };

export type PricingInput = {
  startDate: string; endDate: string; guests: number; maxGuests: number;
  categories: SeasonCategory[]; periods: PricingPeriod[]; losDiscounts: LosDiscount[];
  cleaningFeeOre: number; cleaningExempt?: boolean;
  /** Member's total discount % on the stay price (standard/override + loyalty). */
  memberDiscountPct?: number;
  addOns: AddOnItem[]; selectedAddOns: { id: string; quantity: number }[];
};

export type NightLine = { date: string; period: string; category: string; base_ore: number; member_discount_pct: number; los_discount_pct: number; price_ore: number };
export type Quote = {
  nights: number; nightLines: NightLine[]; stay_ore: number; cleaning_fee_ore: number;
  add_ons: { id: string; name: string; quantity: number; unit_price_ore: number; total_ore: number }[];
  add_ons_ore: number; subtotal_ore: number;
  member_discount_pct: number; member_discount_ore: number;
  member_discount?: import('./memberDiscount').MemberDiscount;
};

const num = (v: unknown) => Number(v);

/** Pure price + stay-rule engine (spec §12a). All arithmetic in øre; rounded once at the end. Throws DomainError on rule violations. */
export function computeQuote(input: PricingInput): Quote {
  const { startDate, endDate } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new DomainError('bad_dates', 'Ugyldige datoer.');
  const nights = nightsBetween(startDate, endDate);
  if (nights < 1) throw new DomainError('bad_dates', 'Utreise må være etter innreise.');
  if (nights > 60) throw new DomainError('too_long', 'Maksimalt 60 netter per booking.');
  if (input.guests < 1) throw new DomainError('bad_guests', 'Minst én gjest.');
  if (input.guests > input.maxGuests) throw new DomainError('too_many_guests', `Maks ${input.maxGuests} gjester i denne boligen.`);

  const cats = new Map(input.categories.map(c => [c.id, c]));
  const periodFor = (date: string) => input.periods
    .filter(p => p.start_date <= date && p.end_date >= date && cats.has(p.season_category_id))
    .sort((a, b) => b.priority - a.priority)[0];

  type Resolved = { date: string; p: PricingPeriod; c: SeasonCategory; price: number; min: number; max: number | null };
  const resolved: Resolved[] = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(startDate, i);
    const p = periodFor(date);
    if (!p) throw new DomainError('unpriced', 'Noen av datoene er ikke åpne for booking.');
    const c = cats.get(p.season_category_id)!;
    resolved.push({
      date, p, c,
      price: p.price_per_night_ore ?? c.price_per_night_ore,
      min: p.min_nights ?? c.min_nights,
      max: p.max_nights ?? c.max_nights,
    });
  }

  // Stay rules — evaluated from the check-in night's effective values
  const first = resolved[0];
  if (nights < first.min) throw new DomainError('min_nights', `Minimum ${first.min} netter i ${first.c.name.toLowerCase()}.`);
  if (first.max && nights > first.max) throw new DomainError('max_nights', `Maksimum ${first.max} netter i ${first.c.name.toLowerCase()}.`);
  const touched = new Map(resolved.map(r => [r.p.id, r.p]));
  for (const p of touched.values()) {
    if (p.booking_mode === 'whole_period') {
      const pEndExclusive = addDays(p.end_date, 1);
      if (startDate !== p.start_date || endDate !== pEndExclusive) {
        throw new DomainError('whole_period', `${p.name} må bookes som hel periode (${p.start_date} – ${pEndExclusive}).`);
      }
    }
    if (p.booking_mode === 'fixed_changeover_day' && p.changeover_weekday) {
      const names = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
      const checks = [startDate, endDate].filter(d => d >= p.start_date && d <= addDays(p.end_date, 1));
      if (checks.some(d => isoWeekday(d) !== p.changeover_weekday)) {
        throw new DomainError('changeover', `I perioden ${p.name} er byttedag ${names[p.changeover_weekday]}.`);
      }
    }
  }

  // Price: night × (1 − member%) × (1 − LOS tier%) — discounts multiply, never add
  const memberPct = Math.min(100, Math.max(0, num(input.memberDiscountPct ?? 0)));
  let stayExact = 0, undiscounted = 0;
  const nightLines: NightLine[] = resolved.map(r => {
    const tiers = input.losDiscounts.filter(t => t.min_nights <= nights && (t.season_category_id === null || t.season_category_id === r.c.id));
    const best = tiers.sort((a, b) => (b.min_nights - a.min_nights) || ((b.season_category_id ? 1 : 0) - (a.season_category_id ? 1 : 0)))[0];
    const losPct = best ? num(best.discount_percentage) : 0;
    const exact = r.price * (1 - memberPct / 100) * (1 - losPct / 100);
    stayExact += exact; undiscounted += r.price * (1 - losPct / 100);
    return { date: r.date, period: r.p.name, category: r.c.name, base_ore: r.price, member_discount_pct: memberPct, los_discount_pct: losPct, price_ore: Math.round(exact) };
  });
  const stay_ore = Math.round(stayExact);

  const selected = new Map(input.selectedAddOns.map(s => [s.id, Math.max(1, Math.floor(s.quantity || 1))]));
  const add_ons = input.addOns
    .filter(a => a.mandatory || selected.has(a.id))
    .map(a => {
      const qty = a.price_type === 'per_unit' ? (selected.get(a.id) ?? 1) : 1;
      const mult = a.price_type === 'per_night' ? nights : a.price_type === 'per_guest' ? input.guests : qty;
      return { id: a.id, name: a.name, quantity: a.price_type === 'per_unit' ? qty : 1, unit_price_ore: a.unit_price_ore, total_ore: a.unit_price_ore * mult };
    });
  const add_ons_ore = add_ons.reduce((s, a) => s + a.total_ore, 0);
  const cleaning_fee_ore = input.cleaningExempt ? 0 : input.cleaningFeeOre;
  return { nights, nightLines, stay_ore, cleaning_fee_ore, add_ons, add_ons_ore, subtotal_ore: stay_ore + cleaning_fee_ore + add_ons_ore,
    member_discount_pct: memberPct, member_discount_ore: Math.round(undiscounted) - stay_ore };
}

export async function loadPricingContext(propertyId: string, db: Db = getPool()) {
  const property = await one<{ id: string; max_guests: number; cleaning_fee_ore: number; active: boolean; name: string }>(
    'SELECT id, name, max_guests, cleaning_fee_ore, active FROM properties WHERE id = $1', [propertyId], db);
  if (!property || !property.active) throw new DomainError('not_found', 'Boligen finnes ikke.');
  // Sequential on purpose: db may be a single transaction client
  const categories = await 
    q<SeasonCategory>(`SELECT id, kind, name, color, price_per_night_ore, min_nights, max_nights
                       FROM season_categories WHERE property_id=$1 AND active`, [propertyId], db);
  const periods = await q<PricingPeriod>(`SELECT id, season_category_id, name, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date,
                       price_per_night_ore, min_nights, max_nights,
                       booking_mode, changeover_weekday, priority FROM pricing_periods WHERE property_id=$1 AND active`, [propertyId], db);
  const losDiscounts = await q<LosDiscount>(`SELECT season_category_id, min_nights, discount_percentage::float AS discount_percentage FROM length_of_stay_discounts WHERE property_id=$1 AND active`, [propertyId], db);
  const addOns = await q<AddOnItem>(`SELECT id, name, price_type, unit_price_ore, mandatory FROM add_on_items WHERE (property_id=$1 OR property_id IS NULL) AND active ORDER BY mandatory DESC, name`, [propertyId], db);
  return { property, categories, periods, losDiscounts, addOns };
}

export async function isCleaningExempt(userId: string, propertyId: string, db: Db = getPool()) {
  return !!(await one(`SELECT 1 FROM member_cleaning_exemptions WHERE user_id=$1 AND active AND (property_id IS NULL OR property_id=$2)`, [userId, propertyId], db));
}

export async function quoteFor(propertyId: string, memberId: string, startDate: string, endDate: string, guests: number,
  selectedAddOns: { id: string; quantity: number }[], db: Db = getPool(), excludeBookingId?: string | null): Promise<Quote> {
  const ctx = await loadPricingContext(propertyId, db);
  const discount = await memberDiscount(memberId, db, excludeBookingId);
  const quote = computeQuote({
    startDate, endDate, guests, maxGuests: ctx.property.max_guests,
    categories: ctx.categories, periods: ctx.periods, losDiscounts: ctx.losDiscounts,
    cleaningFeeOre: ctx.property.cleaning_fee_ore, cleaningExempt: await isCleaningExempt(memberId, propertyId, db),
    addOns: ctx.addOns, selectedAddOns, memberDiscountPct: discount.totalPct,
  });
  return { ...quote, member_discount: discount };
}
