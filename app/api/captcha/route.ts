import { NextResponse } from 'next/server';
import { issueChallenge } from '@/lib/captcha';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/auth/current';
import { DomainError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** A fresh verification picture ("Ny kode" button). Never returns the answer. */
export async function GET() {
  try { await rateLimit(`captcha:${(await clientIp()) ?? 'x'}`, 60, 3600); }
  catch (e) { if (e instanceof DomainError) return NextResponse.json({ error: 'rate_limited' }, { status: 429 }); throw e; }
  return NextResponse.json(issueChallenge(), { headers: { 'Cache-Control': 'no-store' } });
}
