import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/rbac';
import { adminBadges, memberBadges, badgeSignature } from '@/lib/domain/badges';

export const dynamic = 'force-dynamic';

/** Menu badge fingerprint for the signed-in user (no content, only counts). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.aal < 2) return NextResponse.json({ sig: null }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const scope = new URL(req.url).searchParams.get('scope');
  const b = scope === 'admin' && isAdmin(s as any) ? await adminBadges() : await memberBadges(s.id);
  return NextResponse.json({ sig: badgeSignature(b) }, { headers: { 'Cache-Control': 'no-store' } });
}
