import './load-env';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { poolConfig } from '../lib/db';

export async function migrate(databaseUrl: string, reset = false) {
  const { connectionString, ssl } = poolConfig(databaseUrl);
  const client = new Client({ connectionString, ssl });
  await client.connect();
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log('applied', f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await ensureInitialAdmin(client);
  } finally {
    await client.end();
  }
}

/**
 * First administrator: if INITIAL_ADMIN_EMAIL is set and there is no active super-admin yet, create one.
 * They log in with an e-mail link and set up two-factor login the first time. Does nothing once an admin exists.
 */
export async function ensureInitialAdmin(client: Client) {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.warn('INITIAL_ADMIN_EMAIL is not a valid e-mail address – skipped'); return; }
  const has = await client.query(`SELECT 1 FROM users WHERE system_role='super_admin' AND status='active' LIMIT 1`);
  if (has.rowCount) return;
  const name = process.env.INITIAL_ADMIN_NAME?.trim() || email.split('@')[0];
  await client.query(`INSERT INTO users (email, name, system_role, status) VALUES ($1, $2, 'super_admin', 'active') ON CONFLICT DO NOTHING`, [email, name]);
  console.log('created first administrator', email);
}

if (require.main === module) {
  migrate(process.env.DATABASE_URL!, process.argv.includes('--reset'))
    .then(() => console.log('migrations up to date'))
    .catch(e => { console.error(e); process.exit(1); });
}
