import { Db, getPool, q } from './db';

export async function getSettings(db: Db = getPool()): Promise<Record<string, string>> {
  const rows = await q<{ key: string; value: string }>('SELECT key, value FROM platform_settings', [], db);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
export async function getNum(key: string, fallback: number, db: Db = getPool()): Promise<number> {
  const rows = await q<{ value: string }>('SELECT value FROM platform_settings WHERE key = $1', [key], db);
  const n = rows[0] ? Number(rows[0].value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
export async function getStr(key: string, fallback: string, db: Db = getPool()): Promise<string> {
  const rows = await q<{ value: string }>('SELECT value FROM platform_settings WHERE key = $1', [key], db);
  return rows[0]?.value ?? fallback;
}
