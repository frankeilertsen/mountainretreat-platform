import { Pool, PoolClient, QueryResultRow } from 'pg';

declare global { // reuse pool across hot reloads in dev
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

/**
 * Connection settings.
 * - Supabase (and other hosted Postgres): TLS is used when the URL asks for it (sslmode=require/verify-full) or DATABASE_SSL=1.
 *   With DATABASE_CA_CERT (the CA certificate from Supabase → Database settings → SSL) the server certificate is verified;
 *   without it the connection is still encrypted but the certificate isn't checked.
 * - On Vercel each function instance keeps a small pool (default 3) and talks to Supabase's transaction pooler (port 6543).
 */
export function poolConfig(url = process.env.DATABASE_URL ?? '') {
  let connectionString = url, wantsSsl = process.env.DATABASE_SSL === '1';
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    if (mode && mode !== 'disable') wantsSsl = true;
    // pg would let sslmode in the URL override the explicit ssl object below, so take it out
    u.searchParams.delete('sslmode'); u.searchParams.delete('sslrootcert'); u.searchParams.delete('uselibpqcompat');
    connectionString = u.toString();
  } catch { /* not a URL – leave as is */ }
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  return {
    connectionString,
    ssl: wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined,
    max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = new Pool(poolConfig());
  }
  return global.__pgPool;
}

export type Db = Pool | PoolClient;

export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = getPool()): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = getPool()): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

/** Run fn inside a transaction. Rolls back on any thrown error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function isPgError(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as any).code === code;
}
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';
