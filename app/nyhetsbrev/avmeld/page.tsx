import Link from 'next/link';
import { getPool, one } from '@/lib/db';
import { checkUnsubscribe } from '@/lib/domain/mailings';
import { unsubscribeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meld av nyheter', robots: { index: false } };

/** Unsubscribe from news e-mails with the link in the e-mail (no login needed). A button press is required so link scanners don't unsubscribe people. */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ok = /^[0-9a-f-]{36}$/.test(sp.u ?? '') && checkUnsubscribe(sp.u, sp.t ?? '');
  const u = ok ? await one<{ name: string; marketing_consent: boolean; lang: string }>(`SELECT name, marketing_consent, preferred_lang AS lang FROM users WHERE id=$1`, [sp.u], getPool()) : null;
  const en = u?.lang === 'en';
  return (
    <main className="narrow" style={{ paddingTop: 48 }}><div className="card">
      <img src="/brand/logo-dark.png" alt="Mountain Retreat" style={{ width: 200, marginBottom: 18 }} />
      {!u ? <><h1>Ugyldig lenke</h1><p className="muted">Lenken er ikke gyldig. Du kan melde deg av nyheter under Profil når du er logget inn.</p></>
        : sp.ferdig === '1' || !u.marketing_consent ? <><h1>{en ? 'You are unsubscribed' : 'Du er meldt av'}</h1><p className="muted">{en ? 'You will no longer receive news and offers by e-mail. You will still get e-mails about your bookings. You can sign up again under Profile.' : 'Du får ikke lenger nyheter og tilbud på e-post. E-post om bookingene dine får du fortsatt. Du kan melde deg på igjen under Profil.'}</p></>
        : <><h1>{en ? 'Unsubscribe from news?' : 'Meld av nyheter?'}</h1>
          <p className="muted">{en ? `Hi ${u.name.split(' ')[0]}! Press the button and you will no longer receive news and offers from Retreat Club. E-mails about your bookings still come as usual.` : `Hei ${u.name.split(' ')[0]}! Trykk på knappen, så får du ikke lenger nyheter og tilbud fra Retreat Club. E-post om bookingene dine kommer fortsatt som vanlig.`}</p>
          <form action={unsubscribeAction}><input type="hidden" name="u" value={sp.u} /><input type="hidden" name="t" value={sp.t} /><button className="btn block">{en ? 'Unsubscribe' : 'Meld meg av'}</button></form></>}
      <p style={{ marginTop: 18 }}><Link href="/" className="muted">mountainretreat.no</Link></p>
    </div></main>
  );
}
