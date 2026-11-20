import Link from 'next/link';
import { Mountains } from '@/components/ui';
import { getSession } from '@/lib/auth/current';
import { homeFor } from '@/lib/auth/rbac';

export default async function Landing() {
  const s = await getSession();
  return (
    <>
      <header className="topbar" style={{ background: 'transparent', borderBottom: 0, position: 'absolute', width: '100%' }}>
        <div className="container">
          <span className="brand">Mountain Retreat <span>Byrampen</span></span>
          {s && s.aal >= 2 ? <Link className="btn secondary small" href={homeFor(s as any)}>Til min side</Link> : <Link className="btn secondary small" href="/login">Logg inn</Link>}
        </div>
      </header>
      <section className="hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span className="eyebrow">Kun for inviterte</span>
          <div className="gold-rule" /><h1>Et stille sted i fjellet, <em>for de nærmeste.</em></h1>
          <p>Mountain Retreat er Byrampen Eiendoms private bookingportal for venner og familie. Medlemskap skjer kun gjennom invitasjon.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link href="/login" className="btn">Logg inn</Link>
            <a href="#om" className="btn ghost">Slik fungerer det</a>
          </div>
        </div>
        <div className="mountains"><Mountains color="#1a1916" color2="#131311" /></div>
      </section>
      <section id="om" className="container" style={{ padding: '80px 24px' }}>
        <div className="grid g3">
          {[
            ['Invitasjon', 'Du blir medlem når noen du kjenner inviterer deg. Ingen åpen registrering.'],
            ['Forespørsel', 'Velg datoer og send en forespørsel. Vi bekrefter, og du betaler trygt via kort.'],
            ['Del gleden', 'Inviter andre når medlemskapet ditt er godkjent – dere får begge bonus etter første opphold.'],
          ].map(([t, d]) => (
            <div key={t}><span className="eyebrow">{t}</span><p style={{ fontFamily: 'var(--serif)', fontSize: '1.45rem', lineHeight: 1.35, color: 'var(--ink-2)' }}>{d}</p></div>
          ))}
        </div>
      </section>
      <footer className="container" style={{ padding: '40px 24px', borderTop: '1px solid var(--line)' }}>
        <small>© Byrampen Eiendom AS · Ålesund · <Link href="/personvern">Personvern</Link></small>
      </footer>
    </>
  );
}
