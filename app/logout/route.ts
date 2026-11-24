import { redirectTo } from '@/lib/http';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/auth/current';
import { revokeSession } from '@/lib/auth/sessions';

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s) await revokeSession(s.session_id);
  const res = redirectTo('/login?ok=' + encodeURIComponent('Du er logget ut.'), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
