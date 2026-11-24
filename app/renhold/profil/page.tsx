import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { Flash } from '@/components/ui';
import { helperProfileAction } from '../../actions/cleaning';
import { getLang } from '@/lib/i18n/lang';
import { cleanDict } from '@/lib/i18n/cleaning';
import { LangSwitch } from '@/components/LangSwitch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profil' };

export default async function HelperProfile({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('cleaning_portal');
  const lang = await getLang();
  const C = cleanDict[lang].profile;
  const me = await one<{ notify_email: boolean; notify_sms: boolean }>('SELECT notify_email, notify_sms FROM users WHERE id=$1', [u.id]);
  const props = await q<{ name: string }>(`SELECT p.name FROM helper_property_assignments h JOIN properties p ON p.id=h.property_id WHERE h.helper_user_id=$1 AND h.active`, [u.id]);
  return (
    <>
      <span className="eyebrow">{C.eyebrow}</span><h1>{C.title}</h1>
      <Flash sp={sp} lang={lang} />
      <div className="card" style={{ marginBottom: 16 }}><h3 style={{ marginTop: 0 }}>{C.language}</h3><LangSwitch lang={lang} /><p className="muted" style={{ fontSize: '.88rem', marginBottom: 0 }}>{C.languageHelp}</p></div>
      <form action={helperProfileAction} className="card">
        <div className="field"><label>{C.name}</label><input name="name" defaultValue={u.name} required /></div>
        <div className="field"><label>{C.phone}</label><input name="phone" type="tel" defaultValue={u.phone ?? ''} required={u.system_role === 'helper'} /></div>
        <div className="field"><label>{C.email}</label><input value={u.email} disabled /><small className="muted">{C.emailHelp}</small></div>
        <h3 style={{ marginTop: 24 }}>{C.notices}</h3>
        <p className="muted" style={{ fontSize: '.88rem' }}>{C.noticesText}</p>
        <label className="check field"><input type="checkbox" name="notify_email" defaultChecked={me?.notify_email} /> {C.byEmail}</label>
        <label className="check field"><input type="checkbox" name="notify_sms" defaultChecked={me?.notify_sms} /> {C.bySms}</label>
        <button className="btn block">{C.save}</button>
      </form>
      {props.length > 0 && <p className="muted" style={{ marginTop: 16 }}>{C.assigned(props.map(p => p.name).join(', '))}</p>}
      <form action="/logout" method="post" style={{ marginTop: 16 }}><button className="btn ghost block">{cleanDict[lang].logout}</button></form>
    </>
  );
}
