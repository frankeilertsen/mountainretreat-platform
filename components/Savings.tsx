import { dict, type Lang } from '@/lib/i18n/dict';
import { nokL } from '@/lib/i18n/format';
import type { Quote } from '@/lib/domain/pricing';

/**
 * Shows the member exactly how their price is built and what they save compared to booking the same stay on Airbnb.
 * Works for both live quotes and stored (locked) quotes from older bookings.
 */
export function SavingsBreakdown({ quote, rewardOre = 0, rewardEstimated = false, compact = false, lang = 'no' }: { quote: Quote; rewardOre?: number; rewardEstimated?: boolean; compact?: boolean; lang?: Lang }) {
  const S = dict[lang].savings;
  const nok = (o: number) => nokL(o, lang);
  const q = quote as Partial<Quote> & Quote;
  const ordinaryStay = q.stay_ore + (q.member_discount_ore ?? 0);
  const fee = q.airbnb_fee_saved_ore ?? 0;
  const comparison = q.airbnb_comparison_ore ?? ordinaryStay + q.cleaning_fee_ore + (q.extra_guest_fee_ore ?? 0);
  const linen = q.own_linen_discount_ore ?? 0;
  const yourStayAndCleaning = q.stay_ore + q.cleaning_fee_ore + (q.extra_guest_fee_ore ?? 0) - linen - rewardOre;
  const saved = Math.max(0, comparison - yourStayAndCleaning);
  const savedPct = comparison > 0 ? Math.round(saved / comparison * 100) : 0;
  const base = q.base_discount_ore ?? q.member_discount_ore ?? 0, loyalty = q.loyalty_discount_ore ?? 0, launch = q.launch_discount_ore ?? 0;
  // Season-aware quotes carry the % per night: show "20 %" or "20 % / 15 % i ferie"
  const lines = (q.nightLines ?? []).filter(n => n.base_pct != null);
  const uniq = (xs: number[]) => [...new Set(xs)];
  const normBase = uniq(lines.filter(n => n.season_kind !== 'holiday').map(n => n.base_pct!)), holBase = uniq(lines.filter(n => n.season_kind === 'holiday').map(n => n.base_pct!));
  const baseLabel = lines.length ? S.memberDiscMixed(normBase[0] ?? null, holBase[0] ?? null) : S.memberDisc(q.member_discount?.basePct);
  const loyPcts = uniq(lines.filter(n => (n.loyalty_pct ?? 0) > 0).map(n => n.loyalty_pct!));
  const loyaltyLabel = S.loyaltyDisc(loyPcts[0] ?? q.member_discount?.loyaltyPct) + (holBase.length && loyalty > 0 && !q.member_discount?.loyaltyInHoliday ? S.notInHoliday : '');
  const launchPct = uniq(lines.filter(n => (n.launch_pct ?? 0) > 0).map(n => n.launch_pct!))[0];
  const Row = ({ l, v, gold, strong }: { l: React.ReactNode; v: string; gold?: boolean; strong?: boolean }) =>
    <div className="row" style={{ color: gold ? 'var(--gold-2)' : undefined, fontWeight: strong ? 600 : undefined }}><span>{l}</span><span>{v}</span></div>;
  const Sub = ({ children }: { children: React.ReactNode }) => <div className="kpi-label" style={{ marginTop: 14, marginBottom: 4 }}>{children}</div>;
  return (
    <div className="price-lines">
      {comparison > ordinaryStay + q.cleaning_fee_ore + (q.extra_guest_fee_ore ?? 0) - 1 || fee > 0 ? <>
        <Sub>{S.sameOnAirbnb}</Sub>
        <Row l={S.nights(q.nights)} v={nok(ordinaryStay)} />
        <Row l={S.cleaning} v={nok(q.airbnb_cleaning_fee_ore ?? q.cleaning_fee_ore)} />
        {q.extra_guest_fee_ore > 0 && <Row l={S.extraGuests(q.extra_guests)} v={nok(q.extra_guest_fee_ore)} />}
        {fee > 0 && <Row l={S.airbnbFee(q.airbnb_fee_pct)} v={nok(fee)} />}
        <Row strong l={S.totalAirbnb} v={nok(comparison)} />
        <Sub>{S.yourPriceAsMember}</Sub>
      </> : null}
      <Row l={q.pricing_mode === 'airbnb' ? S.nightsAirbnb(q.nights) : S.nightsOrdinary(q.nights)} v={nok(ordinaryStay)} />
      {base > 0 && <Row gold l={baseLabel} v={`−${nok(base)}`} />}
      {loyalty > 0 && <Row gold l={loyaltyLabel} v={`−${nok(loyalty)}`} />}
      {launch > 0 && <Row gold l={S.launchDisc(launchPct)} v={`−${nok(launch)}`} />}
      <Row l={S.cleaning} v={nok(q.cleaning_fee_ore)} />
      {q.extra_guest_fee_ore > 0 && <Row l={<>{S.extraGuests(q.extra_guests)} <small className="muted">{S.extraGuestsDetail(q.extra_guests, nok(q.extra_guest_unit_ore), q.extra_guest_basis === 'per_night' ? q.nights : null, q.included_guests)}</small></>} v={nok(q.extra_guest_fee_ore)} />}
      {linen > 0 && <Row gold l={S.ownLinen(Math.round(linen / (q.own_linen_unit_ore || linen)), nok(q.own_linen_unit_ore ?? linen))} v={`−${nok(linen)}`} />}
      {fee > 0 && <Row gold l={S.noFee} v={nok(0)} />}
      {!compact && q.add_ons?.map(a => <Row key={a.id} l={`${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ''}`} v={nok(a.total_ore)} />)}
      {rewardOre > 0 && <Row gold l={`${S.bonus}${rewardEstimated ? S.bonusEstimated : ''}`} v={`−${nok(rewardOre)}`} />}
      <div className="row price-total"><span>{S.yourPrice}</span><span>{nok(q.subtotal_ore - rewardOre)}</span></div>
      {saved > 0 && (
        <div className="note" style={{ marginTop: 12 }}>
          {S.youSave(nok(saved), savedPct)}{saved > 0 ? S.breakdown(fee > 0 ? nok(fee) : null, nok(base + loyalty + launch + linen + Math.max(0, (q.airbnb_cleaning_fee_ore ?? q.cleaning_fee_ore) - q.cleaning_fee_ore)), rewardOre ? nok(rewardOre) : null) : ''}.
        </div>
      )}
    </div>
  );
}
