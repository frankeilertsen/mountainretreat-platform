import Link from 'next/link';
import { notFound } from 'next/navigation';
import { one, q } from '@/lib/db';
import { fmtDate, fmtDateTime, nok } from '@/lib/format';
import { rewardBalance } from '@/lib/domain/rewards';
import { memberDiscount } from '@/lib/domain/memberDiscount';
import { invitationsWithOutcome, STAGE_LABEL } from '@/lib/domain/memberOverview';
import { Flash, Status } from '@/components/ui';
import * as A from '../../../actions/admin';

export const dynamic = 'force-dynamic';

export default async function MemberDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await one(`SELECT u.*, iu.name AS inviter, iu.id AS inviter_id FROM users u LEFT JOIN users iu ON iu.id=u.invited_by_user_id WHERE u.id=$1`, [id]);
  if (!u) notFound();
  const [bookings, invited, bal, exempt, sessions, assignments, props] = await Promise.all([
    q(`SELECT b.id, b.reference, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start, b.price_total_ore, p.name AS property FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.member_id=$1 ORDER BY b.start_date DESC LIMIT 30`, [id]),
    q(`SELECT u.id, u.name, r.status, r.qualified_at FROM referrals r JOIN users u ON u.id=r.referred_user_id WHERE r.referrer_user_id=$1 ORDER BY r.created_at DESC`, [id]),
    rewardBalance(id),
    one(`SELECT notes, granted_at FROM member_cleaning_exemptions WHERE user_id=$1 AND active LIMIT 1`, [id]),
    q(`SELECT created_at, last_activity_at, ip_address, user_agent FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_activity_at DESC`, [id]),
    q(`SELECT p.id, p.name FROM helper_property_assignments h JOIN properties p ON p.id=h.property_id WHERE h.helper_user_id=$1 AND h.active`, [id]),
    q(`SELECT id, name FROM properties WHERE active ORDER BY name`),
  ]);
  const back = `/admin/medlemmer/${id}`;
  const disc = u.system_role === 'member' ? await memberDiscount(id) : null;
  const outcomes = u.system_role === 'member' ? await invitationsWithOutcome(id) : [];
  return (
    <>
      <Link href="/admin/medlemmer" className="muted">← Medlemmer</Link>
      <div className="page-head row between" style={{ marginTop: 10 }}><div><span className="eyebrow">{u.system_role}</span><h1 style={{ marginBottom: 0 }}>{u.name}</h1></div><div className="row">{u.system_role === 'member' && <><Link href={`/admin/meldinger?medlem=${u.id}`} className="btn ghost small">Samtaler</Link><Link href={`/admin/meldinger/ny?medlem=${u.id}`} className="btn secondary small">Send melding</Link></>}<Status s={u.status} /></div></div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card"><dl className="dl">
            <dt>E-post</dt><dd>{u.email}</dd><dt>Mobil</dt><dd>{u.phone ?? '–'}</dd>
            <dt>Invitert av</dt><dd>{u.inviter_id ? <Link href={`/admin/medlemmer/${u.inviter_id}`}>{u.inviter}</Link> : '–'}</dd>
            <dt>Medlem siden</dt><dd>{fmtDate(u.created_at)}</dd><dt>Sist innlogget</dt><dd>{fmtDateTime(u.last_login_at)}</dd>
            <dt>Tofaktor</dt><dd>{u.totp_enrolled_at ? `Aktivert ${fmtDate(u.totp_enrolled_at)}` : 'Ikke satt opp'}{u.locked_until && new Date(u.locked_until) > new Date() ? ' · LÅST' : ''}</dd>
            {u.system_role === 'member' && <><dt>Invitasjonsrett</dt><dd>{u.invite_tier === 'admin_invited' || u.loyalty_status === 'approved' ? 'Ja' : u.loyalty_status === 'applied' ? 'Har søkt' : 'Nei'}</dd>
              <dt>Bonus</dt><dd>{nok(bal.available)} tilgjengelig{bal.pending ? ` · ${nok(bal.pending)} opptjenes` : ''}</dd></>}
          </dl></div>
          {u.system_role === 'member' && (
            <div className="card"><h3>Bookinger</h3><ul className="list">{bookings.map(b => <li key={b.id} className="row between"><Link href={`/admin/bookinger/${b.id}`}>{b.property} · {fmtDate(b.start)}</Link><span>{nok(b.price_total_ore)} <Status s={b.status} /></span></li>)}</ul>{bookings.length === 0 && <p className="muted">Ingen.</p>}</div>
          )}
          {outcomes.length > 0 && <div className="card"><h3>Invitasjoner sendt</h3><table><tbody>{outcomes.map(i => (
            <tr key={i.id}><td>{i.member_name ?? i.invitee_name ?? i.invitee_email}</td><td><span className={`badge ${STAGE_LABEL[i.stage][1]}`}>{STAGE_LABEL[i.stage][0]}</span></td><td>{i.reward_ore ? <span style={{ color: 'var(--gold-2)' }}>+{nok(i.reward_ore)}</span> : ''}</td></tr>))}</tbody></table></div>}
          {u.system_role === 'helper' && (
            <div className="card"><h3>Renholdstilgang</h3>
              <ul className="list">{assignments.map(a => <li key={a.id} className="row between">{a.name}<form action={A.helperAssignmentAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="propertyId" value={a.id} /><input type="hidden" name="remove" value="1" /><button className="btn ghost small">Fjern</button></form></li>)}</ul>
              <form action={A.helperAssignmentAction} className="row" style={{ marginTop: 10 }}><input type="hidden" name="id" value={id} /><select name="propertyId" style={{ flex: 1 }}>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn small">Tildel bolig</button></form>
              <form action={A.helperScopeAction} className="row" style={{ marginTop: 14 }}><input type="hidden" name="id" value={id} />
                <select name="scope" defaultValue={u.cleaning_scope} style={{ flex: 1 }}><option value="assigned">Ser kun oppgaver tildelt seg</option><option value="all">Ser alle renholdsoppgaver</option></select><button className="btn ghost small">Lagre</button></form>
              <p className="muted" style={{ fontSize: '.82rem', marginTop: 8 }}>Nye oppgaver tildeles automatisk når boligen har nøyaktig én renholder.</p>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card"><h3>Medlemskap</h3>
            <div className="row">
              {u.status !== 'active' && <form action={A.memberStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="active" /><button className="btn ok small">Aktiver</button></form>}
              {u.status === 'active' && <form action={A.memberStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="suspended" /><button className="btn secondary small">Suspender</button></form>}
              {u.status !== 'revoked' && <form action={A.memberStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="revoked" /><button className="btn danger small">Tilbakekall (kansellerer bookinger)</button></form>}
            </div>
            {u.system_role === 'member' && u.invite_tier === 'member_invited' && u.loyalty_status !== 'approved' && <form action={A.grantInviteRightsAction} style={{ marginTop: 12 }}><input type="hidden" name="id" value={id} /><button className="btn ghost small">Gi invitasjonsrett</button></form>}
          </div>
          {disc && (
            <div className="card"><h3>Medlemsrabatt</h3>
              <div className="kpi" style={{ color: 'var(--gold-2)' }}>{disc.totalPct} %</div>
              <small className="muted">{disc.basePct} % {disc.baseIsOverride ? 'personlig grunnrabatt' : 'standard'} + {disc.loyaltyPct} % lojalitet ({disc.bookingsCounted} bookinger, maks {disc.loyaltyMaxPct} %)</small>
              <form action={A.memberDiscountAction} className="row" style={{ marginTop: 14 }}><input type="hidden" name="id" value={id} />
                <input name="pct" defaultValue={disc.baseIsOverride ? disc.basePct : ''} placeholder={`Standard ${disc.standardPct} %`} style={{ width: 160 }} />
                <button className="btn small">Sett personlig grunnrabatt</button>{disc.baseIsOverride && <button className="btn ghost small" name="reset" value="1">Tilbake til standard</button>}</form>
              <small className="muted">Lojalitetsrabatten legges alltid oppå.</small>
            </div>
          )}
          {u.system_role === 'member' && (
            <>
              <div className="card"><h3>Juster bonus</h3>
                <form action={A.adjustRewardAction}><input type="hidden" name="userId" value={id} /><input type="hidden" name="back" value={back} />
                  <div className="fields"><div><label>Beløp (kr, negativt = trekk)</label><input name="amount" required /></div><div><label>Begrunnelse</label><input name="note" required /></div></div>
                  <button className="btn small" style={{ marginTop: 10 }}>Juster</button></form></div>
              <div className="card"><h3>Fritak for sluttvask</h3>
                {exempt ? <><p>Har fritak siden {fmtDate(exempt.granted_at)}{exempt.notes ? ` – ${exempt.notes}` : ''}.</p><form action={A.cleaningExemptionAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="grant" value="0" /><button className="btn ghost small">Fjern fritak</button></form></>
                  : <form action={A.cleaningExemptionAction} className="row"><input type="hidden" name="id" value={id} /><input type="hidden" name="grant" value="1" /><input name="notes" placeholder="Merknad" style={{ flex: 1 }} /><button className="btn ghost small">Gi fritak</button></form>}</div>
            </>
          )}
          <div className="card flat"><h3>Sikkerhet</h3>
            <p className="muted">{sessions.length} aktive økter{sessions[0] ? `, sist aktiv ${fmtDateTime(sessions[0].last_activity_at)}` : ''}.</p>
            <div className="row"><form action={A.revokeSessionsAction}><input type="hidden" name="id" value={id} /><button className="btn ghost small">Logg ut overalt</button></form>
              <form action={A.resetTotpAction}><input type="hidden" name="id" value={id} /><button className="btn ghost small">Nullstill tofaktor</button></form></div></div>
        </div>
      </div>
    </>
  );
}
