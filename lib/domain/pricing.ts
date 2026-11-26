import { Db, getPool, q, one } from '../db';
import { addDays, isoWeekday, nightsBetween } from '../format';
import { DomainError } from '../errors';
import { memberDiscount } from './memberDiscount';
import { getNum } from '../settings';

export type SeasonCategory = { id: string; kind: string; name: string; price_per_night_ore: number; weekend_price_per_night_ore?: number | null;
  min_nights: number; max_nights: number | null; color?: string | null };
export type PricingPeriod = { id: string; season_category_id: string; name: string; start_date: string; end_date: string;
  price_per_night_ore: number | null; weekend_price_per_night_ore?: number | null; min_nights: number | null; max_nights: number | null;
  booking_mode: 'flexible' | 'whole_period' | 'fixed_changeover_day'; changeover_weekday: number | null; priority: number };
export type LosDiscount = { season_category_id: string | null; min_nights: number; discount_percentage: number };
export type AddOnItem = { id: string; name: string; price_type: 'flat' | 'per_night' | 'per_unit' | 'per_guest'; unit_price_ore: number; mandatory: boolean };

export type PricingInput = {
  startDate: string; endDate: string; guests: number; maxGuests: number;
  categories: SeasonCategory[]; periods: PricingPeriod[]; losDiscounts: LosDiscount[];
  cleaningFeeOre: number; cleaningExempt?: boolean;
  /** Guests covered by the nightly price; extra guests pay extraGuestFeeOre per person (per stay or per night). */
  includedGuests?: number; extraGuestFeeOre?: number; extraGuestBasis?: 'per_stay' | 'per_night';
  /** Member's total discount % on the stay price (standard/override + loyalty). */
  memberDiscountPct?: number;
  /** Split of memberDiscountPct, for showing the member what each benefit is worth. */
  memberDiscountSplit?: { basePct: number; loyaltyPct: number };
  /** 'airbnb' = nightly price from externalRates (the listing's Airbnb price); 'manual' = season pricing. */
  pricingMode?: 'airbnb' | 'manual';
  externalRates?: Record<string, number>;
  defaultMinNights?: number;
  /** Airbnb guest service fee %, used to show what the same stay would cost on Airbnb. */
  airbnbGuestFeePct?: number;
  /** Airbnb's cleaning fee for the same listing (comparison only). Defaults to our cleaning fee. */
  airbnbCleaningFeeOre?: number | null;
  /** Guests bring their own bed linen: ownLinenDiscountOre off per guest (infants not counted). */
  ownLinen?: boolean; ownLinenDiscountOre?: number;
  addOns: AddOnItem[]; selectedAddOns: { id: string; quantity: number }[];
};

export type NightLine = { date: string; period: string; category: string; base_ore: number; member_discount_pct: number; los_discount_pct: number; price_ore: number };
export type Quote = {
  nights: number; nightLines: NightLine[]; stay_ore: number; cleaning_fee_ore: number;
  add_ons: { id: string; name: string; quantity: number; unit_price_ore: number; total_ore: number }[];
  add_ons_ore: number; subtotal_ore: number;
  extra_guests: number; extra_guest_fee_ore: number; extra_guest_unit_ore: number; extra_guest_basis: 'per_stay' | 'per_night'; included_guests: number;
  member_discount_pct: number; member_discount_ore: number;
  base_discount_ore: number; loyalty_discount_ore: number;
  pricing_mode: 'airbnb' | 'manual';
  /** What the same nights + cleaning would cost a guest on Airbnb (incl. service fee). */
  airbnb_comparison_ore: number; airbnb_fee_pct: number; airbnb_fee_saved_ore: number;
  airbnb_cleaning_fee_ore?: number;
  own_linen?: boolean; own_linen_discount_ore?: number; own_linen_unit_ore?: number;
  member_discount?: import('./memberDiscount').MemberDiscount;
};

const num = (v: unknown) => Number(v);

/** Friday and Saturday nights use the weekend price when one is set. A period's own price overrides the season's. */
export function nightPrice(date: string, p: Pick<PricingPeriod, 'price_per_night_ore' | 'weekend_price_per_night_ore'> | null, c: Pick<SeasonCategory, 'price_per_night_ore' | 'weekend_price_per_night_ore'>): number {
  const weekend = [5, 6].includes(isoWeekday(date));
  if (p && (p.price_per_night_ore != null || p.weekend_price_per_night_ore != null)) {
    const base = p.price_per_night_ore ?? c.price_per_night_ore;
    return weekend ? (p.weekend_price_per_night_ore ?? base) : base;
  }
  return weekend ? (c.weekend_price_per_night_ore ?? c.price_per_night_ore) : c.price_per_night_ore;
}

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

  const mode = input.pricingMode ?? 'manual';
  type Resolved = { date: string; p: PricingPeriod | null; c: SeasonCategory | null; label: string; price: number; min: number; max: number | null };
  const resolved: Resolved[] = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(startDate, i);
    const p = periodFor(date) ?? null;
    const c = p ? cats.get(p.season_category_id)! : null;
    if (mode === 'airbnb') {
      // Price follows Airbnb; periods (if any) still provide stay rules (min nights, whole period, changeover day)
      const rate = input.externalRates?.[date];
      if (!rate) throw new DomainError('unpriced', 'Pris er ikke tilgjengelig for noen av datoene ennå. Velg andre datoer eller kontakt oss.');
      resolved.push({ date, p, c, label: p?.name ?? 'Airbnb-pris', price: rate,
        min: p?.min_nights ?? c?.min_nights ?? input.defaultMinNights ?? 1, max: p?.max_nights ?? c?.max_nights ?? null });
    } else {
      if (!p || !c) throw new DomainError('unpriced', 'Noen av datoene er ikke åpne for booking.');
      resolved.push({ date, p, c, label: p.name, price: nightPrice(date, p, c), min: p.min_nights ?? c.min_nights, max: p.max_nights ?? c.max_nights });
    }
  }

  // Stay rules — evaluated from the check-in night's effective values
  const first = resolved[0];
  const when = first.c ? ` i ${first.c.name.toLowerCase()}` : '';
  if (nights < first.min) throw new DomainError('min_nights', `Minimum ${first.min} netter${when}.`);
  if (first.max && nights > first.max) throw new DomainError('max_nights', `Maksimum ${first.max} netter${when}.`);
  const touched = new Map(resolved.filter(r => r.p).map(r => [r.p!.id, r.p!]));
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
    const tiers = input.losDiscounts.filter(t => t.min_nights <= nights && (t.season_category_id === null || t.season_category_id === r.c?.id));
    const best = tiers.sort((a, b) => (b.min_nights - a.min_nights) || ((b.season_category_id ? 1 : 0) - (a.season_category_id ? 1 : 0)))[0];
    const losPct = best ? num(best.discount_percentage) : 0;
    const exact = r.price * (1 - memberPct / 100) * (1 - losPct / 100);
    stayExact += exact; undiscounted += r.price * (1 - losPct / 100);
    return { date: r.date, period: r.label, category: r.c?.name ?? 'Airbnb', base_ore: r.price, member_discount_pct: memberPct, los_discount_pct: losPct, price_ore: Math.round(exact) };
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
  const included = Math.max(1, input.includedGuests ?? input.maxGuests);
  const extra_guests = Math.max(0, input.guests - included);
  const basis = input.extraGuestBasis ?? 'per_stay';
  const extra_guest_fee_ore = extra_guests * (input.extraGuestFeeOre ?? 0) * (basis === 'per_night' ? nights : 1);
  const member_discount_ore = Math.round(undiscounted) - stay_ore;
  const split = input.memberDiscountSplit;
  const base_discount_ore = split && memberPct > 0 ? Math.round(member_discount_ore * split.basePct / memberPct) : member_discount_ore;
  const feePct = num(input.airbnbGuestFeePct ?? 0);
  const airbnbCleaning = input.airbnbCleaningFeeOre ?? input.cleaningFeeOre;
  const comparisonBase = Math.round(undiscounted) + airbnbCleaning + extra_guest_fee_ore;
  const linenUnit = input.ownLinenDiscountOre ?? 0;
  const own_linen = !!input.ownLinen && linenUnit > 0;
  const own_linen_discount_ore = own_linen ? linenUnit * input.guests : 0;
  const airbnb_comparison_ore = Math.round(comparisonBase * (1 + feePct / 100));
  return { nights, nightLines, stay_ore, cleaning_fee_ore, add_ons, add_ons_ore, subtotal_ore: stay_ore + cleaning_fee_ore + add_ons_ore + extra_guest_fee_ore - own_linen_discount_ore,
    extra_guests, extra_guest_fee_ore, extra_guest_unit_ore: input.extraGuestFeeOre ?? 0, extra_guest_basis: basis, included_guests: included,
    member_discount_pct: memberPct, member_discount_ore, base_discount_ore, loyalty_discount_ore: member_discount_ore - base_discount_ore,
    pricing_mode: mode, airbnb_comparison_ore, airbnb_fee_pct: feePct, airbnb_fee_saved_ore: airbnb_comparison_ore - comparisonBase,
    airbnb_cleaning_fee_ore: airbnbCleaning, own_linen, own_linen_discount_ore, own_linen_unit_ore: linenUnit };
}

export async function loadPricingContext(propertyId: string, db: Db = getPool()) {
  const property = await one<{ airbnb_cleaning_fee_ore: number | null; own_linen_discount_ore: number; id: string; max_guests: number; cleaning_fee_ore: number; active: boolean; name: string; pricing_mode: 'airbnb' | 'manual'; default_min_nights: number; included_guests: number; extra_guest_fee_ore: number; extra_guest_fee_basis: 'per_stay' | 'per_night' }>(
    'SELECT id, name, max_guests, cleaning_fee_ore, airbnb_cleaning_fee_ore, own_linen_discount_ore, active, pricing_mode, default_min_nights, included_guests, extra_guest_fee_ore, extra_guest_fee_basis FROM properties WHERE id = $1', [propertyId], db);
  if (!property || !property.active) throw new DomainError('not_found', 'Boligen finnes ikke.');
  // Sequential on purpose: db may be a single transaction client
  const categories = await 
    q<SeasonCategory>(`SELECT id, kind, name, color, price_per_night_ore, weekend_price_per_night_ore, min_nights, max_nights
                       FROM season_categories WHERE property_id=$1 AND active`, [propertyId], db);
  const periods = await q<PricingPeriod>(`SELECT id, season_category_id, name, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date,
                       price_per_night_ore, weekend_price_per_night_ore, min_nights, max_nights,
                       booking_mode, changeover_weekday, priority FROM pricing_periods WHERE property_id=$1 AND active`, [propertyId], db);
  const losDiscounts = await q<LosDiscount>(`SELECT season_category_id, min_nights, discount_percentage::float AS discount_percentage FROM length_of_stay_discounts WHERE property_id=$1 AND active`, [propertyId], db);
  const addOns = await q<AddOnItem>(`SELECT id, name, price_type, unit_price_ore, mandatory FROM add_on_items WHERE (property_id=$1 OR property_id IS NULL) AND active ORDER BY mandatory DESC, name`, [propertyId], db);
  const rates = property.pricing_mode === 'airbnb'
    ? Object.fromEntries((await q<{ d: string; price_ore: number }>(`SELECT to_char(date,'YYYY-MM-DD') AS d, price_ore FROM external_nightly_rates WHERE property_id=$1 AND date >= current_date - 1`, [propertyId], db)).map(r => [r.d, r.price_ore]))
    : {};
  const airbnbFee = await getNum('airbnb_guest_fee_pct', 15, db);
  return { property, categories, periods, losDiscounts, addOns, rates, airbnbFee };
}

export async function isCleaningExempt(userId: string, propertyId: string, db: Db = getPool()) {
  return !!(await one(`SELECT 1 FROM member_cleaning_exemptions WHERE user_id=$1 AND active AND (property_id IS NULL OR property_id=$2)`, [userId, propertyId], db));
}

export async function quoteFor(propertyId: string, memberId: string, startDate: string, endDate: string, guests: number,
  selectedAddOns: { id: string; quantity: number }[], db: Db = getPool(), excludeBookingId?: string | null, ownLinen?: boolean): Promise<Quote> {
  const ctx = await loadPricingContext(propertyId, db);
  if (ownLinen === undefined && excludeBookingId) ownLinen = !!(await one(`SELECT 1 FROM bookings WHERE id=$1 AND own_linen`, [excludeBookingId], db));
  const discount = await memberDiscount(memberId, db, excludeBookingId);
  const quote = computeQuote({
    startDate, endDate, guests, maxGuests: ctx.property.max_guests,
    categories: ctx.categories, periods: ctx.periods, losDiscounts: ctx.losDiscounts,
    cleaningFeeOre: ctx.property.cleaning_fee_ore, cleaningExempt: (await isCleaningExempt(memberId, propertyId, db)) || (!!excludeBookingId && !!(await one(`SELECT 1 FROM bookings WHERE id=$1 AND cleaning_self`, [excludeBookingId], db))),
    addOns: ctx.addOns, selectedAddOns, memberDiscountPct: discount.totalPct,
    memberDiscountSplit: { basePct: discount.basePct, loyaltyPct: discount.loyaltyPct },
    includedGuests: ctx.property.included_guests, extraGuestFeeOre: ctx.property.extra_guest_fee_ore, extraGuestBasis: ctx.property.extra_guest_fee_basis,
    pricingMode: ctx.property.pricing_mode, externalRates: ctx.rates, defaultMinNights: ctx.property.default_min_nights, airbnbGuestFeePct: ctx.airbnbFee,
    airbnbCleaningFeeOre: ctx.property.airbnb_cleaning_fee_ore, ownLinen: !!ownLinen, ownLinenDiscountOre: ctx.property.own_linen_discount_ore,
  });
  return { ...quote, member_discount: discount };
}
