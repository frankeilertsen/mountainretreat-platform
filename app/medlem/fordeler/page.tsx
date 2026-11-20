import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { rewardBalance } from '@/lib/domain/rewards';
import { memberDiscount } from '@/lib/domain/memberDiscount';
import { invitationsWithOutcome, rewardTerms } from '@/lib/domain/memberOverview';
import { BenefitCards } from '@/components/Benefits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Medlemsfordeler' };

export default async function Benefits() {
  const u = await requireUser('request_booking');
  const [disc, bal, invites, terms] = await Promise.all([memberDiscount(u.id), rewardBalance(u.id), invitationsWithOutcome(u.id), rewardTerms()]);
  const steps = Array.from({ length: Math.round(disc.loyaltyMaxPct / Math.max(disc.stepPct, 0.0001)) + 1 }, (_, i) => i);
  return (
    <>
      <div className="page-head"><span className="eyebrow">Medlemsfordeler</span><h1>Tre fordeler som medlem</h1>
        <p className="muted" style={{ maxWidth: '64ch' }}>Som medlem av Mountain Retreat får du rabatterte priser, rabatten øker for hver booking, og du får bonus når du inviterer venner og familie.</p></div>
      <BenefitCards disc={disc} balance={bal.available} pending={bal.pending} invited={invites.length} qualified={invites.filter(i => i.stage === 'qualified').length} terms={terms} />
      <div className="grid g3" style={{ marginTop: 28, alignItems: 'start' }}>
        <div className="card">
          <span className="eyebrow">1 · Rabatterte priser</span>
          <h3>{disc.basePct} % på alle opphold</h3>
          <p className="muted">Alle medlemmer får {disc.standardPct} % rabatt på overnattingsprisen.{disc.baseIsOverride ? ` Du har en personlig rabatt på ${disc.basePct} %.` : ''} Rabatten gjelder overnatting – ikke sluttrengjøring og tillegg.</p>
        </div>
        <div className="card">
          <span className="eyebrow">2 · Lojalitetsrabatt</span>
          <h3>+{disc.stepPct} % per booking, opptil {disc.loyaltyMaxPct} %</h3>
          <p className="muted">For hver booking du gjennomfører øker rabatten med {disc.stepPct} prosentpoeng, til du har {disc.loyaltyMaxPct} % ekstra. Kansellerte bookinger teller ikke.</p>
          <div className="table-wrap"><table><thead><tr><th>Bookinger</th><th>Din rabatt</th></tr></thead><tbody>
            {steps.map(n => { const tot = Math.min(100, disc.basePct + Math.min(disc.loyaltyMaxPct, n * disc.stepPct)); const me = Math.min(n, steps.length - 1) === Math.min(disc.bookingsCounted, steps.length - 1);
              return <tr key={n} style={me ? { outline: '1px solid var(--gold-line)' } : undefined}><td>{n}{n === steps.length - 1 ? '+' : ''}{me ? <span className="badge b-warn" style={{ marginLeft: 8 }}>Du er her</span> : null}</td><td style={{ color: me ? 'var(--gold-2)' : undefined }}>{tot} %</td></tr>; })}
          </tbody></table></div>
        </div>
        <div className="card">
          <span className="eyebrow">3 · Verdi for å invitere</span>
          <h3>Dere får begge bonus</h3>
          <p className="muted">Når noen du inviterer fullfører sitt <strong>første</strong> opphold, får du {terms.referrer} og vedkommende {terms.referred} i bonus. Bonusen blir tilgjengelig etter {terms.vestingDays} dager og trekkes fra prisen på neste booking. Senere opphold gir ikke ny vervebonus.</p>
          <Link className="btn" href="/medlem/invitasjoner">Inviter noen</Link>
        </div>
      </div>
    </>
  );
}
