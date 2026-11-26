import { pctL } from '@/lib/format';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { loadBenefits } from '@/lib/domain/benefits';
import { BenefitCards } from '@/components/Benefits';
import { getT } from '@/lib/i18n/lang';
import { nokL } from '@/lib/i18n/format';
import { listPresentations } from '@/lib/domain/presentations';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Medlemsfordeler' };

export default async function Benefits() {
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const B = t.benefits;
  const nok = (o: number) => nokL(o, lang);
  const b = await loadBenefits(u.id, lang);
  const presentations = await listPresentations({ activeOnly: true });
  const { disc, terms } = b;
  // Worked example: 3 nights at 2 000 kr + 1 200 kr cleaning
  const nightly = 300000, nights = 3, cleaning = b.cleaning?.airbnb ?? 125000, ourCleaning = b.cleaning?.ours ?? cleaning;
  const airbnbStay = nightly * nights, airbnbTotal = Math.round((airbnbStay + cleaning) * (1 + b.airbnbFeePct / 100));
  const fee = airbnbTotal - airbnbStay - cleaning;
  const baseDisc = Math.round(airbnbStay * disc.basePct / 100), loyDisc = Math.round(airbnbStay * disc.loyaltyPct / 100);
  const maxLoy = Math.round(airbnbStay * disc.loyaltyMaxPct / 100);
  const yours = airbnbStay - baseDisc - loyDisc + ourCleaning;
  const yoursMax = airbnbStay - baseDisc - maxLoy + ourCleaning;
  const steps = Array.from({ length: Math.ceil(disc.loyaltyMaxPct / Math.max(disc.stepPct, 0.0001) - 1e-9) + 1 }, (_, i) => i);
  const Line = ({ l, v, gold, total }: { l: string; v: number; gold?: boolean; total?: boolean }) => (
    <div className={total ? 'row price-total' : 'row'} style={{ justifyContent: 'space-between', color: gold ? 'var(--gold-2)' : undefined, padding: total ? undefined : '5px 0' }}><span>{l}</span><span>{v < 0 ? '−' : ''}{nok(Math.abs(v))}</span></div>);
  return (
    <>
      <div className="page-head"><span className="eyebrow">{B.pageEyebrow}</span><h1>{B.pageTitle}</h1>
        <p className="muted" style={{ maxWidth: '68ch' }}>{B.pageLead}</p></div>
      <BenefitCards {...b} lang={lang} />

      <div className="grid g2" style={{ marginTop: 28, alignItems: 'start' }}>
        <div className="card">
          <span className="eyebrow">{B.calcEyebrow}</span>
          <h3>{B.calcTitle(nights, nok(nightly))}</h3>
          <div className="price-lines">
            <div className="kpi-label" style={{ marginBottom: 4 }}>{B.onAirbnb}</div>
            <Line l={B.nightsCleaning(nights)} v={airbnbStay + cleaning} />
            {fee > 0 && <Line l={B.serviceFee(b.airbnbFeePct)} v={fee} />}
            <Line l={B.totalAirbnb} v={airbnbTotal} />
            <div className="kpi-label" style={{ margin: '14px 0 4px' }}>{B.withUs}</div>
            <Line l={B.nightsCleaning(nights)} v={airbnbStay + ourCleaning} />
            {fee > 0 && <Line gold l={B.noServiceFee} v={0} />}
            <Line gold l={B.memberDisc(disc.basePct)} v={-baseDisc} />
            {loyDisc > 0 && <Line gold l={B.yourLoyalty(disc.loyaltyPct)} v={-loyDisc} />}
            <Line total l={B.yourPrice} v={yours} />
          </div>
          <div className="note" style={{ marginTop: 12 }}>{B.savedNow(nok(airbnbTotal - yours), Math.round((airbnbTotal - yours) / airbnbTotal * 100), disc.loyaltyMaxPct, nok(airbnbTotal - yoursMax), Math.round((airbnbTotal - yoursMax) / airbnbTotal * 100))}</div>
          <p className="muted" style={{ fontSize: '.82rem', marginTop: 10 }}>{B.calcNote}</p>
        </div>
        <div className="stack">
          <div className="card">
            <span className="eyebrow">{B.loyalty}</span>
            <h3>{B.loyaltyTitle(disc.stepPct, disc.loyaltyMaxPct)}</h3>
            <p className="muted">{B.loyaltyText(disc.stepPct)}</p>
            <div className="row" style={{ gap: 6 }}>
              {steps.map(n => { const me = Math.min(disc.bookingsCounted, steps.length - 1) === n; return (
                <div key={n} style={{ flex: 1, minWidth: 34, textAlign: 'center', padding: '8px 0', borderRadius: 8, border: `1px solid ${me ? 'var(--gold)' : 'var(--line-2)'}`, background: n <= disc.bookingsCounted ? 'var(--gold-soft)' : 'transparent' }}>
                  <div style={{ fontSize: '.95rem', color: me ? 'var(--gold-2)' : 'var(--ink-2)' }}>{pctL(disc.basePct + Math.min(disc.loyaltyMaxPct, n * disc.stepPct), lang)}%</div>
                  <small style={{ fontSize: '.62rem' }}>{n}{n === steps.length - 1 ? '+' : ''}</small></div>); })}
            </div>
            <small className="muted">{B.ladderNote(disc.bookingsCounted)}</small>
          </div>
          <div className="card">
            <span className="eyebrow">{B.referral}</span>
            <h3>{B.refTitle}</h3>
            <p className="muted">{B.refText(terms.referrer, terms.referred, b.maxUnused)}</p>
            <Link className="btn" href="/medlem/invitasjoner">{B.inviteCta}</Link>
          </div>
        </div>
      </div>
      {presentations.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <span className="eyebrow">{B.presTitle}</span>
          <p className="muted">{B.presText}</p>
          {presentations.map(p => (
            <div key={p.id} className="row between" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <span><span className="pdf-ico" style={{ display: 'inline-grid', width: 32, height: 38, marginRight: 12, verticalAlign: 'middle' }}>PDF</span>{p.title}{p.property_name ? <small className="muted"> · {p.property_name}</small> : null}</span>
              <span className="row"><a className="btn ghost small" href={`/api/presentasjoner/${p.id}`} target="_blank" rel="noopener">{B.open}</a><a className="btn secondary small" href={`/api/presentasjoner/${p.id}?last-ned`}>{B.download}</a></span>
            </div>))}
        </div>)}
    </>
  );
}
