import { getInvitationByToken } from '@/lib/domain/invitations';
import { presentationForResponse } from '@/lib/domain/presentations';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/auth/current';
import { DomainError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** The presentation attached to an invitation – available to whoever has the (secret) invitation link while it is still valid. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try { await rateLimit(`pres:${(await clientIp()) ?? 'x'}`, 60, 3600); }
  catch (e) { if (e instanceof DomainError) return new Response('Too many requests', { status: 429 }); throw e; }
  const inv = await getInvitationByToken(token);
  if (!inv || inv.status !== 'pending' || new Date(inv.expires_at) < new Date() || !inv.presentation_id) return new Response('Not found', { status: 404 });
  return (await presentationForResponse(inv.presentation_id, { includeInactive: true })) ?? new Response('Not found', { status: 404 });
}
