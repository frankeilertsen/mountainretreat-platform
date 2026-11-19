import { requireUser } from '@/lib/auth/current';
import { can } from '@/lib/auth/rbac';
import { listInvitationsFor } from '@/lib/domain/invitations';
import { fmtDate, nok } from '@/lib/format';
import { getSettings } from '@/lib/settings';
import { Flash, Status, Empty } from '@/components/ui';
import { inviteAction, revokeMyInvitationAction, applyLoyaltyAction } from '../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inviter' };

export default async function Invitations({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const list = await listInvitationsFor(u.id);
  const s = await getSettings();
  const reward = s.referral_reward_type === 'percentage' ? `${s.referral_reward_percentage} % av første opphold (maks ${nok(Number(s.referral_reward_max_ore))})` : nok(Number(s.referral_reward_referrer_ore));
  const mayInvite = can(u as any, 'invite');
  return (
    <>
      <div className="page-head"><span className="eyebrow">Venner og familie</span><h1>Inviter</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>Når noen du inviterer fullfører sitt første opphold, får dere begge {reward} i bonus til neste booking.</p></div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
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
          <h3>Dine invitasjoner</h3>
          {list.length === 0 ? <Empty>Du har ikke invitert noen ennå.</Empty> : (
            <ul className="list">{list.map(i => (
              <li key={i.id} className="row between">
                <span>{i.member_name ?? i.invitee_name ?? i.invitee_email}<br /><small>Sendt {fmtDate(i.created_at)}{i.referral_status === 'qualified' ? ' · har hatt første opphold 🎉' : i.status === 'accepted' ? ' · medlem, ikke hatt opphold ennå' : ''}</small></span>
                <span className="row">{i.status === 'pending' && <form action={revokeMyInvitationAction}><input type="hidden" name="id" value={i.id} /><button className="btn ghost small">Trekk tilbake</button></form>}<Status s={i.referral_status === 'qualified' ? 'qualified' : i.status} /></span>
              </li>))}</ul>
          )}
        </div>
      </div>
    </>
  );
}
