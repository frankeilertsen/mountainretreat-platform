import { requireUser } from '@/lib/auth/current';
import { one } from '@/lib/db';
import { Flash } from '@/components/ui';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';
import { updateProfileAction, anonymizeAction } from '../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profil' };

export default async function Profile({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const { lang, t } = await getT();
  const T = t.profile;
  const extra = await one<{ marketing_consent: boolean; referral_code: string | null }>('SELECT marketing_consent, referral_code FROM users WHERE id=$1', [u.id]);
  return (
    <>
      <div className="page-head"><h1>{T.title}</h1></div>
      <Flash sp={sp} lang={lang} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <form action={updateProfileAction}>
            <div className="field"><label>{T.name}</label><input name="name" defaultValue={u.name} required /></div>
            <div className="field"><label>{T.email}</label><input value={u.email} disabled /><small className="muted">{T.emailNote}</small></div>
            <div className="field"><label>{T.phone}</label><input name="phone" defaultValue={u.phone ?? ''} /></div>
            <label className="check field"><input type="checkbox" name="marketing" defaultChecked={extra?.marketing_consent} /> {T.marketing}</label>
            <button className="btn">{t.common.save}</button>
          </form>
        </div>
        <div className="stack">
          <div className="card flat"><h3>{T.language}</h3><LangSwitch lang={lang} /></div>
          <div className="card flat"><h3>{T.security}</h3><p className="muted">{T.securityText}</p>
            <form action="/logout" method="post"><button className="btn ghost small">{t.common.logout}</button></form></div>
          <div className="card flat"><h3>{T.data}</h3><p className="muted">{T.dataText}</p><a className="btn ghost small" href="/api/medlem/eksport">{T.download}</a></div>
          <div className="card flat" style={{ borderColor: 'var(--danger-soft)' }}>
            <h3>{T.del}</h3><p className="muted">{T.delText}</p>
            <form action={anonymizeAction} className="row"><input name="confirm" placeholder={T.delPh} style={{ maxWidth: 160 }} /><button className="btn danger small">{T.delCta}</button></form>
          </div>
        </div>
      </div>
    </>
  );
}
