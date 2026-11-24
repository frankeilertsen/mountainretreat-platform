import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { storageBackend } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Health check for uptime monitoring and setup: what is configured (never any secret values). */
export async function GET() {
  const config = {
    storage: storageBackend() === 'supabase' ? 'supabase' : 'lokal disk (virker ikke på Vercel)',
    email: process.env.RESEND_API_KEY ? 'resend' : 'kun logg (ingen e-post sendes)',
    app_url: process.env.APP_URL ?? 'MANGLER',
    secrets: ['ENCRYPTION_KEY', 'TOKEN_PEPPER', 'CRON_SECRET'].filter(k => !process.env[k]).map(k => `${k} mangler`),
    card_payments: process.env.STRIPE_SECRET_KEY ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'stripe (testmodus)' : 'stripe') : process.env.ALLOW_MOCK_PAYMENTS === '1' ? 'testbetaling' : 'av',
  };
  try {
    const m = await one<{ n: number; last: string }>(`SELECT count(*)::int AS n, max(name) AS last FROM schema_migrations`);
    const admins = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE system_role='super_admin' AND status='active'`);
    return NextResponse.json({ ok: config.secrets.length === 0, database: 'ok', migrations: `${m?.n} (${m?.last})`, admins: admins?.n ?? 0, ...config });
  } catch (e) {
    return NextResponse.json({ ok: false, database: `feil: ${(e as Error).message.slice(0, 160)}`, ...config }, { status: 503 });
  }
}
