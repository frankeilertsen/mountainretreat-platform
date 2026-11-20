import { nok } from '@/lib/format';
import type { Quote } from '@/lib/domain/pricing';

/**
 * Shows the member exactly how their price is built and what they save compared to booking the same stay on Airbnb.
 * Works for both live quotes and stored (locked) quotes from older bookings.
 */
export function SavingsBreakdown({ quote, rewardOre = 0, rewardEstimated = false, compact = false }: { quote: Quote; rewardOre?: number; rewardEstimated?: boolean; compact?: boolean }) {
  const q = quote as Partial<Quote> & Quote;
  const ordinaryStay = q.stay_ore + (q.member_discount_ore ?? 0);
  const fee = q.airbnb_fee_saved_ore ?? 0;
  const comparison = q.airbnb_comparison_ore ?? ordinaryStay + q.cleaning_fee_ore;
  const yourStayAndCleaning = q.stay_ore + q.cleaning_fee_ore - rewardOre;
  const saved = Math.max(0, comparison - yourStayAndCleaning);
  const savedPct = comparison > 0 ? Math.round(saved / comparison * 100) : 0;
  const base = q.base_discount_ore ?? q.member_discount_ore ?? 0, loyalty = q.loyalty_discount_ore ?? 0;
  const loyaltyPct = q.member_discount?.loyaltyPct, basePct = q.member_discount?.basePct;
  const Row = ({ l, v, gold, strong }: { l: React.ReactNode; v: string; gold?: boolean; strong?: boolean }) =>
    <div className="row" style={{ color: gold ? 'var(--gold-2)' : undefined, fontWeight: strong ? 600 : undefined }}><span>{l}</span><span>{v}</span></div>;
  const Sub = ({ children }: { children: React.ReactNode }) => <div className="kpi-label" style={{ marginTop: 14, marginBottom: 4 }}>{children}</div>;
  return (
    <div className="price-lines">
      {fee > 0 && <>
        <Sub>Samme opphold på Airbnb</Sub>
        <Row l={`${q.nights} netter`} v={nok(ordinaryStay)} />
        <Row l="Sluttrengjøring" v={nok(q.cleaning_fee_ore)} />
        <Row l={`Airbnbs serviceavgift (${q.airbnb_fee_pct} %)`} v={nok(fee)} />
        <Row strong l="Totalt på Airbnb" v={nok(comparison)} />
        <Sub>Din pris som medlem</Sub>
      </>}
      <Row l={<>{q.nights} netter{q.pricing_mode === 'airbnb' ? ' til Airbnb-pris' : ', ordinær pris'}</>} v={nok(ordinaryStay)} />
      {base > 0 && <Row gold l={`Medlemsrabatt${basePct != null ? ` ${basePct} %` : ''}`} v={`−${nok(base)}`} />}
      {loyalty > 0 && <Row gold l={`Lojalitetsrabatt${loyaltyPct != null ? ` ${loyaltyPct} %` : ''}`} v={`−${nok(loyalty)}`} />}
      <Row l="Sluttrengjøring" v={nok(q.cleaning_fee_ore)} />
      {fee > 0 && <Row gold l="Ingen serviceavgift" v="0 kr" />}
      {!compact && q.add_ons?.map(a => <Row key={a.id} l={`${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ''}`} v={nok(a.total_ore)} />)}
      {rewardOre > 0 && <Row gold l={`Vervebonus${rewardEstimated ? ' (trekkes ved godkjenning)' : ''}`} v={`−${nok(rewardOre)}`} />}
      <div className="row price-total"><span>Din pris</span><span>{nok(q.subtotal_ore - rewardOre)}</span></div>
      {saved > 0 && (
        <div className="note" style={{ marginTop: 12 }}>
          Du sparer <strong style={{ color: 'var(--gold-2)' }}>{nok(saved)}</strong> ({savedPct} %) sammenlignet med å booke samme opphold på Airbnb{fee > 0 ? ` – ${nok(fee)} i avgift, ${nok(base + loyalty)} i rabatter${rewardOre ? ` og ${nok(rewardOre)} i bonus` : ''}` : ''}.
        </div>
      )}
    </div>
  );
}
