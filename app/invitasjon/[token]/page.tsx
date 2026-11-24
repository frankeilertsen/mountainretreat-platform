import { Logo } from '@/components/Logo';
import Link from 'next/link';
import { getInvitationByToken } from '@/lib/domain/invitations';
import { Flash } from '@/components/ui';
import { acceptInviteAction } from '../../actions/auth';
import { chosenLang, getT } from '@/lib/i18n/lang';
import { dict } from '@/lib/i18n/dict';
import { inviteBenefits } from '@/lib/domain/inviteBenefits';
import { LangSwitch } from '@/components/LangSwitch';

export const metadata = { title: 'Invitasjon' };
export const dynamic = 'force-dynamic';

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const inv = await getInvitationByToken(token);
  // Use the language the invitation was sent in, unless the visitor has picked one with the flags
  const picked = await chosenLang();
  const lang = picked ?? inv?.lang ?? (await getT()).lang;
  const t = dict[lang];
  const T = t.invite;
  const invalid = !inv ? T.notFound : inv.status === 'accepted' ? T.used
    : inv.status === 'revoked' ? T.revoked : (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) ? T.expired : null;
  const helper = inv?.role === 'helper';
  const benefits = !invalid && !helper ? await inviteBenefits(lang) : [];
  return (
    <div className="narrow" style={{ position: 'relative', maxWidth: benefits.length ? 760 : undefined }}>
      <LangSwitch lang={lang} className="lang-corner" />
      <div style={{ textAlign: 'center' }}><Logo width={240} /></div>
      <div className="card" style={{ marginTop: 28 }}>
        {invalid ? (<><h1>{T.invalidTitle}</h1><p>{invalid}</p><Link className="btn" href="/login">{T.toLogin}</Link></>) : (
          <>
            <span className="eyebrow">{helper ? T.cleaning : T.from(inv!.inviter_name)}</span>
            <h1>{helper ? T.welcome(inv!.invitee_name) : T.welcomeClub(inv!.invitee_name)}</h1>
            {benefits.length > 0 && (
              <section className="invite-benefits">
                <h3>{T.benefitsTitle}</h3>
                <div className="ib-grid">{benefits.map(b => <div key={b.title} className="ib"><strong>{b.title}</strong><p className="muted">{b.text}</p></div>)}</div>
                {inv!.presentation_title && (
                  <a className="pres-link" href={`/invitasjon/${token}/presentasjon`} target="_blank" rel="noopener">
                    <span className="pdf-ico" aria-hidden="true">PDF</span><span><strong>{T.presentation}</strong><br /><small className="muted">{inv!.presentation_title} – {T.presentationText}</small></span>
                  </a>)}
              </section>)}
            {benefits.length > 0 && <h3 style={{ marginTop: 28 }}>{T.createTitle}</h3>}
            <p>{helper ? T.helperText(inv!.property_name, inv!.invitee_email) : T.memberText(inv!.invitee_email)}</p>
            <Flash sp={sp} lang={lang} />
            <form action={acceptInviteAction}>
              <input type="hidden" name="token" value={token} />
              <div className="field"><label htmlFor="name">{T.name}</label><input id="name" name="name" required defaultValue={inv!.invitee_name ?? ''} autoComplete="name" /></div>
              <div className="field"><label htmlFor="email">{T.email}</label><input id="email" value={inv!.invitee_email} disabled /></div>
              <div className="field"><label htmlFor="phone">{helper ? T.phoneHelper : T.phone}</label><input id="phone" name="phone" type="tel" autoComplete="tel" required={helper} placeholder="+47 …" /></div>
              <label className="check field"><input type="checkbox" name="terms" required /> <span>{T.terms} <Link href="/personvern" target="_blank">{T.privacyLink}</Link>.</span></label>
              {!helper && <label className="check field"><input type="checkbox" name="marketing" /> <span>{T.marketing}</span></label>}
              <button className="btn block">{helper ? T.createHelper : T.createMember}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
