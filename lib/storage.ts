import fs from 'fs/promises';
import path from 'path';

/**
 * File storage for photos and PDF presentations.
 *
 * - Supabase Storage (production on Vercel): set SUPABASE_URL, SUPABASE_SECRET_KEY and (optionally) SUPABASE_BUCKET.
 *   The bucket must be PRIVATE. Files are only reachable through the app's own routes, which check access and then
 *   hand out a signed link that is valid for 60 seconds.
 * - Local folder (development / a server with a disk): STORAGE_DIR (default ./storage).
 *
 * Supabase's newer secret keys (sb_secret_…) are sent in the `apikey` header; the same value in Authorization is accepted
 * (and is what legacy service_role JWT keys need).
 */
type Backend = 'supabase' | 'local';

export function storageBackend(): Backend {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? 'supabase' : 'local';
}

const bucket = () => process.env.SUPABASE_BUCKET || 'mountainretreat';
const base = () => process.env.SUPABASE_URL!.replace(/\/+$/, '') + '/storage/v1';
const headers = (extra: Record<string, string> = {}) => ({ apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY!}`, ...extra });
const localDir = () => path.resolve(process.env.STORAGE_DIR || './storage');
const objPath = (key: string) => key.split('/').map(encodeURIComponent).join('/');

function checkKey(key: string) {
  if (!/^[a-z_]+\/[0-9a-f-]{36}\.(pdf|jpeg|jpg|png|webp|gif|bin)$/i.test(key)) throw new Error('Invalid storage key');
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  checkKey(key);
  if (storageBackend() === 'supabase') {
    const r = await fetch(`${base()}/object/${bucket()}/${objPath(key)}`, { method: 'POST', headers: headers({ 'Content-Type': contentType, 'x-upsert': 'false' }), body: new Uint8Array(data) });
    if (!r.ok) throw new Error(`Storage upload failed: ${r.status} ${await r.text()}`);
    return;
  }
  const file = path.join(localDir(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { mode: 0o640 });
}

export async function getObject(key: string): Promise<Buffer | null> {
  checkKey(key);
  if (storageBackend() === 'supabase') {
    const r = await fetch(`${base()}/object/authenticated/${bucket()}/${objPath(key)}`, { headers: headers() });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error(`Storage download failed: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  const file = path.resolve(localDir(), key);
  if (!file.startsWith(localDir() + path.sep)) return null;
  try { return await fs.readFile(file); } catch { return null; }
}

export async function deleteObject(key: string): Promise<void> {
  checkKey(key);
  if (storageBackend() === 'supabase') {
    await fetch(`${base()}/object/${bucket()}/${objPath(key)}`, { method: 'DELETE', headers: headers() }).catch(() => {});
    return;
  }
  await fs.unlink(path.join(localDir(), key)).catch(() => {});
}

/** A link valid for `seconds` that lets the browser fetch the file directly from Supabase (null for local storage). */
export async function signedDownloadUrl(key: string, opts: { seconds?: number; downloadAs?: string } = {}): Promise<string | null> {
  checkKey(key);
  if (storageBackend() !== 'supabase') return null;
  const r = await fetch(`${base()}/object/sign/${bucket()}/${objPath(key)}`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: opts.seconds ?? 60 }),
  });
  if (!r.ok) throw new Error(`Storage sign failed: ${r.status}`);
  const j = await r.json() as { signedURL?: string; signedUrl?: string };
  const rel = j.signedURL ?? j.signedUrl;
  if (!rel) throw new Error('Storage sign failed: no URL');
  const url = new URL(base() + rel);
  if (opts.downloadAs) url.searchParams.set('download', opts.downloadAs);
  return url.toString();
}

/** A one-time upload link so the browser can send a large file straight to Supabase (Vercel functions accept max 4.5 MB). */
export async function signedUploadUrl(key: string): Promise<string | null> {
  checkKey(key);
  if (storageBackend() !== 'supabase') return null;
  const r = await fetch(`${base()}/object/upload/sign/${bucket()}/${objPath(key)}`, { method: 'POST', headers: headers() });
  if (!r.ok) throw new Error(`Storage upload-sign failed: ${r.status} ${await r.text()}`);
  const j = await r.json() as { url: string };
  return base() + j.url;
}
