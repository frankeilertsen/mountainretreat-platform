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
  if (sp.koder) {
    return (
      <div className="narrow"><div className="card">
        <span className="eyebrow">Tofaktor er aktivert</span>
        <h1>Lagre gjenopprettingskodene</h1>
        <p>Hver kode kan brukes én gang hvis du mister telefonen. De vises bare nå.</p>
        <pre style={{ background: 'var(--bg)', padding: 16, borderRadius: 10, columns: 2, fontSize: '1rem' }}>{sp.koder.split(',').join('\n')}</pre>
        <a className="btn block" href={homeFor(s as any)}>Jeg har lagret kodene – fortsett</a>
      </div></div>
    );
  }
  if (s.aal >= 2) redirect(homeFor(s as any));
  const enrolling = !s.totp_enrolled_at;
  const enroll = enrolling ? await beginEnrollment(s.id, s.email) : null;
  return (
    <div className="narrow"><div className="card">
      <span className="eyebrow">Steg 2 av 2</span>
      <h1>{enrolling ? 'Sett opp tofaktor' : 'Bekreft at det er deg'}</h1>
      <Flash sp={sp} />
      {enroll && (
        <>
          <p>Skann QR-koden med en autentiseringsapp (f.eks. Google Authenticator, Microsoft Authenticator eller 1Password).</p>
          <div style={{ textAlign: 'center', margin: '20px 0' }}><img src={enroll.qrDataUrl} alt="QR-kode for tofaktor" width={220} height={220} /></div>
          <details><summary className="muted">Kan ikke skanne? Vis nøkkel</summary><code style={{ wordBreak: 'break-all' }}>{enroll.secret}</code></details>
        </>
      )}
      <form action={totpAction} style={{ marginTop: 20 }}>
        <div className="field"><label htmlFor="code">{enrolling ? 'Skriv inn koden appen viser' : 'Kode fra autentiseringsappen (eller gjenopprettingskode)'}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus style={{ fontSize: '1.4rem', letterSpacing: '.3em', textAlign: 'center' }} /></div>
        <button className="btn block">Bekreft</button>
      </form>
    </div></div>
  );
}
