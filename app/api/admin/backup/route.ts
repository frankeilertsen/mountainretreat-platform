import { getSession, clientIp } from '@/lib/auth/current';
import { can } from '@/lib/auth/rbac';
import { actorFor, audit } from '@/lib/audit';
import { createBackupStream } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Full off-site backup (files + database copy). Main administrators only; every download is logged. */
export async function GET() {
  const s = await getSession();
  if (!s || s.aal < 2) return new Response('Unauthorized', { status: 401 });
  if (!can(s as any, 'manage_admins')) return new Response('Forbidden', { status: 403 });
  await audit(null, actorFor(s as any, await clientIp()), 'backup.downloaded', 'system', null);
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
  return new Response(createBackupStream(), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="mountainretreat-sikkerhetskopi-${day}.tar.gz"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
