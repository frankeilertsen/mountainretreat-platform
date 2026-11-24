import Link from 'next/link';
import { getSession } from '@/lib/auth/current';
import { homeFor } from '@/lib/auth/rbac';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';

export const metadata = { title: 'Retreat Club' };
export const dynamic = 'force-dynamic';

export default async function Landing() {
  const s = await getSession();
  const { lang, t } = await getT();
  const T = t.ff;
  return (
    <>
      <header className="topbar" style={{ background: 'transparent', borderBottom: 0, position: 'absolute', width: '100%' }}>
        <div className="container">
          <Link href="/" className="btn ghost small">{t.common.home}</Link>
          <div className="row">
            <LangSwitch lang={lang} />
            {s && s.aal >= 2 ? <Link className="btn secondary small" href={homeFor(s as any)}>{T.toMyPage}</Link> : <Link className="btn secondary small" href="/login">{t.common.login}</Link>}
          </div>
        </div>
      </header>
      <section className="hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <img src="/brand/logo-light.png" alt="Mountain Retreat – mountainretreat.no" className="hero-logo" />
          <span className="eyebrow">{T.eyebrow}</span>
          <div className="gold-rule" /><h1>{T.title1} <em>{T.title2}</em></h1>
          <p>{T.lead}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link href="/login" className="btn">{t.common.login}</Link>
            <a href="#om" className="btn ghost">{T.how}</a>
          </div>
        </div>
      </section>
      <section id="om" className="container" style={{ padding: '80px 24px' }}>
        <div className="grid g4">
          {T.steps.map(([h, d]) => (
            <div key={h}><span className="eyebrow">{h}</span><p style={{ fontFamily: 'var(--serif)', fontSize: '1.45rem', lineHeight: 1.35, color: 'var(--ink-2)' }}>{d}</p></div>
          ))}
        </div>
      </section>
      <footer className="container" style={{ padding: '40px 24px', borderTop: '1px solid var(--line)' }}>
        <small>{t.common.footer} · <Link href="/personvern">{t.common.privacy}</Link></small>
      </footer>
    </>
  );
}
