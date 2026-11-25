import Link from 'next/link';
import { q } from '@/lib/db';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';

export const dynamic = 'force-dynamic';

/** Public front page: the three ways to stay at Mountain Retreat. */
export default async function FrontPage() {
  const { lang, t } = await getT();
  const F = t.front;
  const listings = await q<{ name: string; airbnb_listing_url: string }>(
    `SELECT name, airbnb_listing_url FROM properties WHERE active AND airbnb_listing_url IS NOT NULL AND airbnb_listing_url <> '' ORDER BY name`);
  return (
    <main className="front" style={{ position: 'relative' }}>
      <LangSwitch lang={lang} className="lang-corner" />
      <div className="front-inner">
        <img src="/brand/logo-light.png" alt="Mountain Retreat – mountainretreat.no" className="hero-logo" />
        <span className="eyebrow">{F.welcome}</span>
        <div className="gold-rule" />
        <h1 className="front-title">{F.title}</h1>
        <div className="choices">
          <section className="choice">
            <span className="eyebrow">{F.airbnbEyebrow}</span>
            <h2>{F.airbnbTitle}</h2>
            <p>{F.airbnbText}</p>
            <div className="choice-cta">
              {listings.length === 0 && <span className="btn secondary" aria-disabled="true" style={{ opacity: .5, cursor: 'default' }}>{F.soon}</span>}
              {listings.map(l => (
                <a key={l.airbnb_listing_url} href={l.airbnb_listing_url} target="_blank" rel="noopener noreferrer" className="btn secondary">{listings.length > 1 ? l.name : F.airbnbCta} ↗</a>
              ))}
            </div>
          </section>
          <section className="choice featured">
            <span className="eyebrow">{F.ffEyebrow}</span>
            <h2>{F.ffTitle}</h2>
            <p>{F.ffText}</p>
            <div className="choice-cta"><Link href="/venner" className="btn">{F.ffCta}</Link></div>
          </section>
          <section className="choice">
            <span className="eyebrow">{F.ltEyebrow}</span>
            <h2>{F.ltTitle}</h2>
            <p>{F.ltText}</p>
            <div className="choice-cta"><Link href="/fast-leie" className="btn secondary">{F.ltCta}</Link></div>
          </section>
        </div>
      </div>
      <footer className="front-foot"><small>{t.common.footer} · <Link href="/salgsvilkar">{t.common.terms}</Link> · <Link href="/personvern">{t.common.privacy}</Link></small></footer>
    </main>
  );
}
