import { Logo } from '@/components/Logo';
import Link from 'next/link';
import { getInvitationByToken } from '@/lib/domain/invitations';
import { Flash } from '@/components/ui';
import { acceptInviteAction } from '../../actions/auth';

export const metadata = { title: 'Invitasjon' };
export const dynamic = 'force-dynamic';

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const inv = await getInvitationByToken(token);
  const invalid = !inv ? 'Invitasjonen finnes ikke.' : inv.status === 'accepted' ? 'Denne invitasjonen er allerede brukt. Logg inn i stedet.'
    : inv.status === 'revoked' ? 'Invitasjonen er trukket tilbake.' : (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) ? 'Invitasjonen er utløpt. Be om en ny.' : null;
  return (
    <div className="narrow">
      <div style={{ textAlign: 'center' }}><Logo width={240} /></div>
      <div className="card" style={{ marginTop: 28 }}>
        {invalid ? (<><h1>Ugyldig invitasjon</h1><p>{invalid}</p><Link className="btn" href="/login">Til innlogging</Link></>) : (
          <>
            <span className="eyebrow">{inv!.role === 'helper' ? 'Renholdsportal' : `Invitasjon fra ${inv!.inviter_name}`}</span>
            <h1>Velkommen{inv!.invitee_name ? `, ${inv!.invitee_name}` : ''}</h1>
            {inv!.role === 'helper'
              ? <p>Registrer deg som renholder{inv!.property_name ? ` for ${inv!.property_name}` : ''}. Du får varsel på e-post og SMS om nye bookinger og påminnelse samme dag som det skal vaskes. Innlogging skjer med <strong>{inv!.invitee_email}</strong> og en kode fra en autentiseringsapp.</p>
              : <p>Opprett kontoen din for <strong>{inv!.invitee_email}</strong>. Deretter setter du opp tofaktor med en autentiseringsapp.</p>}
            <Flash sp={sp} />
            <form action={acceptInviteAction}>
              <input type="hidden" name="token" value={token} />
              <div className="field"><label htmlFor="name">Fullt navn</label><input id="name" name="name" required defaultValue={inv!.invitee_name ?? ''} autoComplete="name" /></div>
              <div className="field"><label htmlFor="email">E-post</label><input id="email" value={inv!.invitee_email} disabled /></div>
              <div className="field"><label htmlFor="phone">{inv!.role === 'helper' ? 'Mobil (for SMS-varsler)' : 'Mobil (valgfritt)'}</label><input id="phone" name="phone" type="tel" autoComplete="tel" required={inv!.role === 'helper'} placeholder="+47 …" /></div>
              <label className="check field"><input type="checkbox" name="terms" required /> <span>Jeg godtar vilkårene og har lest <Link href="/personvern" target="_blank">personvernerklæringen</Link>.</span></label>
              {inv!.role !== 'helper' && <label className="check field"><input type="checkbox" name="marketing" /> <span>Ja takk, gi meg beskjed om ledige perioder og nyheter (valgfritt).</span></label>}
              <button className="btn block">{inv!.role === 'helper' ? 'Registrer meg' : 'Opprett konto'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
