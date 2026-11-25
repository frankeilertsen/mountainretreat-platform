import { BackLink } from '@/components/BackLink';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';
import { Logo } from '@/components/Logo';
import Link from 'next/link';
import { Flash } from '@/components/ui';
import { q } from '@/lib/db';
import { loginAction, devLoginAction } from '../actions/auth';

export const metadata = { title: 'Logg inn' };
export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { lang, t } = await getT();
  const devUsers = process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production'
    ? await q<{ id: string; name: string; email: string; system_role: string }>(`SELECT id, name, email, system_role FROM users WHERE status='active' ORDER BY system_role, name LIMIT 20`)
    : [];
  return (
    <div className="narrow" style={{ position: 'relative' }}>
      <BackLink label={t.common.back} />
      <LangSwitch lang={lang} className="lang-corner" />
      <div style={{ textAlign: 'center' }}><Logo width={240} /></div>
      <div className="card" style={{ marginTop: 28 }}>
        <span className="eyebrow">{t.login.eyebrow}</span>
        <h1>{t.login.title}</h1>
        <Flash sp={sp} lang={lang} />
        {sp.sendt ? (
          <p>{t.login.sent}</p>
        ) : (
          <form action={loginAction}>
            <div className="field"><label htmlFor="email">{t.login.email}</label><input id="email" name="email" type="email" required autoComplete="email" autoFocus /></div>
            <button className="btn block">{t.login.submit}</button>
          </form>
        )}
        <p className="muted" style={{ marginTop: 16, fontSize: '.85rem' }}>{t.login.help}</p>
      </div>
      {devUsers.length > 0 && (
        <div className="card flat" style={{ marginTop: 20, borderStyle: 'dashed' }}>
          <span className="eyebrow">Utviklerinnlogging (DEV_LOGIN=1 – aldri i produksjon)</span>
          <ul className="list">
            {devUsers.map(u => (
              <li key={u.id} className="row between">
                <span>{u.name} <small>· {u.system_role}</small></span>
                <form action={devLoginAction}><input type="hidden" name="id" value={u.id} /><button className="btn small ghost">Logg inn</button></form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
