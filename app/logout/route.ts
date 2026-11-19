import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/auth/current';
import { revokeSession } from '@/lib/auth/sessions';

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s) await revokeSession(s.session_id);
  const res = NextResponse.redirect(new URL('/login?ok=' + encodeURIComponent('Du er logget ut.'), req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
