import Link from 'next/link';
import { nok } from '@/lib/format';
import type { MemberDiscount } from '@/lib/domain/memberDiscount';

/** The three member benefits, shown on the dashboard and the benefits page. */
export function BenefitCards({ disc, balance, pending, invited, qualified, terms }: {
  disc: MemberDiscount; balance: number; pending: number; invited: number; qualified: number; terms: { referrer: string; referred: string };
}) {
  const steps = Math.round(disc.loyaltyMaxPct / Math.max(disc.stepPct, 0.0001));
  const done = Math.min(steps, disc.bookingsCounted);
  return (
    <div className="grid g3">
      <div className="card kpi-card">
        <span className="kpi-label">Din medlemsrabatt</span>
        <div className="kpi" style={{ color: 'var(--gold-2)' }}>{disc.totalPct} %</div>
        <small>{disc.basePct} % {disc.baseIsOverride ? 'personlig' : 'standard'} + {disc.loyaltyPct} % lojalitet</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">Lojalitetsrabatt</span>
        <div className="kpi">{disc.loyaltyPct} <span style={{ fontSize: '1.2rem', color: 'var(--muted)' }}>/ {disc.loyaltyMaxPct} %</span></div>
        <div style={{ display: 'flex', gap: 4, margin: '8px 0 6px' }}>
          {Array.from({ length: steps }, (_, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < done ? 'var(--gold)' : 'var(--line-2)' }} />)}
        </div>
        <small>{disc.atMax ? 'Maks oppnådd – takk for at du kommer tilbake!' : `+${disc.stepPct} % for hver booking. Neste booking: ${disc.nextTotalPct} %.`}</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">Opptjent bonus</span>
        <div className="kpi" style={{ color: 'var(--gold-2)' }}>{nok(balance)}</div>
        <small>{pending > 0 ? `${nok(pending)} blir tilgjengelig snart · ` : ''}{invited} invitert, {qualified} med fullført opphold</small><br />
        <small>Inviter: du får {terms.referrer}, vennen {terms.referred}. <Link href="/medlem/invitasjoner">Inviter →</Link></small>
      </div>
    </div>
  );
}
