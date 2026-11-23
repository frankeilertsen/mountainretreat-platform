import Link from 'next/link';
import { q } from '@/lib/db';
import { Flash } from '@/components/ui';
import { longTermInquiryAction } from '../actions/public';
import { todayOslo } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fast leie' };

export default async function LongTerm({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  return (
    <main style={{ padding: 0 }}>
      <div className="narrow" style={{ maxWidth: 640 }}>
        <div className="row between" style={{ marginBottom: 28 }}>
          <Link href="/"><img src="/brand/logo-light.png" alt="Mountain Retreat" width={180} style={{ height: 'auto', display: 'block' }} /></Link>
          <Link href="/" className="btn ghost small">← Forsiden</Link>
        </div>
        <span className="eyebrow">Langtid</span>
        <h1>Fast leie</h1>
        {sp.sendt ? (
          <div className="card">
            <h3>Takk for forespørselen!</h3>
            <p className="muted">Vi har mottatt henvendelsen din og tar kontakt så snart vi kan. Du har også fått en bekreftelse på e-post.</p>
            <Link href="/" className="btn secondary">Tilbake til forsiden</Link>
          </div>
        ) : (
          <>
            <p className="muted">Ønsker du å leie hos oss over lengre tid? Fortell oss litt om behovet ditt, så kontakter vi deg for å avtale vilkår og visning.</p>
            <Flash sp={sp} />
            <form action={longTermInquiryAction} className="card">
              <div className="fields">
                <div><label htmlFor="name">Navn</label><input id="name" name="name" required autoComplete="name" /></div>
                <div><label htmlFor="phone">Telefon</label><input id="phone" name="phone" type="tel" autoComplete="tel" /></div>
              </div>
              <div className="field" style={{ marginTop: 14 }}><label htmlFor="email">E-post</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
              <div className="fields">
                <div><label htmlFor="propertyId">Bolig</label><select id="propertyId" name="propertyId"><option value="">Uansett / vet ikke</option>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label htmlFor="moveIn">Ønsket innflytting</label><input id="moveIn" name="moveIn" type="date" min={todayOslo()} /></div>
              </div>
              <div className="fields" style={{ marginTop: 14 }}>
                <div><label htmlFor="duration">Varighet</label><select id="duration" name="duration"><option value="">Velg</option><option>1–3 måneder</option><option>3–6 måneder</option><option>6–12 måneder</option><option>Over 12 måneder</option><option>Usikker</option></select></div>
                <div><label htmlFor="persons">Antall personer</label><input id="persons" name="persons" type="number" min={1} max={20} /></div>
              </div>
              <div className="field" style={{ marginTop: 14 }}><label htmlFor="message">Melding</label><textarea id="message" name="message" required minLength={10} rows={5} placeholder="Hvem er dere, hva trenger dere, eventuelle spørsmål …" /></div>
              {/* Honeypot – hidden from people, filled in by bots */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label>Nettside<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <label className="check field"><input type="checkbox" name="consent" required /> <span>Jeg samtykker til at FKE Property AS lagrer opplysningene for å besvare henvendelsen (<Link href="/personvern" target="_blank">personvern</Link>).</span></label>
              <button className="btn block">Send forespørsel</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
