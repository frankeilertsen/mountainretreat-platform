import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE } from '@/lib/i18n/lang';

/** Sets the language cookie and sends the visitor back to the page they came from (same origin only). */
export async function GET(req: NextRequest) {
  const l = req.nextUrl.searchParams.get('l') === 'en' ? 'en' : 'no';
  let back = '/';
  const ref = req.headers.get('referer');
  if (ref) {
    try { const u = new URL(ref); if (u.host === req.nextUrl.host) back = u.pathname + u.search; } catch { /* ignore */ }
  }
  const res = NextResponse.redirect(new URL(back, req.url), 303);
  res.cookies.set(LANG_COOKIE, l, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return res;
}
