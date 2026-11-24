import { getPool } from './db';
import { runAllJobs } from './jobs';

/**
 * Background jobs inside the web server (used on Render, where the app runs as one always-on service).
 * Every minute: take a Postgres advisory lock so only ONE process runs the jobs even if two instances
 * overlap briefly (e.g. during a deploy), run all jobs, release the lock. Turned on with RUN_JOBS_IN_PROCESS=1.
 */
const LOCK_KEY = 727_100_001; // arbitrary, app-wide constant
let started = false;
let running = false;

export async function tick() {
  if (running) return;
  running = true;
  const client = await getPool().connect().catch(e => { console.error('[jobs] no db connection', e.message); return null; });
  if (!client) { running = false; return; }
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0]?.ok) return; // another process is running the jobs
    try {
      const out = await runAllJobs();
      const failed = Object.entries(out).filter(([, v]) => v && typeof v === 'object' && 'error' in (v as object));
      if (failed.length) console.error('[jobs] failed:', JSON.stringify(Object.fromEntries(failed)));
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } catch (e) {
    console.error('[jobs]', (e as Error).message);
  } finally {
    client.release();
    running = false;
  }
}

export function startInProcessScheduler(intervalMs = 60_000) {
  if (started) return;
  started = true;
  console.log(`[jobs] in-process scheduler started (every ${Math.round(intervalMs / 1000)} s)`);
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, intervalMs).unref?.();
}
