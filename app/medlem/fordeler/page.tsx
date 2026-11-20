import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { loadBenefits } from '@/lib/domain/benefits';
import { BenefitCards } from '@/components/Benefits';
import { nok } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Medlemsfordeler' };

export default async function Benefits() {
  const u = await requireUser('request_booking');
  const b = await loadBenefits(u.id);
  const { disc, terms } = b;
  // Worked example: 3 nights at 2 000 kr + 1 200 kr cleaning
  const nightly = 200000, nights = 3, cleaning = 120000;
  const airbnbStay = nightly * nights, airbnbTotal = Math.round((airbnbStay + cleaning) * (1 + b.airbnbFeePct / 100));
  const fee = airbnbTotal - airbnbStay - cleaning;
  const baseDisc = Math.round(airbnbStay * disc.basePct / 100), loyDisc = Math.round(airbnbStay * disc.loyaltyPct / 100);
  const maxLoy = Math.round(airbnbStay * disc.loyaltyMaxPct / 100);
  const yours = airbnbStay - baseDisc - loyDisc + cleaning;
  const yoursMax = airbnbStay - baseDisc - maxLoy + cleaning;
  const steps = Array.from({ length: Math.round(disc.loyaltyMaxPct / Math.max(disc.stepPct, 0.0001)) + 1 }, (_, i) => i);
  const Line = ({ l, v, gold, total }: { l: string; v: number; gold?: boolean; total?: boolean }) => (
    <div className={total ? 'row price-total' : 'row'} style={{ justifyContent: 'space-between', color: gold ? 'var(--gold-2)' : undefined, padding: total ? undefined : '5px 0' }}><span>{l}</span><span>{v < 0 ? '−' : ''}{nok(Math.abs(v))}</span></div>);
  return (
    <>
      <div className="page-head"><span className="eyebrow">Medlemsfordeler</span><h1>Hva du sparer som medlem</h1>
        <p className="muted" style={{ maxWidth: '68ch' }}>Prisene på Mountain Retreat tar utgangspunkt i det samme oppholdet på Airbnb. Som medlem slipper du Airbnbs serviceavgift, du får en fast medlemsrabatt, rabatten øker for hver booking, og du kan bruke vervebonus i tillegg.</p></div>
      <BenefitCards {...b} />

      <div className="grid g2" style={{ marginTop: 28, alignItems: 'start' }}>
        <div className="card">
          <span className="eyebrow">Slik regnes prisen</span>
          <h3>Eksempel: {nights} netter à {nok(nightly)} + vask</h3>
          <div className="price-lines">
            <div className="kpi-label" style={{ marginBottom: 4 }}>På Airbnb</div>
            <Line l={`${nights} netter + vask`} v={airbnbStay + cleaning} />
            <Line l={`Serviceavgift (≈ ${b.airbnbFeePct} %)`} v={fee} />
            <Line l="Totalt på Airbnb" v={airbnbTotal} />
            <div className="kpi-label" style={{ margin: '14px 0 4px' }}>Hos oss</div>
            <Line l={`${nights} netter + vask`} v={airbnbStay + cleaning} />
            <Line gold l="Ingen serviceavgift" v={0} />
            <Line gold l={`Medlemsrabatt ${disc.basePct} % av nattprisen`} v={-baseDisc} />
            {loyDisc > 0 && <Line gold l={`Din lojalitetsrabatt ${disc.loyaltyPct} %`} v={-loyDisc} />}
            <Line total l="Din pris" v={yours} />
          </div>
          <div className="note" style={{ marginTop: 12 }}>Du sparer <strong style={{ color: 'var(--gold-2)' }}>{nok(airbnbTotal - yours)}</strong> ({Math.round((airbnbTotal - yours) / airbnbTotal * 100)} %) i dag. Med full lojalitetsrabatt ({disc.loyaltyMaxPct} %) sparer du {nok(airbnbTotal - yoursMax)} ({Math.round((airbnbTotal - yoursMax) / airbnbTotal * 100)} %) – før eventuell vervebonus.</div>
          <p className="muted" style={{ fontSize: '.82rem', marginTop: 10 }}>Rabattene gjelder nattprisen. Sluttrengjøring og tillegg betales fullt. Vervebonus trekkes fra totalbeløpet. Endelig pris låses når forespørselen godkjennes.</p>
        </div>
        <div className="stack">
          <div className="card">
            <span className="eyebrow">Lojalitetsrabatt</span>
            <h3>Starter på 0 %, +{disc.stepPct} % per booking, maks {disc.loyaltyMaxPct} %</h3>
            <p className="muted">Hver gjennomførte booking gir {disc.stepPct} prosentpoeng ekstra rabatt på alle fremtidige opphold. Kansellerte bookinger teller ikke.</p>
            <div className="row" style={{ gap: 6 }}>
              {steps.map(n => { const me = Math.min(disc.bookingsCounted, steps.length - 1) === n; return (
                <div key={n} style={{ flex: 1, minWidth: 34, textAlign: 'center', padding: '8px 0', borderRadius: 8, border: `1px solid ${me ? 'var(--gold)' : 'var(--line-2)'}`, background: n <= disc.bookingsCounted ? 'var(--gold-soft)' : 'transparent' }}>
                  <div style={{ fontSize: '.95rem', color: me ? 'var(--gold-2)' : 'var(--ink-2)' }}>{disc.basePct + Math.min(disc.loyaltyMaxPct, n * disc.stepPct)}%</div>
                  <small style={{ fontSize: '.62rem' }}>{n}{n === steps.length - 1 ? '+' : ''}</small></div>); })}
            </div>
            <small className="muted">Total medlemsrabatt etter antall bookinger (du har {disc.bookingsCounted}).</small>
          </div>
          <div className="card">
            <span className="eyebrow">Vervebonus</span>
            <h3>Dere får begge bonus</h3>
            <p className="muted">Når noen du inviterer fullfører sitt <strong>første</strong> opphold, får du {terms.referrer} og vedkommende {terms.referred}. Bonusen blir tilgjengelig etter noen dager og trekkes fra prisen på neste booking. Du kan ha opptil {b.maxUnused} ubrukte vervebonuser – bruk dem for å kunne tjene nye.</p>
            <Link className="btn" href="/medlem/invitasjoner">Inviter noen</Link>
          </div>
        </div>
      </div>
    </>
  );
}
