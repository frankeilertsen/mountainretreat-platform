import { requireUser } from '@/lib/auth/current';
import { one } from '@/lib/db';
import { Flash } from '@/components/ui';
import { updateProfileAction, anonymizeAction } from '../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profil' };

export default async function Profile({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const extra = await one<{ marketing_consent: boolean; referral_code: string | null }>('SELECT marketing_consent, referral_code FROM users WHERE id=$1', [u.id]);
  return (
    <>
      <div className="page-head"><h1>Profil</h1></div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <form action={updateProfileAction}>
            <div className="field"><label>Navn</label><input name="name" defaultValue={u.name} required /></div>
            <div className="field"><label>E-post</label><input value={u.email} disabled /><small className="muted">Kontakt administrator for å endre e-post.</small></div>
            <div className="field"><label>Mobil</label><input name="phone" defaultValue={u.phone ?? ''} /></div>
            <label className="check field"><input type="checkbox" name="marketing" defaultChecked={extra?.marketing_consent} /> Ja takk til nyheter og ledige perioder</label>
            <button className="btn">Lagre</button>
          </form>
        </div>
        <div className="stack">
          <div className="card flat"><h3>Sikkerhet</h3><p className="muted">Innlogging med e-postlenke og tofaktor. Mistet telefonen? Bruk en gjenopprettingskode, eller kontakt administrator.</p>
            <form action="/logout" method="post"><button className="btn ghost small">Logg ut</button></form></div>
          <div className="card flat"><h3>Dine data</h3><p className="muted">Last ned alt vi har lagret om deg (bookinger, betalinger, bonus, invitasjoner).</p><a className="btn ghost small" href="/api/medlem/eksport">Last ned (JSON)</a></div>
          <div className="card flat" style={{ borderColor: 'var(--danger-soft)' }}>
            <h3>Slett konto</h3><p className="muted">Navn, e-post og telefon fjernes. Regnskapsopplysninger beholdes anonymisert i 5 år (bokføringsloven).</p>
            <form action={anonymizeAction} className="row"><input name="confirm" placeholder="Skriv SLETT" style={{ maxWidth: 160 }} /><button className="btn danger small">Anonymiser konto</button></form>
          </div>
        </div>
      </div>
    </>
  );
}
