import Link from 'next/link';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Public front page: the three ways to stay at Mountain Retreat. */
export default async function FrontPage() {
  const listings = await q<{ name: string; airbnb_listing_url: string }>(
    `SELECT name, airbnb_listing_url FROM properties WHERE active AND airbnb_listing_url IS NOT NULL AND airbnb_listing_url <> '' ORDER BY name`);
  return (
    <main className="front">
      <div className="front-inner">
        <img src="/brand/logo-light.png" alt="Mountain Retreat – mountainretreat.no" className="hero-logo" />
        <span className="eyebrow">Velkommen</span>
        <div className="gold-rule" />
        <h1 className="front-title">Hvordan vil du bo hos oss?</h1>

        <div className="choices">
          <section className="choice">
            <span className="eyebrow">Ferieleie</span>
            <h2>Book via Airbnb</h2>
            <p>For alle gjester. Se ledige datoer, priser og omtaler, og book trygt gjennom Airbnb.</p>
            <div className="choice-cta">
              {listings.length === 0 && <span className="btn secondary" aria-disabled="true" style={{ opacity: .5, cursor: 'default' }}>Kommer snart</span>}
              {listings.map(l => (
                <a key={l.airbnb_listing_url} href={l.airbnb_listing_url} target="_blank" rel="noopener noreferrer" className="btn secondary">
                  {listings.length > 1 ? l.name : 'Gå til Airbnb'} ↗
                </a>
              ))}
            </div>
          </section>

          <section className="choice featured">
            <span className="eyebrow">Kun for inviterte</span>
            <h2>Venner og familie</h2>
            <p>Medlemsportalen for inviterte. Ingen Airbnb-avgift, fast medlemsrabatt og lojalitetsrabatt som øker for hver booking.</p>
            <div className="choice-cta"><Link href="/venner" className="btn">Gå videre</Link></div>
          </section>

          <section className="choice">
            <span className="eyebrow">Langtid</span>
            <h2>Fast leie</h2>
            <p>Ønsker du å leie over lengre tid? Send oss en forespørsel, så tar vi kontakt for å avtale vilkår.</p>
            <div className="choice-cta"><Link href="/fast-leie" className="btn secondary">Send forespørsel</Link></div>
          </section>
        </div>
      </div>
      <footer className="front-foot"><small>© FKE Property AS · mountainretreat.no · <Link href="/personvern">Personvern</Link></small></footer>
    </main>
  );
}
