import Link from 'next/link';
import { q } from '@/lib/db';
import { Flash } from '@/components/ui';
import { longTermInquiryAction } from '../actions/public';
import { todayOslo } from '@/lib/format';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fast leie' };

export default async function LongTerm({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { lang, t } = await getT();
  const T = t.lease;
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  return (
    <main style={{ padding: 0 }}>
      <div className="narrow" style={{ maxWidth: 640 }}>
        <div className="row between" style={{ marginBottom: 28 }}>
          <Link href="/"><img src="/brand/logo-light.png" alt="Mountain Retreat" width={180} style={{ height: 'auto', display: 'block' }} /></Link>
          <div className="row"><LangSwitch lang={lang} /><Link href="/" className="btn ghost small">{t.common.home}</Link></div>
        </div>
        <span className="eyebrow">{T.eyebrow}</span>
        <h1>{T.title}</h1>
        {sp.sendt ? (
          <div className="card">
            <h3>{T.thanksTitle}</h3>
            <p className="muted">{T.thanksText}</p>
            <Link href="/" className="btn secondary">{T.backHome}</Link>
          </div>
        ) : (
          <>
            <p className="muted">{T.lead}</p>
            <Flash sp={sp} lang={lang} />
            <form action={longTermInquiryAction} className="card">
              <div className="fields">
                <div><label htmlFor="name">{T.name}</label><input id="name" name="name" required autoComplete="name" /></div>
                <div><label htmlFor="phone">{T.phone}</label><input id="phone" name="phone" type="tel" autoComplete="tel" /></div>
              </div>
              <div className="field" style={{ marginTop: 14 }}><label htmlFor="email">{T.email}</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
              <div className="fields">
                <div><label htmlFor="propertyId">{T.property}</label><select id="propertyId" name="propertyId"><option value="">{T.any}</option>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label htmlFor="moveIn">{T.moveIn}</label><input id="moveIn" name="moveIn" type="date" min={todayOslo()} /></div>
              </div>
              <div className="fields" style={{ marginTop: 14 }}>
                <div><label htmlFor="duration">{T.duration}</label><select id="duration" name="duration"><option value="">{T.choose}</option>{T.durations.map(d => <option key={d}>{d}</option>)}</select></div>
                <div><label htmlFor="persons">{T.persons}</label><input id="persons" name="persons" type="number" min={1} max={20} /></div>
              </div>
              <div className="field" style={{ marginTop: 14 }}><label htmlFor="message">{T.message}</label><textarea id="message" name="message" required minLength={10} rows={5} placeholder={T.messagePh} /></div>
              {/* Honeypot – hidden from people, filled in by bots */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <input type="hidden" name="lang" value={lang} />
              <label className="check field"><input type="checkbox" name="consent" required /> <span>{T.consent} (<Link href="/personvern" target="_blank">{t.common.privacy.toLowerCase()}</Link>).</span></label>
              <button className="btn block">{T.submit}</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
