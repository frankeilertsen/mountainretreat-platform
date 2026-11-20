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
