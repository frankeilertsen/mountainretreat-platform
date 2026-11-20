import Link from 'next/link';
import { nok } from '@/lib/format';
import type { MemberDiscount } from '@/lib/domain/memberDiscount';

export type BenefitData = {
  disc: MemberDiscount; airbnbFeePct: number; balance: number; pending: number; invited: number; qualified: number;
  terms: { referrer: string; referred: string }; unusedBonuses: number; maxUnused: number;
};

/** The four member benefits, shown on the dashboard and the benefits page. */
export function BenefitCards(d: BenefitData) {
  const { disc } = d;
  const steps = Math.round(disc.loyaltyMaxPct / Math.max(disc.stepPct, 0.0001));
  const done = Math.min(steps, disc.bookingsCounted);
  return (
    <div className="grid g4">
      <div className="card kpi-card">
        <span className="kpi-label">Ingen Airbnb-avgift</span>
        <div className="kpi">≈ {d.airbnbFeePct} %</div>
        <small>Du betaler ikke Airbnbs serviceavgift når du booker her.</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">Medlemsrabatt</span>
        <div className="kpi" style={{ color: 'var(--gold-2)' }}>{disc.basePct} %</div>
        <small>{disc.baseIsOverride ? 'Personlig rabatt' : 'Fast for alle medlemmer'}, i tillegg til at avgiften faller bort.</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">Lojalitetsrabatt</span>
        <div className="kpi">{disc.loyaltyPct} <span style={{ fontSize: '1.2rem', color: 'var(--muted)' }}>/ {disc.loyaltyMaxPct} %</span></div>
        <div style={{ display: 'flex', gap: 3, margin: '8px 0 6px' }}>
          {Array.from({ length: steps }, (_, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < done ? 'var(--gold)' : 'var(--line-2)' }} />)}
        </div>
        <small>{disc.atMax ? 'Maks oppnådd – takk for at du kommer tilbake!' : `Starter på 0 %, +${disc.stepPct} % per booking. Neste: ${disc.nextTotalPct - disc.basePct} %.`}</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">Vervebonus</span>
        <div className="kpi" style={{ color: 'var(--gold-2)' }}>{nok(d.balance)}</div>
        <small>{d.pending > 0 ? `${nok(d.pending)} på vei · ` : ''}{d.unusedBonuses}/{d.maxUnused} ubrukte bonuser. Du får {d.terms.referrer} per venn som fullfører sitt første opphold. <Link href="/medlem/invitasjoner">Inviter →</Link></small>
      </div>
    </div>
  );
}
