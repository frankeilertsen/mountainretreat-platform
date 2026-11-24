import { publicHost } from '@/lib/http';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, clientIp } from '@/lib/auth/current';
import { can } from '@/lib/auth/rbac';
import { actorFor, audit } from '@/lib/audit';
import { restoreFiles } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Puts photos/PDFs from a backup archive back (only missing files the database refers to). Main administrators only. */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || s.aal < 2) return NextResponse.json({ error: 'Du må logge inn på nytt.' }, { status: 401 });
  if (!can(s as any, 'manage_admins')) return NextResponse.json({ error: 'Kun hovedadministrator kan gjøre dette.' }, { status: 403 });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host.toLowerCase() !== publicHost(req.headers)) return NextResponse.json({ error: 'Ugyldig forespørsel.' }, { status: 403 });
  if (!req.body) return NextResponse.json({ error: 'Velg en sikkerhetskopi (.tar.gz).' }, { status: 400 });
  try {
    const r = await restoreFiles(req.body);
    await audit(null, actorFor(s as any, await clientIp()), 'backup.files_restored', 'system', null, undefined, r);
    return NextResponse.json(r);
  } catch (e) {
    console.error('[restore]', e);
    return NextResponse.json({ error: 'Filen kunne ikke leses. Er det en sikkerhetskopi fra denne siden (.tar.gz)?' }, { status: 400 });
  }
}
