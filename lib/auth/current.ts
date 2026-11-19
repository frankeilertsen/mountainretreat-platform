import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadSession, SessionUser } from './sessions';
import { can, homeFor, Permission } from './rbac';
import { forbidden } from '../errors';

export const SESSION_COOKIE = 'mr_session';

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || h.get('x-real-ip') || null;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24,
  });
}
export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Current session, any assurance level. */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return loadSession(token);
}

/** Fully authenticated user (magic link + TOTP). Redirects otherwise. For pages. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.aal < 2) redirect('/auth/totp');
  if (permission && !can(s as any, permission)) redirect(homeFor(s as any));
  return s;
}

/** Same as requireUser but throws (for server actions / route handlers). */
export async function assertUser(permission?: Permission): Promise<SessionUser> {
  const s = await getSession();
  if (!s || s.aal < 2) throw forbidden('Du må logge inn på nytt.');
  if (permission && !can(s as any, permission)) throw forbidden();
  return s;
}
