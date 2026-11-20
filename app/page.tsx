import Link from 'next/link';
import { Mountains } from '@/components/ui';
import { getSession } from '@/lib/auth/current';
import { homeFor } from '@/lib/auth/rbac';
import { getSettings } from '@/lib/settings';

export default async function Landing() {
  const s = await getSession();
  const st = await getSettings();
  return (
    <>
      <header className="topbar" style={{ background: 'transparent', borderBottom: 0, position: 'absolute', width: '100%' }}>
        <div className="container">
          <span className="brand">Mountain Retreat <span>FKE Property</span></span>
          {s && s.aal >= 2 ? <Link className="btn secondary small" href={homeFor(s as any)}>Til min side</Link> : <Link className="btn secondary small" href="/login">Logg inn</Link>}
        </div>
      </header>
      <section className="hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span className="eyebrow">Kun for inviterte</span>
          <div className="gold-rule" /><h1>Et stille sted i fjellet, <em>for de nærmeste.</em></h1>
          <p>Mountain Retreat er FKE Property AS sin private bookingportal for venner og familie. Medlemskap skjer kun gjennom invitasjon.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link href="/login" className="btn">Logg inn</Link>
            <a href="#om" className="btn ghost">Slik fungerer det</a>
          </div>
        </div>
        <div className="mountains"><Mountains color="#1a1916" color2="#131311" /></div>
      </section>
      <section id="om" className="container" style={{ padding: '80px 24px' }}>
        <div className="grid g4">
          {[
            ['Invitasjon', 'Du blir medlem når noen du kjenner inviterer deg. Ingen åpen registrering.'],
            ['Forespørsel', 'Velg datoer og send en forespørsel. Vi bekrefter, og du betaler trygt via kort.'],
            ['Medlemspriser', `Alle medlemmer får ${st.member_base_discount_pct} % rabatt på oppholdet – og rabatten øker med ${st.member_loyalty_step_pct} % for hver booking, opptil ${st.member_loyalty_max_pct} % ekstra.`],
            ['Del gleden', 'Inviter andre når medlemskapet ditt er godkjent – dere får begge bonus etter det første oppholdet.'],
          ].map(([t, d]) => (
            <div key={t}><span className="eyebrow">{t}</span><p style={{ fontFamily: 'var(--serif)', fontSize: '1.45rem', lineHeight: 1.35, color: 'var(--ink-2)' }}>{d}</p></div>
          ))}
        </div>
      </section>
      <footer className="container" style={{ padding: '40px 24px', borderTop: '1px solid var(--line)' }}>
        <small>© FKE Property AS · Ålesund · <Link href="/personvern">Personvern</Link></small>
      </footer>
    </>
  );
}
