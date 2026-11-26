import { pctL } from '@/lib/format';
import Link from 'next/link';
import type { MemberDiscount } from '@/lib/domain/memberDiscount';
import { dict, type Lang } from '@/lib/i18n/dict';
import { nokL } from '@/lib/i18n/format';

export type BenefitData = {
  disc: MemberDiscount; airbnbFeePct: number; cleaning?: { ours: number; airbnb: number; linen: number } | null; balance: number; pending: number; invited: number; qualified: number;
  terms: { referrer: string; referred: string }; unusedBonuses: number; maxUnused: number; perBooking?: number;
};

/** The four member benefits, shown on the dashboard and the benefits page. */
export function BenefitCards(d: BenefitData & { lang?: Lang }) {
  const lang = d.lang ?? 'no';
  const B = dict[lang].benefits;
  const { disc } = d;
  const steps = disc.ladder.length - 1;
  const done = Math.min(steps, disc.bookingsCounted);
  return (
    <>
    {disc.launchPct > 0 && disc.launchUntil && <div className="card launch-banner" style={{ marginBottom: 16 }}><strong>{B.launchTitle(disc.launchPct)}</strong> {B.launchText(disc.launchPct, disc.launchUntil, disc.capPct)}</div>}
    <div className="grid g4">
      {d.airbnbFeePct > 0 ? <div className="card kpi-card">
        <span className="kpi-label">{B.noFee}</span>
        <div className="kpi">≈ {d.airbnbFeePct} %</div>
        <small>{B.noFeeText}</small>
      </div> : d.cleaning && <div className="card kpi-card">
        <span className="kpi-label">{B.cleaningTitle}</span>
        <div className="kpi">{nokL(d.cleaning.ours, lang)}</div>
        <small>{B.cleaningText(nokL(d.cleaning.airbnb, lang), d.cleaning.linen ? nokL(d.cleaning.linen, lang) : null)}</small>
      </div>}
      <div className="card kpi-card">
        <span className="kpi-label">{B.member}</span>
        <div className="kpi" style={{ color: 'var(--gold-2)' }}>{pctL(disc.basePct, lang)} %</div>
        <small>{disc.baseIsOverride ? B.memberPersonal : B.memberFixed}{disc.holidayBasePct !== disc.basePct ? B.memberHoliday(disc.basePct, disc.holidayBasePct) : ''}{B.memberSuffix}</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">{B.loyalty}</span>
        <div className="kpi">{pctL(disc.loyaltyPct, lang)} <span style={{ fontSize: '1.2rem', color: 'var(--muted)' }}>/ {disc.loyaltyMaxPct} %</span></div>
        <div style={{ display: 'flex', gap: 3, margin: '8px 0 6px' }}>
          {Array.from({ length: steps }, (_, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < done ? 'var(--gold)' : 'var(--line-2)' }} />)}
        </div>
        <small>{disc.atMax ? B.loyaltyMax : B.loyaltyNext(disc.stepPct, disc.loyaltyPct + disc.stepPct)}{!disc.loyaltyInHoliday ? B.loyaltyScope : ''}</small>
      </div>
      <div className="card kpi-card">
        <span className="kpi-label">{B.referral}</span>
        <div className="kpi" style={{ color: 'var(--gold-2)' }}>{nokL(d.balance, lang)}</div>
        <small>{B.referralText(d.pending > 0 ? nokL(d.pending, lang) : null, d.unusedBonuses, d.maxUnused, d.terms.referrer)} <Link href="/medlem/invitasjoner">{B.invite}</Link></small>
      </div>
    </div>
    </>
  );
}
