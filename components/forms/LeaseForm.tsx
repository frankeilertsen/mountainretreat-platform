'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { longTermInquiryAction, type LeaseFormState } from '@/app/actions/public';
import { CaptchaField, type ChallengeProp } from './Captcha';

type T = Record<string, any>;

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return <button className="btn block" disabled={pending}>{pending ? busy : label}</button>;
}

export function LeaseForm({ T, privacy, lang, props, minDate, challenge }: { T: T; privacy: string; lang: 'no' | 'en'; props: { id: string; name: string }[]; minDate: string; challenge: ChallengeProp }) {
  const [st, action] = useActionState<LeaseFormState, FormData>(longTermInquiryAction, { n: 0 });
  const v = st.values ?? {};
  return (
    <>
      {st.error && <div className="flash err" role="alert">{st.error}</div>}
      {/* key remounts the inputs so the values the visitor typed are restored after an error */}
      <form action={action} className="card" key={st.n}>
        <div className="fields">
          <div><label htmlFor="name">{T.name}</label><input id="name" name="name" required autoComplete="name" defaultValue={v.name} /></div>
          <div><label htmlFor="phone">{T.phone}</label><input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} /></div>
        </div>
        <div className="field" style={{ marginTop: 14 }}><label htmlFor="email">{T.email}</label><input id="email" name="email" type="email" required autoComplete="email" defaultValue={v.email} /></div>
        <div className="fields">
          <div><label htmlFor="propertyId">{T.property}</label><select id="propertyId" name="propertyId" defaultValue={v.propertyId ?? ''}><option value="">{T.any}</option>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label htmlFor="moveIn">{T.moveIn}</label><input id="moveIn" name="moveIn" type="date" min={minDate} defaultValue={v.moveIn} /></div>
        </div>
        <div className="fields" style={{ marginTop: 14 }}>
          <div><label htmlFor="duration">{T.duration}</label><select id="duration" name="duration" defaultValue={v.duration ?? ''}><option value="">{T.choose}</option>{(T.durations as string[]).map(d => <option key={d}>{d}</option>)}</select></div>
          <div><label htmlFor="persons">{T.persons}</label><input id="persons" name="persons" type="number" min={1} max={20} defaultValue={v.persons} /></div>
        </div>
        <div className="field" style={{ marginTop: 14 }}><label htmlFor="message">{T.message}</label><textarea id="message" name="message" required minLength={10} rows={5} placeholder={T.messagePh} defaultValue={v.message} /></div>
        {/* Honeypot – hidden from people, filled in by bots */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <input type="hidden" name="lang" value={lang} />
        <CaptchaField challenge={(st.challenge ?? challenge) as ChallengeProp} labels={T as any} lang={lang} />
        <label className="check field"><input type="checkbox" name="consent" required defaultChecked={!!v.consent} /> <span>{T.consent} (<Link href="/personvern" target="_blank">{privacy.toLowerCase()}</Link>).</span></label>
        <Submit label={T.submit} busy={T.sending} />
      </form>
    </>
  );
}
