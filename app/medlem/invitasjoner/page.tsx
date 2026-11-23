import { requireUser } from '@/lib/auth/current';
import { can } from '@/lib/auth/rbac';
import { invitationsWithOutcome, rewardTerms, STAGE_LABEL } from '@/lib/domain/memberOverview';
import { invitationQuota } from '@/lib/domain/invitations';
import { getPool } from '@/lib/db';
import { listPresentations } from '@/lib/domain/presentations';
import { InviteExtras } from '@/components/InviteExtras';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, nokL } from '@/lib/i18n/format';
import { getSettings } from '@/lib/settings';
import { Flash, Empty } from '@/components/ui';
import { inviteAction, revokeMyInvitationAction, applyLoyaltyAction } from '../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inviter' };

export default async function Invitations({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const T = t.invites;
  const nok = (o: number) => nokL(o, lang), fmtDate = (d: any) => fmtDateL(d, lang);
  const list = await invitationsWithOutcome(u.id);
  const s = await getSettings();
  const terms = await rewardTerms(getPool(), lang);
  const presentations = await listPresentations({ activeOnly: true });
  const quota = await invitationQuota(u.id);
  const earned = list.reduce((sum, i) => sum + (i.reward_ore ?? 0), 0);
  const mayInvite = can(u as any, 'invite');
  return (
    <>
      <div className="page-head"><span className="eyebrow">{T.eyebrow}</span><h1>{T.title}</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>{T.lead(terms.referrer, terms.referred)}</p></div>
      <Flash sp={sp} lang={lang} />
      <div className="grid split-1-2" style={{ alignItems: 'start' }}>
        <div className="card">
          {mayInvite ? (
            <form action={inviteAction}>
              <h3>{T.send}</h3>
              <div className="field"><label>{T.name}</label><input name="name" /></div>
              <div className="field"><label>{T.email}</label><input type="email" name="email" required /></div>
              <InviteExtras presentations={presentations} labels={T} lang={lang} />
              <button className="btn">{T.send}</button>
              <p className="muted" style={{ fontSize: '.82rem', marginTop: 12 }}>{T.includes} {T.linkNote(String(s.invitation_validity_days))}</p>
              <p className="muted" style={{ fontSize: '.82rem' }}>{T.quota(quota.remaining, quota.limit)}</p>
            </form>
          ) : u.loyalty_status === 'applied' ? (
            <><h3>{T.pendingTitle}</h3><p className="muted">{T.pendingText}</p></>
          ) : (
            <><h3>{T.wantTitle}</h3><p className="muted">{T.wantText}</p>
              {can(u as any, 'apply_loyalty') && <form action={applyLoyaltyAction}><button className="btn secondary">{T.apply}</button></form>}</>
          )}
        </div>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>{T.yours}</h3>{earned > 0 && <span style={{ color: 'var(--gold-2)' }}>{T.earned(nok(earned))}</span>}</div>
          {list.length === 0 ? <Empty>{T.none}</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>{T.th.person}</th><th>{T.th.sent}</th><th>{T.th.status}</th><th>{T.th.bonus}</th><th></th></tr></thead><tbody>
              {list.map(i => (
                <tr key={i.id}><td>{i.member_name ?? i.invitee_name ?? i.invitee_email}{i.member_name && <><br /><small className="muted">{i.invitee_email}</small></>}</td>
                  <td><small>{fmtDate(i.created_at)}</small></td>
                  <td><span className={`badge ${STAGE_LABEL[i.stage][1]}`}>{lang === 'en' ? T.stage[i.stage] : STAGE_LABEL[i.stage][0]}</span>{i.completed_stays > 1 && <><br /><small className="muted">{T.onlyFirst(i.completed_stays)}</small></>}</td>
                  <td>{i.reward_ore ? <span style={{ color: 'var(--gold-2)' }}>+{nok(i.reward_ore)}</span> : i.stage === 'booked' || i.stage === 'member_no_booking' ? <small className="muted">{T.awaited(terms.referrer)}</small> : '–'}</td>
                  <td>{i.status === 'pending' && <form action={revokeMyInvitationAction}><input type="hidden" name="id" value={i.id} /><button className="btn ghost small">{T.revoke}</button></form>}</td></tr>))}
            </tbody></table></div>
          )}
        </div>
      </div>
    </>
  );
}
