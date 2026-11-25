import { describe, it, expect } from 'vitest';
import { computeQuote, PricingInput } from '../lib/domain/pricing';

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  startDate: '2027-07-03', endDate: '2027-07-10', guests: 4, maxGuests: 8,
  categories: [
    { id: 'high', kind: 'high_season', name: 'Høysesong', price_per_night_ore: 250000, min_nights: 4, max_nights: null },
    { id: 'hol', kind: 'holiday', name: 'Ferie', price_per_night_ore: 320000, min_nights: 3, max_nights: null },
  ],
  periods: [{ id: 'p1', season_category_id: 'high', name: 'Sommer', start_date: '2027-06-01', end_date: '2027-08-31', price_per_night_ore: null, min_nights: null, max_nights: null, booking_mode: 'flexible', changeover_weekday: null, priority: 0 }],
  losDiscounts: [{ season_category_id: null, min_nights: 7, discount_percentage: 10 }],
  cleaningFeeOre: 120000, addOns: [], selectedAddOns: [], memberDiscountPct: 10, ...over,
});

describe('price engine (spec §12a)', () => {
  it('matches the spec example: 7 nights × 2 500 × 0.9 × 0.9 = 14 175 kr', () => {
    const q = computeQuote(base());
    expect(q.nights).toBe(7);
    expect(q.stay_ore).toBe(1417500);
    expect(q.subtotal_ore).toBe(1417500 + 120000);
  });
  it('rejects stays shorter than the minimum', () => {
    expect(() => computeQuote(base({ endDate: '2027-07-06' }))).toThrow(/Minimum 4 netter/);
  });
  it('rejects unpriced dates instead of pricing them at zero', () => {
    expect(() => computeQuote(base({ startDate: '2027-09-01', endDate: '2027-09-06' }))).toThrow(/ikke åpne/);
  });
  it('enforces whole-period holiday blocks', () => {
    const periods = [...base().periods, { id: 'easter', season_category_id: 'hol', name: 'Påske', start_date: '2027-07-05', end_date: '2027-07-08', price_per_night_ore: null, min_nights: null, max_nights: null, booking_mode: 'whole_period' as const, changeover_weekday: null, priority: 10 }];
    expect(() => computeQuote(base({ periods }))).toThrow(/hel periode/);
    const q = computeQuote(base({ periods, startDate: '2027-07-05', endDate: '2027-07-09' }));
    expect(q.stay_ore).toBe(4 * 320000 * 0.9);
  });
  it('enforces fixed changeover weekday', () => {
    const periods = [{ ...base().periods[0], booking_mode: 'fixed_changeover_day' as const, changeover_weekday: 6 }];
    expect(() => computeQuote(base({ periods, startDate: '2027-07-04', endDate: '2027-07-11' }))).toThrow(/byttedag lørdag/);
    expect(computeQuote(base({ periods })).nights).toBe(7); // 3 Jul 2027 is a Saturday
  });
  it('rejects too many guests and prices add-ons per guest / per night / per unit', () => {
    expect(() => computeQuote(base({ guests: 9 }))).toThrow(/Maks 8/);
    const q = computeQuote(base({
      addOns: [
        { id: 'linen', name: 'Sengetøy', price_type: 'per_guest', unit_price_ore: 15000, mandatory: true },
        { id: 'wood', name: 'Ved', price_type: 'per_unit', unit_price_ore: 12000, mandatory: false },
        { id: 'sauna', name: 'Badstue', price_type: 'per_night', unit_price_ore: 10000, mandatory: false },
      ], selectedAddOns: [{ id: 'wood', quantity: 3 }],
    }));
    expect(q.add_ons_ore).toBe(4 * 15000 + 3 * 12000); // sauna not selected
  });
  it('applies the member discount to the stay only, never to cleaning or add-ons', () => {
    const none = computeQuote(base({ memberDiscountPct: 0 }));
    const q = computeQuote(base({ memberDiscountPct: 15 }));
    expect(none.stay_ore).toBe(7 * 250000 * 0.9);           // only LOS 10 %
    expect(q.stay_ore).toBe(Math.round(7 * 250000 * 0.85 * 0.9));
    expect(q.cleaning_fee_ore).toBe(120000);
    expect(q.member_discount_ore).toBe(none.stay_ore - q.stay_ore);
  });
  it('waives the cleaning fee for exempt members', () => {
    expect(computeQuote(base({ cleaningExempt: true })).cleaning_fee_ore).toBe(0);
  });
});

describe('Airbnb-linked pricing', () => {
  const airbnb = (over: Partial<PricingInput> = {}) => computeQuote(base({
    pricingMode: 'airbnb', periods: [], categories: [], losDiscounts: [], defaultMinNights: 2, airbnbGuestFeePct: 15,
    externalRates: { '2027-01-10': 200000, '2027-01-11': 200000, '2027-01-12': 250000 },
    startDate: '2027-01-10', endDate: '2027-01-13', memberDiscountPct: 13, memberDiscountSplit: { basePct: 10, loyaltyPct: 3 }, ...over,
  }));
  it('uses the Airbnb nightly price, then member + loyalty discount, and shows the Airbnb comparison incl. fee', () => {
    const q = airbnb();
    expect(q.pricing_mode).toBe('airbnb');
    expect(q.stay_ore).toBe(Math.round(650000 * 0.87));
    expect(q.base_discount_ore).toBe(65000);
    expect(q.loyalty_discount_ore).toBe(19500);
    expect(q.airbnb_comparison_ore).toBe(Math.round((650000 + 120000) * 1.15));
    expect(q.airbnb_fee_saved_ore).toBe(Math.round((650000 + 120000) * 0.15));
  });
  it('refuses dates without an Airbnb price and applies the default minimum stay', () => {
    expect(() => airbnb({ endDate: '2027-01-14' })).toThrow(/ikke tilgjengelig/);
    expect(() => airbnb({ endDate: '2027-01-11' })).toThrow(/Minimum 2/);
  });
});

describe('extra guests', () => {
  it('price covers N guests; each extra guest pays the fee (per stay or per night), not discounted, and counted in the Airbnb comparison', () => {
    const four = computeQuote(base({ guests: 4, includedGuests: 4, extraGuestFeeOre: 35000 }));
    expect(four.extra_guest_fee_ore).toBe(0);
    const six = computeQuote(base({ guests: 6, includedGuests: 4, extraGuestFeeOre: 35000 }));
    expect(six.extra_guests).toBe(2);
    expect(six.extra_guest_fee_ore).toBe(70000);
    expect(six.subtotal_ore - four.subtotal_ore).toBe(70000);
    const perNight = computeQuote(base({ guests: 5, includedGuests: 4, extraGuestFeeOre: 35000, extraGuestBasis: 'per_night' }));
    expect(perNight.extra_guest_fee_ore).toBe(35000 * 7);
    const withFee = computeQuote(base({ guests: 6, includedGuests: 4, extraGuestFeeOre: 35000, airbnbGuestFeePct: 15 }));
    expect(withFee.airbnb_comparison_ore).toBe(Math.round((7 * 250000 * 0.9 + 120000 + 70000) * 1.15));
  });
});

describe('weekend prices and season painting', () => {
  it('Friday and Saturday nights use the weekend price; a period price overrides the season', async () => {
    const { computeQuote } = await import('../lib/domain/pricing');
    const cat = { id: 'c', kind: 'low_season', name: 'Lavsesong', price_per_night_ore: 275000, weekend_price_per_night_ore: 300000, min_nights: 2, max_nights: null };
    const period = { id: 'p', season_category_id: 'c', name: 'Lav', start_date: '2027-06-01', end_date: '2027-06-30', price_per_night_ore: null, weekend_price_per_night_ore: null, min_nights: null, max_nights: null, booking_mode: 'flexible' as const, changeover_weekday: null, priority: 0 };
    const base = { guests: 2, maxGuests: 6, categories: [cat], losDiscounts: [], cleaningFeeOre: 0, addOns: [], selectedAddOns: [], pricingMode: 'manual' as const };
    // Thu 10 → Sun 13 June 2027: Thu, Fri, Sat nights
    const q1 = computeQuote({ ...base, periods: [period], startDate: '2027-06-10', endDate: '2027-06-13' });
    expect(q1.nightLines.map(n => n.base_ore)).toEqual([275000, 300000, 300000]);
    const q2 = computeQuote({ ...base, periods: [{ ...period, price_per_night_ore: 400000 }], startDate: '2027-06-10', endDate: '2027-06-13' });
    expect(q2.nightLines.map(n => n.base_ore)).toEqual([400000, 400000, 400000]);
  });

  it('painting a range trims, splits and merges periods', async () => {
    const { property } = await import('./factory');
    const { paintSeason } = await import('../lib/domain/seasons');
    const { q, one } = await import('../lib/db');
    const pid = await property();
    const cats = await q<{ id: string; kind: string }>(`SELECT id, kind FROM season_categories WHERE property_id=$1`, [pid]);
    const low = cats.find(c => c.kind === 'low_season')?.id ?? (await one<{ id: string }>(`INSERT INTO season_categories (property_id, kind, name, price_per_night_ore) VALUES ($1,'low_season','Lav',100000) RETURNING id`, [pid]))!.id;
    const hol = cats.find(c => c.kind === 'holiday')?.id ?? (await one<{ id: string }>(`INSERT INTO season_categories (property_id, kind, name, price_per_night_ore) VALUES ($1,'holiday','Ferie',200000) RETURNING id`, [pid]))!.id;
    const list = () => q<{ s: string; e: string; k: string }>(`SELECT to_char(start_date,'YYYY-MM-DD') s, to_char(end_date,'YYYY-MM-DD') e, sc.kind k FROM pricing_periods pp JOIN season_categories sc ON sc.id=pp.season_category_id WHERE pp.property_id=$1 AND pp.active AND start_date >= '2030-01-01' ORDER BY start_date`, [pid]);
    await paintSeason(pid, '2030-01-01', '2030-01-31', low);
    await paintSeason(pid, '2030-01-10', '2030-01-12', hol);
    expect(await list()).toEqual([{ s: '2030-01-01', e: '2030-01-09', k: 'low_season' }, { s: '2030-01-10', e: '2030-01-12', k: 'holiday' }, { s: '2030-01-13', e: '2030-01-31', k: 'low_season' }]);
    await paintSeason(pid, '2030-01-10', '2030-01-12', low);
    expect(await list()).toEqual([{ s: '2030-01-01', e: '2030-01-31', k: 'low_season' }]);
    await paintSeason(pid, '2030-01-31', '2030-01-31', null);
    expect(await list()).toEqual([{ s: '2030-01-01', e: '2030-01-30', k: 'low_season' }]);
  });
});
