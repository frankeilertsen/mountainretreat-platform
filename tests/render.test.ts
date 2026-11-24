import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { Client } from 'pg';
import { getPool, one, q } from '../lib/db';
import { user } from './factory';
import { actorFor } from '../lib/audit';
import { uploadPresentation } from '../lib/domain/presentations';
import { createBackupStream, restoreFiles } from '../lib/backup';
import { tick } from '../lib/scheduler';
import { migrate } from '../scripts/migrate';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-render-'));
  process.env.STORAGE_DIR = path.join(dir, 'storage');
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
});
const pdf = (s: string) => new File([Buffer.from(`%PDF-1.4\n${s}\n%%EOF\n`)], 'Hytta.pdf');
async function download(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of createBackupStream() as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  const file = path.join(dir, `backup-${Date.now()}.tar.gz`);
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

describe('Render: files on the disk, own backup, first admin, background jobs', () => {
  it('backup contains every file and table (but no sessions/login links), and missing files can be put back', async () => {
    const admin = await user('admin');
    const id = await uploadPresentation(admin, { title: 'Til backup', file: pdf('backup-1') }, actorFor(admin));
    const key = (await one<{ k: string }>(`SELECT storage_key AS k FROM presentations WHERE id=$1`, [id]))!.k;
    const archive = await download();
    const list = execFileSync('tar', ['-tzf', archive]).toString().split('\n');
    expect(list).toContain(`files/${key}`);
    expect(list).toContain('database/users.ndjson');
    expect(list).toContain('database/bookings.ndjson');
    expect(list).toContain('manifest.json');
    expect(list.some(l => /sessions|login_tokens/.test(l))).toBe(false);
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', archive, 'manifest.json']).toString());
    expect(manifest.tables.users).toBeGreaterThan(0);
    const usersLine = execFileSync('tar', ['-xzOf', archive, 'database/users.ndjson']).toString().split('\n')[0];
    expect(JSON.parse(usersLine)).toHaveProperty('email');

    // The disk loses the file → restore from the archive puts it back (and nothing else)
    fs.unlinkSync(path.join(process.env.STORAGE_DIR!, key));
    const r1 = await restoreFiles(fs.createReadStream(archive) as unknown as AsyncIterable<Uint8Array>);
    expect(r1.restored).toBe(1);
    expect(fs.readFileSync(path.join(process.env.STORAGE_DIR!, key)).toString()).toContain('backup-1');
    const r2 = await restoreFiles(fs.createReadStream(archive) as unknown as AsyncIterable<Uint8Array>);
    expect(r2.restored).toBe(0);
    expect(r2.alreadyThere).toBeGreaterThanOrEqual(1);

    // An archive with unknown files or path tricks is ignored
    const evil = path.join(dir, 'evil'); fs.mkdirSync(path.join(evil, 'files/presentations'), { recursive: true });
    fs.writeFileSync(path.join(evil, 'files/presentations/00000000-0000-0000-0000-000000000000.pdf'), 'x');
    fs.writeFileSync(path.join(evil, 'notes.txt'), 'x');
    const evilTar = path.join(dir, 'evil.tar.gz');
    execFileSync('tar', ['-czf', evilTar, '-C', evil, 'files', 'notes.txt']);
    const r3 = await restoreFiles(fs.createReadStream(evilTar) as unknown as AsyncIterable<Uint8Array>);
    expect(r3.restored).toBe(0);
    expect(r3.skipped).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(process.env.STORAGE_DIR!, 'presentations/00000000-0000-0000-0000-000000000000.pdf'))).toBe(false);
    await expect(restoreFiles(fs.createReadStream(path.join(evil, 'notes.txt')) as unknown as AsyncIterable<Uint8Array>)).rejects.toThrow();
  });

  it('first deploy creates the first administrator from INITIAL_ADMIN_EMAIL, only once', async () => {
    const admin = new Client({ connectionString: 'postgres://postgres@localhost:5432/postgres' });
    await admin.connect();
    const name = `mr_render_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    try {
      process.env.INITIAL_ADMIN_EMAIL = 'Frank@MountainRetreat.no'; process.env.INITIAL_ADMIN_NAME = 'Frank';
      const url = `postgres://postgres@localhost:5432/${name}`;
      await migrate(url);
      await migrate(url); // second deploy: nothing new
      const c = new Client({ connectionString: url }); await c.connect();
      const rows = (await c.query(`SELECT email, name, system_role, status FROM users`)).rows;
      expect(rows).toEqual([{ email: 'frank@mountainretreat.no', name: 'Frank', system_role: 'super_admin', status: 'active' }]);
      const settings = (await c.query(`SELECT count(*)::int AS n FROM platform_settings`)).rows[0].n;
      expect(settings).toBeGreaterThan(10);
      await c.end();
    } finally {
      delete process.env.INITIAL_ADMIN_EMAIL; delete process.env.INITIAL_ADMIN_NAME;
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('background jobs run every minute in one process only (database lock)', async () => {
    const before = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM job_runs`))!.n;
    // Another instance holds the lock → this one skips
    const other = await getPool().connect();
    await other.query('SELECT pg_advisory_lock(727100001)');
    await tick();
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM job_runs`))!.n).toBe(before);
    await other.query('SELECT pg_advisory_unlock(727100001)'); other.release();
    // Lock free → jobs run
    await tick();
    const after = await q<{ job: string; status: string }>(`SELECT job, status FROM job_runs ORDER BY started_at DESC LIMIT 20`);
    expect(after.length).toBeGreaterThan(0);
    expect(after.some(r => r.job === 'deliver_notifications')).toBe(true);
  });
});
