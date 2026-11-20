import { requireUser } from '@/lib/auth/current';
import { can } from '@/lib/auth/rbac';
import { invitationsWithOutcome, rewardTerms, STAGE_LABEL } from '@/lib/domain/memberOverview';
import { fmtDate, nok } from '@/lib/format';
import { getSettings } from '@/lib/settings';
import { Flash, Empty } from '@/components/ui';
import { inviteAction, revokeMyInvitationAction, applyLoyaltyAction } from '../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inviter' };

export default async function Invitations({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const list = await invitationsWithOutcome(u.id);
  const s = await getSettings();
  const terms = await rewardTerms();
  const earned = list.reduce((t, i) => t + (i.reward_ore ?? 0), 0);
  const mayInvite = can(u as any, 'invite');
  return (
    <>
      <div className="page-head"><span className="eyebrow">Venner og familie</span><h1>Inviter</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>Når noen du inviterer fullfører sitt første opphold, får du {terms.referrer} og vedkommende {terms.referred} i bonus til neste booking. Kun det første oppholdet gir bonus.</p></div>
      <Flash sp={sp} />
      <div className="grid split-1-2" style={{ alignItems: 'start' }}>
        <div className="card">
          {mayInvite ? (
            <form action={inviteAction}>
              <h3>Send invitasjon</h3>
              <div className="field"><label>Navn</label><input name="name" /></div>
              <div className="field"><label>E-post</label><input type="email" name="email" required /></div>
              <button className="btn">Send invitasjon</button>
              <p className="muted" style={{ fontSize: '.82rem', marginTop: 12 }}>Lenken er personlig, kan brukes én gang og utløper etter {s.invitation_validity_days} dager.</p>
            </form>
          ) : u.loyalty_status === 'applied' ? (
            <><h3>Søknaden behandles</h3><p className="muted">Du får beskjed når du kan invitere andre.</p></>
          ) : (
            <><h3>Vil du invitere andre?</h3><p className="muted">Medlemmer som selv er invitert av et annet medlem må få medlemskapet godkjent for invitasjoner.</p>
              {can(u as any, 'apply_loyalty') && <form action={applyLoyaltyAction}><button className="btn secondary">Søk om å kunne invitere</button></form>}</>
          )}
        </div>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Dine invitasjoner</h3>{earned > 0 && <span style={{ color: 'var(--gold-2)' }}>Opptjent: {nok(earned)}</span>}</div>
          {list.length === 0 ? <Empty>Du har ikke invitert noen ennå.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>Person</th><th>Sendt</th><th>Status</th><th>Bonus</th><th></th></tr></thead><tbody>
              {list.map(i => (
                <tr key={i.id}><td>{i.member_name ?? i.invitee_name ?? i.invitee_email}{i.member_name && <><br /><small className="muted">{i.invitee_email}</small></>}</td>
                  <td><small>{fmtDate(i.created_at)}</small></td>
                  <td><span className={`badge ${STAGE_LABEL[i.stage][1]}`}>{STAGE_LABEL[i.stage][0]}</span>{i.completed_stays > 1 && <><br /><small className="muted">{i.completed_stays} opphold (kun første gir bonus)</small></>}</td>
                  <td>{i.reward_ore ? <span style={{ color: 'var(--gold-2)' }}>+{nok(i.reward_ore)}</span> : i.stage === 'booked' || i.stage === 'member_no_booking' ? <small className="muted">{terms.referrer} ventes</small> : '–'}</td>
                  <td>{i.status === 'pending' && <form action={revokeMyInvitationAction}><input type="hidden" name="id" value={i.id} /><button className="btn ghost small">Trekk tilbake</button></form>}</td></tr>))}
            </tbody></table></div>
          )}
        </div>
      </div>
    </>
  );
}
