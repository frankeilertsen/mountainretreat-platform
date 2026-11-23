import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';
import { Logo } from '@/components/Logo';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/current';
import { beginEnrollment } from '@/lib/auth/totp';
import { homeFor } from '@/lib/auth/rbac';
import { Flash } from '@/components/ui';
import { totpAction } from '../../actions/auth';

export const metadata = { title: 'Tofaktor' };
export const dynamic = 'force-dynamic';

export default async function Totp({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!s) redirect('/login');
  const { lang, t } = await getT();
  if (sp.koder) {
    return (
      <div className="narrow"><div className="card">
        <span className="eyebrow">{t.totp.savedEyebrow}</span>
        <h1>{t.totp.savedTitle}</h1>
        <p>{t.totp.savedText}</p>
        <pre style={{ background: 'var(--bg)', padding: 16, borderRadius: 10, columns: 2, fontSize: '1rem' }}>{sp.koder.split(',').join('\n')}</pre>
        <a className="btn block" href={homeFor(s as any)}>{t.totp.savedCta}</a>
      </div></div>
    );
  }
  if (s.aal >= 2) redirect(homeFor(s as any));
  const enrolling = !s.totp_enrolled_at;
  const enroll = enrolling ? await beginEnrollment(s.id, s.email) : null;
  return (
    <div className="narrow" style={{ position: 'relative' }}><LangSwitch lang={lang} className="lang-corner" /><div style={{ textAlign: 'center', marginBottom: 28 }}><Logo width={200} /></div><div className="card">
      <span className="eyebrow">{t.totp.step}</span>
      <h1>{enrolling ? t.totp.enrollTitle : t.totp.confirmTitle}</h1>
      <Flash sp={sp} lang={lang} />
      {enroll && (
        <>
          <p>{t.totp.scan}</p>
          <div style={{ textAlign: 'center', margin: '20px 0' }}><img src={enroll.qrDataUrl} alt="QR-kode for tofaktor" width={220} height={220} /></div>
          <details><summary className="muted">{t.totp.showKey}</summary><code style={{ wordBreak: 'break-all' }}>{enroll.secret}</code></details>
        </>
      )}
      <form action={totpAction} style={{ marginTop: 20 }}>
        <div className="field"><label htmlFor="code">{enrolling ? t.totp.codeEnroll : t.totp.codeLogin}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus style={{ fontSize: '1.4rem', letterSpacing: '.3em', textAlign: 'center' }} /></div>
        <button className="btn block">{t.totp.confirm}</button>
      </form>
    </div></div>
  );
}
