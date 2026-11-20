import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { getSession } from '@/lib/auth/current';
import { Flash, Status } from '@/components/ui';
import { getSettings } from '@/lib/settings';
import { adminInviteAction, adminRevokeInviteAction, createStaffAction, inviteHelperAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Medlemmer' };
const ROLE: Record<string, string> = { super_admin: 'Super-admin', admin: 'Eiendomsadmin', member: 'Medlem', helper: 'Renhold' };

export default async function Members({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const me = await getSession();
  const users = await q(`SELECT u.id, u.name, u.email, u.system_role, u.status, u.invite_tier, u.loyalty_status, u.created_at, u.last_login_at, iu.name AS inviter, u.member_discount_override_pct::float AS override,
      (SELECT count(*) FROM bookings b WHERE b.member_id=u.id AND b.status IN ('confirmed','completed','cancellation_requested'))::int AS stays,
      (SELECT count(*) FROM referrals r WHERE r.referrer_user_id=u.id)::int AS referred,
      (SELECT count(*) FROM referrals r WHERE r.referrer_user_id=u.id AND r.status='qualified')::int AS qualified
    FROM users u LEFT JOIN users iu ON iu.id=u.invited_by_user_id WHERE u.status <> 'anonymized' ORDER BY u.system_role, u.name`);
  const invites = await q(`SELECT i.id, i.invitee_email, i.invitee_name, i.status, i.created_at, i.expires_at, i.role, u.name AS inviter FROM invitations i JOIN users u ON u.id=i.inviter_user_id WHERE i.status='pending' ORDER BY i.created_at DESC`);
  const tree = await q(`WITH RECURSIVE t AS (
      SELECT u.id, u.name, u.invited_by_user_id, 0 AS depth, ARRAY[u.name] AS path FROM users u WHERE u.invited_by_user_id IS NULL AND u.system_role IN ('super_admin','admin') AND u.status <> 'anonymized'
      UNION ALL SELECT u.id, u.name, u.invited_by_user_id, t.depth+1, t.path || u.name FROM users u JOIN t ON u.invited_by_user_id = t.id WHERE t.depth < 10)
    SELECT t.id, t.name, t.depth, r.status FROM t LEFT JOIN referrals r ON r.referred_user_id = t.id ORDER BY t.path`);
  const props = await q(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  const s = await getSettings();
  const std = Number(s.member_base_discount_pct), step = Number(s.member_loyalty_step_pct), lmax = Number(s.member_loyalty_max_pct);
  return (
    <>
      <div className="page-head"><h1>Medlemmer og ansatte</h1></div>
      <Flash sp={sp} />
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="table-wrap"><table><thead><tr><th>Navn</th><th>Rolle</th><th>Invitert av</th><th>Invitasjonsrett</th><th>Opphold</th><th>Rabatt</th><th>Vervet</th><th>Status</th></tr></thead><tbody>
          {users.map(u => (
            <tr key={u.id}><td><Link href={`/admin/medlemmer/${u.id}`}>{u.name}</Link><br /><small className="muted">{u.email}</small></td><td>{ROLE[u.system_role]}</td><td><small>{u.inviter ?? '–'}</small></td>
              <td><small>{u.system_role !== 'member' ? '–' : u.invite_tier === 'admin_invited' || u.loyalty_status === 'approved' ? 'Ja' : u.loyalty_status === 'applied' ? 'Søkt' : 'Nei'}</small></td>
              <td>{u.stays}</td><td><small>{u.system_role === 'member' ? `${Math.min(100, (u.override ?? std) + Math.min(lmax, u.stays * step))} %${u.override != null ? ' *' : ''}` : '–'}</small></td><td>{u.referred ? `${u.qualified}/${u.referred}` : '–'}</td><td><Status s={u.status} /></td></tr>))}
        </tbody></table></div>
      </div>
      <div className="grid g3" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>Inviter medlem</h3>
          <form action={adminInviteAction}><div className="field"><label>Navn</label><input name="name" /></div><div className="field"><label>E-post</label><input type="email" name="email" required /></div><button className="btn">Send invitasjon</button></form>
          {invites.length > 0 && <><h4 style={{ marginTop: 20 }}>Ventende invitasjoner</h4><ul className="list">{invites.map(i => (
            <li key={i.id} className="row between"><span>{i.invitee_name ?? i.invitee_email}<br /><small>{i.role === 'helper' ? 'Renholder · ' : ''}fra {i.inviter} · utløper {fmtDate(i.expires_at)}</small></span>
              <form action={adminRevokeInviteAction}><input type="hidden" name="id" value={i.id} /><button className="btn ghost small">Trekk</button></form></li>))}</ul></>}
        </div>
        <div className="stack">
          <div className="card">
            <h3>Inviter renholder</h3>
            <p className="muted" style={{ fontSize: '.85rem' }}>Renholderen får en lenke og registrerer seg selv med navn, mobil og e-post. Hun får varsel på e-post og SMS om nye bookinger, endringer og påminnelse samme dag.</p>
            <form action={inviteHelperAction}>
              <div className="field"><label>Navn</label><input name="name" /></div>
              <div className="field"><label>E-post</label><input type="email" name="email" required /></div>
              <div className="field"><label>Bolig</label><select name="propertyId"><option value="">Velg senere</option>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <button className="btn">Send invitasjon</button>
            </form>
          </div>
          {me?.system_role === 'super_admin' && (
            <div className="card flat">
              <h3>Ny eiendomsadministrator</h3>
              <form action={createStaffAction}>
                <input type="hidden" name="role" value="admin" />
                <div className="field"><label>Navn</label><input name="name" required /></div>
                <div className="field"><label>E-post</label><input type="email" name="email" required /></div>
                <div className="field"><label>Mobil</label><input name="phone" /></div>
                <button className="btn secondary">Opprett</button>
              </form>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Vervetre</h3>
          <ul className="list">{tree.map(t => <li key={t.id} style={{ paddingLeft: t.depth * 18, paddingTop: 6, paddingBottom: 6 }}>{t.depth > 0 ? '└ ' : ''}<Link href={`/admin/medlemmer/${t.id}`}>{t.name}</Link> {t.status === 'qualified' && <span className="badge b-ok">✓</span>}</li>)}</ul>
        </div>
      </div>
    </>
  );
}
