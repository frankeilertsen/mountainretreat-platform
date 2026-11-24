import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { storageBackend } from '@/lib/storage';
import fs from 'fs/promises';
import path from 'path';

/** Local disk: is the storage folder there and writable? (On Render it is the persistent disk.) */
async function diskStatus() {
  const dir = path.resolve(process.env.STORAGE_DIR || './storage');
  try { await fs.mkdir(dir, { recursive: true }); await fs.access(dir, (await import('fs')).constants.W_OK); return `disk (${dir})`; }
  catch { return `disk IKKE skrivbar (${dir})`; }
}

export const dynamic = 'force-dynamic';

/** Health check for uptime monitoring and setup: what is configured (never any secret values). */
export async function GET() {
  const config = {
    storage: storageBackend() === 'supabase' ? 'supabase' : await diskStatus(),
    email: process.env.RESEND_API_KEY ? 'resend' : 'kun logg (ingen e-post sendes)',
    app_url: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'MANGLER',
    secrets: ['ENCRYPTION_KEY', 'TOKEN_PEPPER', 'CRON_SECRET'].filter(k => !process.env[k]).map(k => `${k} mangler`),
    card_payments: process.env.STRIPE_SECRET_KEY ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'stripe (testmodus)' : 'stripe') : process.env.ALLOW_MOCK_PAYMENTS === '1' ? 'testbetaling' : 'av',
  };
  try {
    const m = await one<{ n: number; last: string }>(`SELECT count(*)::int AS n, max(name) AS last FROM schema_migrations`);
    const admins = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE system_role='super_admin' AND status='active'`);
    const job = await one<{ at: string | null }>(`SELECT max(finished_at) AS at FROM job_runs WHERE status='success'`);
    const jobs = job?.at ? `siste kjøring ${Math.round((Date.now() - new Date(job.at).getTime()) / 1000)} s siden` : 'ingen kjøring ennå';
    return NextResponse.json({ ok: config.secrets.length === 0, database: 'ok', migrations: `${m?.n} (${m?.last})`, admins: admins?.n ?? 0, jobs, ...config });
  } catch (e) {
    return NextResponse.json({ ok: false, database: `feil: ${(e as Error).message.slice(0, 160)}`, ...config }, { status: 503 });
  }
}
