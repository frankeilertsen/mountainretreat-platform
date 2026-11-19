import { NextRequest, NextResponse } from 'next/server';
import { runAllJobs, runJob, JOBS } from '@/lib/jobs';
import { safeEqual } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Scheduler entry point. Call every minute: curl -H "x-cron-secret: $CRON_SECRET" https://…/api/cron[?job=name] */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get('x-cron-secret') ?? req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!secret || !safeEqual(got, secret)) return new NextResponse('Unauthorized', { status: 401 });
  const job = req.nextUrl.searchParams.get('job');
  if (job && !JOBS[job]) return new NextResponse('Unknown job', { status: 400 });
  const result = job ? await runJob(job) : await runAllJobs();
  return NextResponse.json({ ok: true, result });
}
export const GET = handle;
export const POST = handle;
