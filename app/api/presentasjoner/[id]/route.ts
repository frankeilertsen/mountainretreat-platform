import { getSession } from '@/lib/auth/current';
import { can, isAdmin } from '@/lib/auth/rbac';
import { presentationForResponse } from '@/lib/domain/presentations';

export const dynamic = 'force-dynamic';

/** Presentations: admins see all (also deactivated), logged-in members see active ones. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || s.aal < 2) return new Response('Unauthorized', { status: 401 });
  if (!can(s as any, 'request_booking')) return new Response('Forbidden', { status: 403 });
  const res = await presentationForResponse(id, { includeInactive: isAdmin(s as any), download: new URL(req.url).searchParams.has('last-ned') });
  return res ?? new Response('Not found', { status: 404 });
}
