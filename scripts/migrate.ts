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
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate(process.env.DATABASE_URL!, process.argv.includes('--reset'))
    .then(() => console.log('migrations up to date'))
    .catch(e => { console.error(e); process.exit(1); });
}
