import { Pool, PoolClient, QueryResultRow } from 'pg';

declare global { // reuse pool across hot reloads in dev
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
    });
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
