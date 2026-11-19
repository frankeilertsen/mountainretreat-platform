import { NextRequest, NextResponse } from 'next/server';
import { consumeMagicLink } from '@/lib/domain/auth';
import { SESSION_COOKIE } from '@/lib/auth/current';
import { DomainError } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  try {
    const session = await consumeMagicLink(token, ip, req.headers.get('user-agent'));
    const res = NextResponse.redirect(new URL('/auth/totp', req.url));
    res.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 86400 });
    return res;
  } catch (e) {
    const msg = e instanceof DomainError ? e.message : 'Innloggingen feilet.';
    return NextResponse.redirect(new URL('/login?feil=' + encodeURIComponent(msg), req.url));
  }
}
