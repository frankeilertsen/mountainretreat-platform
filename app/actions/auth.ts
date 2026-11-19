'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { run, str } from '@/lib/actions';
import { requestMagicLink, elevateSession } from '@/lib/domain/auth';
import { acceptInvitation } from '@/lib/domain/invitations';
import { verifyTotp } from '@/lib/auth/totp';
import { clientIp, getSession, setSessionCookie } from '@/lib/auth/current';
import { createSession } from '@/lib/auth/sessions';
import { homeFor } from '@/lib/auth/rbac';
import { one } from '@/lib/db';
import { audit } from '@/lib/audit';
import { DomainError } from '@/lib/errors';

export async function loginAction(f: FormData) {
  const ip = await clientIp();
  await run('/login', async () => {
    await requestMagicLink(str(f, 'email'), ip);
    return { redirect: '/login?sendt=1' };
  });
}

export async function totpAction(f: FormData) {
  const s = await getSession();
  if (!s) redirect('/login');
  const ip = await clientIp();
  await run('/auth/totp', async () => {
    const { recoveryCodes } = await verifyTotp(s.id, str(f, 'code'), { id: s.id, type: 'anonymous', ip });
    await elevateSession(s.session_id);
    await audit(null, { id: s.id, type: 'anonymous', ip }, 'auth.login', 'user', s.id);
    if (recoveryCodes) return { redirect: '/auth/totp?koder=' + recoveryCodes.join(',') };
    return { redirect: homeFor(s as any) };
  });
}

export async function acceptInviteAction(f: FormData) {
  const token = str(f, 'token');
  const ip = await clientIp();
  const ua = (await headers()).get('user-agent');
  await run(`/invitasjon/${token}`, async () => {
    if (!f.get('terms')) throw new DomainError('terms', 'Du må godta vilkårene.');
    const r = await acceptInvitation(token, { name: str(f, 'name'), phone: str(f, 'phone'), marketingConsent: !!f.get('marketing') }, ip, ua);
    await setSessionCookie(r.sessionToken);
    return { redirect: '/auth/totp' };
  });
}

/** DEV ONLY: bypasses magic link + TOTP. Disabled unless DEV_LOGIN=1 and not production. */
export async function devLoginAction(f: FormData) {
  if (process.env.DEV_LOGIN !== '1' || process.env.NODE_ENV === 'production') throw new Error('disabled');
  const u = await one<{ id: string; system_role: string }>(`SELECT id, system_role FROM users WHERE id=$1 AND status='active'`, [str(f, 'id')]);
  if (!u) redirect('/login');
  const token = await createSession(u.id, u.system_role, { aal: 2, ip: await clientIp() });
  await setSessionCookie(token);
  await audit(null, { id: u.id, type: 'anonymous' }, 'auth.dev_login', 'user', u.id);
  redirect(homeFor(u as any));
}
