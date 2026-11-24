import zlib from 'zlib';
import { PassThrough, Readable } from 'stream';
import { getPool, q } from './db';
import { getObject, putObject } from './storage';

/**
 * Off-site copy for the administrator: one .tar.gz with
 *   files/<key>            every photo and PDF presentation the database refers to
 *   database/<table>.ndjson every table, one JSON row per line (sessions, login links, rate limits are left out)
 *   manifest.json          when, what, how many
 * Files can be put back with restoreFiles(); the database is restored with Render's own recovery (point-in-time or export),
 * the JSON copy is the last line of defence.
 */
const SKIP_TABLES = new Set(['sessions', 'login_tokens', 'rate_limits', 'captcha_used']);
const KEY_RE = /^[a-z_]+\/[0-9a-f-]{36}\.(pdf|jpeg|jpg|png|webp)$/i;

// ---- minimal ustar (tar) writer/reader – enough for regular files with names up to 255 characters
function header(name: string, size: number, mtime: Date): Buffer {
  const h = Buffer.alloc(512, 0);
  let prefix = '', base = name;
  if (Buffer.byteLength(name) > 100) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); base = name.slice(i + 1); }
  h.write(base, 0, 100, 'utf8');
  h.write('0000640\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(mtime.getTime() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const pad = (n: number) => Buffer.alloc((512 - (n % 512)) % 512, 0);

/** Streams the backup archive. Reads one file at a time, so memory stays small. */
export function createBackupStream(): ReadableStream<Uint8Array> {
  const tar = new PassThrough();
  const gz = zlib.createGzip({ level: 6 });
  tar.pipe(gz);
  const put = (name: string, data: Buffer, when = new Date()) =>
    new Promise<void>(res => { tar.write(header(name, data.length, when)); tar.write(data); if (!tar.write(pad(data.length))) tar.once('drain', res); else res(); });

  (async () => {
    const counts: Record<string, number> = {};
    const missing: string[] = [];
    const tables = (await q<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).map(r => r.t).filter(t => !SKIP_TABLES.has(t));
    for (const t of tables) {
      const rows = await q<{ j: string }>(`SELECT row_to_json(x)::text AS j FROM public."${t.replace(/"/g, '')}" x`);
      counts[t] = rows.length;
      await put(`database/${t}.ndjson`, Buffer.from(rows.map(r => r.j).join('\n') + (rows.length ? '\n' : ''), 'utf8'));
    }
    const keys = await q<{ k: string; at: string }>(`SELECT storage_key AS k, created_at AS at FROM photos UNION ALL SELECT storage_key, created_at FROM presentations`);
    let files = 0;
    for (const { k, at } of keys) {
      if (!KEY_RE.test(k)) continue;
      const data = await getObject(k).catch(() => null);
      if (!data) { missing.push(k); continue; }
      await put(`files/${k}`, data, new Date(at)); files++;
    }
    await put('manifest.json', Buffer.from(JSON.stringify({ app: 'mountainretreat', created_at: new Date().toISOString(), tables: counts, files, missing_files: missing }, null, 2)));
    tar.end(Buffer.alloc(1024, 0)); // end-of-archive marker
  })().catch(e => { console.error('[backup]', e); tar.destroy(e); });

  return Readable.toWeb(gz) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Puts files from a backup archive back into storage. Only files the database refers to, with a valid name,
 * and that are missing now are written – nothing is overwritten and nothing unknown is accepted.
 */
export async function restoreFiles(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<{ restored: number; alreadyThere: number; skipped: number }> {
  const known = new Map((await q<{ k: string; mime: string }>(
    `SELECT storage_key AS k, mime_type AS mime FROM photos UNION ALL SELECT storage_key, 'application/pdf' FROM presentations`)).map(r => [r.k, r.mime]));
  const gunzip = zlib.createGunzip();
  const src = Readable.from(body as AsyncIterable<Uint8Array>);
  src.pipe(gunzip);
  let buf: Buffer = Buffer.alloc(0);
  let restored = 0, alreadyThere = 0, skipped = 0;
  let entry: { name: string; size: number; data: Buffer[]; got: number } | null = null;
  let skip = 0;
  const MAX = 25 * 1024 * 1024;

  const finishEntry = async (e: { name: string; data: Buffer[] }) => {
    const m = e.name.match(/^files\/(.+)$/);
    if (!m || !KEY_RE.test(m[1]) || !known.has(m[1])) { skipped++; return; }
    if (await getObject(m[1]).catch(() => null)) { alreadyThere++; return; }
    await putObject(m[1], Buffer.concat(e.data), known.get(m[1])!);
    restored++;
  };

  for await (const chunk of gunzip as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    while (true) {
      if (skip) { const n = Math.min(skip, buf.length); buf = buf.subarray(n); skip -= n; if (skip) break; }
      if (entry) {
        const n = Math.min(entry.size - entry.got, buf.length);
        entry.data.push(buf.subarray(0, n)); entry.got += n; buf = buf.subarray(n);
        if (entry.got < entry.size) break;
        const done = entry; entry = null; skip = (512 - (done.size % 512)) % 512;
        await finishEntry(done);
        continue;
      }
      if (buf.length < 512) break;
      const h = buf.subarray(0, 512); buf = buf.subarray(512);
      if (h.every(b => b === 0)) continue; // end-of-archive blocks
      const str = (a: number, l: number) => h.subarray(a, a + l).toString('utf8').replace(/\0.*$/s, '');
      const name = (str(345, 155) ? str(345, 155) + '/' : '') + str(0, 100);
      const size = parseInt(str(124, 12).trim() || '0', 8);
      const type = str(156, 1);
      if (!Number.isFinite(size) || size < 0) throw new Error('Ugyldig arkiv.');
      if ((type !== '0' && type !== '') || size > MAX) { skipped++; skip = size + ((512 - (size % 512)) % 512); continue; }
      entry = { name, size, data: [], got: 0 };
      if (size === 0) { const done = entry; entry = null; await finishEntry(done); }
    }
  }
  return { restored, alreadyThere, skipped };
}

/** For the admin page: what a backup would contain right now. */
export async function backupSummary() {
  const r = await getPool().query<{ files: number; bytes: string }>(
    `SELECT (SELECT count(*) FROM photos) + (SELECT count(*) FROM presentations) AS files,
            ((SELECT coalesce(sum(size_bytes),0) FROM photos) + (SELECT coalesce(sum(size_bytes),0) FROM presentations))::text AS bytes`);
  return { files: Number(r.rows[0].files), bytes: Number(r.rows[0].bytes) };
}
