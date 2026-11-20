import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { Flash } from '@/components/ui';
import { helperProfileAction } from '../../actions/cleaning';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profil' };

export default async function HelperProfile({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('cleaning_portal');
  const me = await one<{ notify_email: boolean; notify_sms: boolean }>('SELECT notify_email, notify_sms FROM users WHERE id=$1', [u.id]);
  const props = await q<{ name: string }>(`SELECT p.name FROM helper_property_assignments h JOIN properties p ON p.id=h.property_id WHERE h.helper_user_id=$1 AND h.active`, [u.id]);
  return (
    <>
      <span className="eyebrow">Min konto</span><h1>Profil og varsler</h1>
      <Flash sp={sp} />
      <form action={helperProfileAction} className="card">
        <div className="field"><label>Navn</label><input name="name" defaultValue={u.name} required /></div>
        <div className="field"><label>Mobil</label><input name="phone" type="tel" defaultValue={u.phone ?? ''} required={u.system_role === 'helper'} /></div>
        <div className="field"><label>E-post</label><input value={u.email} disabled /><small className="muted">Brukes til innlogging. Kontakt administrator for å endre.</small></div>
        <h3 style={{ marginTop: 24 }}>Varsler</h3>
        <p className="muted" style={{ fontSize: '.88rem' }}>Du får beskjed ved ny booking (ny vask), når en vask flyttes eller avlyses, når info om neste gjester endres, dagen før og samme morgen som det skal vaskes.</p>
        <label className="check field"><input type="checkbox" name="notify_email" defaultChecked={me?.notify_email} /> E-post</label>
        <label className="check field"><input type="checkbox" name="notify_sms" defaultChecked={me?.notify_sms} /> SMS til mobilnummeret over</label>
        <button className="btn block">Lagre</button>
      </form>
      {props.length > 0 && <p className="muted" style={{ marginTop: 16 }}>Du er satt opp på: {props.map(p => p.name).join(', ')}.</p>}
      <form action="/logout" method="post" style={{ marginTop: 16 }}><button className="btn ghost block">Logg ut</button></form>
    </>
  );
}
