import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Db, getPool, one, q, tx } from '../db';
import { audit, Actor } from '../audit';
import { DomainError, forbidden } from '../errors';
import { can, UserLike } from '../auth/rbac';

/**
 * PDF presentations (pictures, information about the place and the member benefits) that an inviter can attach to an invitation.
 * Uploaded by admins; stored outside the web root and served only to admins, logged-in members, and holders of a valid invitation link.
 */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;   // upload limit
export const MAX_ATTACH_BYTES = 15 * 1024 * 1024; // larger files are sent as a download link only (e-mail size limits)

export type Presentation = { id: string; title: string; original_filename: string; size_bytes: number; property_id: string | null; property_name: string | null; is_default: boolean; active: boolean; created_at: string; uploaded_by: string; times_sent: number };

const storageDir = () => path.resolve(process.env.STORAGE_DIR || './storage');

export function isPdf(buf: Buffer): boolean {
  // "%PDF-" at the start (allow a few bytes of leading junk, as the PDF spec does) and an EOF marker near the end
  const head = buf.subarray(0, 1024).toString('latin1');
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1');
  return head.indexOf('%PDF-') >= 0 && head.indexOf('%PDF-') < 1024 && tail.includes('%%EOF');
}

export function safeFilename(name: string): string {
  const base = name.replace(/\.pdf$/i, '').normalize('NFKD').replace(/[^\w\- æøåÆØÅ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'presentasjon';
  return base + '.pdf';
}

export async function uploadPresentation(u: UserLike, input: { title: string; file: File; propertyId?: string | null; makeDefault?: boolean }, actor: Actor): Promise<string> {
  if (!can(u, 'admin')) throw forbidden();
  const title = input.title.trim().slice(0, 120);
  if (title.length < 2) throw new DomainError('title', 'Gi presentasjonen en tittel.');
  const f = input.file;
  if (!f || typeof f === 'string' || f.size <= 0) throw new DomainError('file', 'Velg en PDF-fil.');
  if (f.size > MAX_PDF_BYTES) throw new DomainError('file', 'PDF-filen må være under 20 MB.');
  const buf = Buffer.from(await f.arrayBuffer());
  if (!isPdf(buf)) throw new DomainError('file', 'Filen er ikke en gyldig PDF.');
  const key = `presentations/${crypto.randomUUID()}.pdf`;
  await fs.mkdir(path.join(storageDir(), 'presentations'), { recursive: true });
  await fs.writeFile(path.join(storageDir(), key), buf, { mode: 0o640 });
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  try {
    return await tx(async c => {
      if (input.propertyId) {
        const p = await one(`SELECT 1 FROM properties WHERE id=$1`, [input.propertyId], c);
        if (!p) throw new DomainError('property', 'Ugyldig bolig.');
      }
      const first = !(await one(`SELECT 1 FROM presentations WHERE active`, [], c));
      const makeDefault = !!input.makeDefault || first;
      if (makeDefault) await c.query(`UPDATE presentations SET is_default=false WHERE is_default`);
      const row = (await one<{ id: string }>(
        `INSERT INTO presentations (title, original_filename, storage_key, size_bytes, sha256, property_id, is_default, uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [title, safeFilename(f.name || title), key, buf.length, sha, input.propertyId || null, makeDefault, u.id], c))!;
      await audit(c, actor, 'presentation.uploaded', 'presentation', row.id, undefined, { title, size: buf.length, default: makeDefault });
      return row.id;
    });
  } catch (e) { await fs.unlink(path.join(storageDir(), key)).catch(() => {}); throw e; }
}

export async function updatePresentation(u: UserLike, id: string, change: { title?: string; active?: boolean; makeDefault?: boolean; propertyId?: string | null }, actor: Actor) {
  if (!can(u, 'admin')) throw forbidden();
  await tx(async c => {
    const p = await one<{ active: boolean; is_default: boolean }>(`SELECT active, is_default FROM presentations WHERE id=$1 FOR UPDATE`, [id], c);
    if (!p) throw new DomainError('not_found', 'Fant ikke presentasjonen.');
    if (change.title !== undefined) {
      const t = change.title.trim().slice(0, 120);
      if (t.length < 2) throw new DomainError('title', 'Gi presentasjonen en tittel.');
      await c.query(`UPDATE presentations SET title=$2 WHERE id=$1`, [id, t]);
    }
    if (change.propertyId !== undefined) await c.query(`UPDATE presentations SET property_id=$2 WHERE id=$1`, [id, change.propertyId || null]);
    if (change.active === false) await c.query(`UPDATE presentations SET active=false, is_default=false WHERE id=$1`, [id]);
    if (change.active === true) await c.query(`UPDATE presentations SET active=true WHERE id=$1`, [id]);
    if (change.makeDefault) {
      await c.query(`UPDATE presentations SET is_default=false WHERE is_default AND id<>$1`, [id]);
      await c.query(`UPDATE presentations SET is_default=true, active=true WHERE id=$1`, [id]);
    }
    await audit(c, actor, 'presentation.updated', 'presentation', id, undefined, change);
  });
}

export async function listPresentations(opts: { activeOnly?: boolean } = {}, db: Db = getPool()): Promise<Presentation[]> {
  return q<Presentation>(
    `SELECT pr.id, pr.title, pr.original_filename, pr.size_bytes, pr.property_id, p.name AS property_name, pr.is_default, pr.active, pr.created_at, u.name AS uploaded_by,
       (SELECT count(*) FROM invitations i WHERE i.presentation_id=pr.id)::int AS times_sent
     FROM presentations pr JOIN users u ON u.id=pr.uploaded_by_user_id LEFT JOIN properties p ON p.id=pr.property_id
     ${opts.activeOnly ? 'WHERE pr.active' : ''} ORDER BY pr.active DESC, pr.is_default DESC, pr.created_at DESC`, [], db);
}

/** Returns the file for an active presentation (or any presentation for admins). */
export async function readPresentation(id: string, opts: { includeInactive?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const p = await one<{ storage_key: string; original_filename: string; title: string; active: boolean; size_bytes: number }>(
    `SELECT storage_key, original_filename, title, active, size_bytes FROM presentations WHERE id=$1`, [id]);
  if (!p || (!p.active && !opts.includeInactive)) return null;
  const file = path.resolve(storageDir(), p.storage_key);
  if (!file.startsWith(storageDir() + path.sep)) return null;
  try { return { ...p, data: await fs.readFile(file) }; } catch { return null; }
}

export function pdfResponse(p: { data: Buffer; original_filename: string }, download = false) {
  return new Response(new Uint8Array(p.data), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${p.original_filename.replace(/[^\w.\-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(p.original_filename)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
