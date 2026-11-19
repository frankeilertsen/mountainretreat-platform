import { NextRequest } from 'next/server';
import { exportFeed } from '@/lib/channels/sync';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Secret per-channel export feed. Contains only "Blocked" date ranges – never guest data. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try { await rateLimit(`ical:${req.headers.get('x-forwarded-for') ?? 'x'}`, 120, 3600); } catch { return new Response('Too many requests', { status: 429 }); }
  const body = await exportFeed(token.replace(/\.ics$/, ''));
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
