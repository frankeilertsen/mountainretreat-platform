import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE } from '@/lib/i18n/lang';
import { getSession } from '@/lib/auth/current';
import { getPool } from '@/lib/db';

/** Sets the language cookie and sends the visitor back to the page they came from (same origin only). */
export async function GET(req: NextRequest) {
  const l = req.nextUrl.searchParams.get('l') === 'en' ? 'en' : 'no';
  let back = '/';
  const ref = req.headers.get('referer');
  if (ref) {
    try { const u = new URL(ref); if (u.host === req.nextUrl.host) back = u.pathname + u.search; } catch { /* ignore */ }
  }
  // Remember the choice on the account too, so e-mails (e.g. message notices) use the same language
  const s = await getSession().catch(() => null);
  if (s) await getPool().query(`UPDATE users SET preferred_lang=$2 WHERE id=$1 AND preferred_lang<>$2`, [s.id, l]);
  const res = NextResponse.redirect(new URL(back, req.url), 303);
  res.cookies.set(LANG_COOKIE, l, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return res;
}
