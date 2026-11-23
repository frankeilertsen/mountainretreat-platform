'use client';
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

export type ChallengeProp = { kind: 'builtin'; svg: string; token: string } | { kind: 'turnstile'; siteKey: string };
type Labels = { captcha: string; captchaHelp: string; newCode: string; captchaAlt: string; captchaHelpAlt: string };

/** Verification field: built-in letters-and-numbers picture (with "new code"), or Cloudflare Turnstile when configured. */
export function CaptchaField({ challenge, labels, lang }: { challenge: ChallengeProp; labels: Labels; lang: 'no' | 'en' }) {
  const [c, setC] = useState(challenge);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setC(challenge); if (input.current) input.current.value = ''; }, [challenge]);

  if (c.kind === 'turnstile') return (
    <div className="field">
      <label>{labels.captcha}</label>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={c.siteKey} data-theme="dark" data-language={lang === 'en' ? 'en' : 'nb'} data-response-field-name="cf-turnstile-response" />
    </div>
  );

  async function refresh() {
    setBusy(true);
    try { const r = await fetch('/api/captcha', { cache: 'no-store' }); if (r.ok) { setC(await r.json()); if (input.current) { input.current.value = ''; input.current.focus(); } } }
    finally { setBusy(false); }
  }
  return (
    <div className="field captcha">
      <label htmlFor="captcha">{labels.captcha}</label>
      <div className="captcha-row">
        <div className="captcha-img" role="img" aria-label={labels.captchaAlt} dangerouslySetInnerHTML={{ __html: c.svg }} />
        <button type="button" className="btn ghost small" onClick={refresh} disabled={busy} aria-label={labels.newCode}>↻ {labels.newCode}</button>
      </div>
      <input ref={input} id="captcha" name="captcha" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8} inputMode="text" style={{ display: 'block', maxWidth: 220, letterSpacing: '.2em', textTransform: 'uppercase' }} />
      <input type="hidden" name="captchaToken" value={c.token} />
      <small className="muted" style={{ display: 'block', marginTop: 8 }}>{labels.captchaHelp} {labels.captchaHelpAlt}</small>
    </div>
  );
}
