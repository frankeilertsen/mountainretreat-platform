import crypto from 'crypto';
import svgCaptcha from 'svg-captcha';
import { Db, getPool, one } from './db';
import { DomainError } from './errors';
import { hmacSign, randomToken, safeEqual } from './crypto';

/**
 * Spam protection for public forms.
 *
 * - Built-in (default): a picture of letters and numbers drawn as vector paths (not text, so it cannot be read from the page source).
 *   The answer is never stored or sent to the browser; the form carries a signed token (nonce, time, HMAC of the answer).
 *   Each token can be used once (captcha_used), expires after 20 minutes, and is rejected if submitted faster than a human can type.
 * - Cloudflare Turnstile (optional): used instead when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.
 *   Turnstile usually needs no typing and is today's common standard; it contacts Cloudflare, so mention it in the privacy notice.
 */
const CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789'; // no 0/O, 1/I/L, Q
const MAX_AGE_MS = 20 * 60 * 1000;
const MIN_AGE_MS = 3000;

export type Challenge = { kind: 'builtin'; svg: string; token: string } | { kind: 'turnstile'; siteKey: string };

function secret() {
  const p = process.env.TOKEN_PEPPER;
  if (!p) throw new Error('TOKEN_PEPPER is not set');
  return 'captcha:' + p;
}
const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/0/g, 'O').replace(/[1I]/g, 'L');

export function captchaProvider(): 'turnstile' | 'builtin' {
  return process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? 'turnstile' : 'builtin';
}

/** Built-in picture + signed token. `answer` is for tests only – never send it to the browser. */
export function createBuiltinChallenge(now = Date.now()) {
  const c = svgCaptcha.create({ size: 5, charPreset: CHARS, noise: 3, color: false, background: '#efe8da', width: 180, height: 56, fontSize: 56 });
  const nonce = randomToken(12);
  const token = `${nonce}.${now}.${hmacSign(`${nonce}|${now}|${normalize(c.text)}`, secret())}`;
  return { svg: c.data, token, answer: c.text };
}

export function issueChallenge(): Challenge {
  if (captchaProvider() === 'turnstile') return { kind: 'turnstile', siteKey: process.env.TURNSTILE_SITE_KEY! };
  const { svg, token } = createBuiltinChallenge();
  return { kind: 'builtin', svg, token };
}

/** Throws a DomainError with a user-facing (Norwegian) message if the check fails. */
export async function verifyChallenge(f: { token?: string; answer?: string; turnstile?: string }, ip: string | null, db: Db = getPool(), now = Date.now()): Promise<void> {
  if (captchaProvider() === 'turnstile') return verifyTurnstile(f.turnstile ?? '', ip);
  const [nonce, ts, sig] = String(f.token ?? '').split('.');
  const issued = Number(ts);
  if (!nonce || !sig || !Number.isFinite(issued)) throw new DomainError('captcha', 'Bekreftelseskoden mangler. Last siden på nytt og prøv igjen.');
  if (now - issued > MAX_AGE_MS) throw new DomainError('captcha', 'Bekreftelseskoden er utløpt. Skriv inn den nye koden.');
  if (now - issued < MIN_AGE_MS) throw new DomainError('captcha', 'Skjemaet ble sendt for raskt. Prøv igjen.');
  // Burn the token before comparing: one attempt per picture, so the code cannot be guessed by retrying
  const fresh = await one(`INSERT INTO captcha_used (nonce) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nonce`, [nonce], db);
  if (!fresh) throw new DomainError('captcha', 'Bekreftelseskoden er allerede brukt. Skriv inn den nye koden.');
  const expected = hmacSign(`${nonce}|${issued}|${normalize(String(f.answer ?? ''))}`, secret());
  if (!safeEqual(expected, sig)) throw new DomainError('captcha', 'Feil bekreftelseskode. Prøv igjen med den nye koden.');
}

async function verifyTurnstile(token: string, ip: string | null) {
  if (!token) throw new DomainError('captcha', 'Bekreft at du ikke er en robot.');
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, idempotency_key: crypto.randomUUID() });
  if (ip) body.set('remoteip', ip);
  let ok = false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    ok = !!(await r.json())?.success;
  } catch (e) { console.error('[turnstile]', e); throw new DomainError('captcha', 'Kunne ikke bekrefte skjemaet akkurat nå. Prøv igjen om litt.'); }
  if (!ok) throw new DomainError('captcha', 'Bekreft at du ikke er en robot.');
}

/** Housekeeping (retention job): used nonces only matter while a token could still be valid. */
export async function purgeUsedCaptchas(db: Db = getPool()) {
  await db.query(`DELETE FROM captcha_used WHERE used_at < now() - interval '1 day'`);
}
