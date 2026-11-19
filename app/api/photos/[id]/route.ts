import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSession } from '@/lib/auth/current';
import { one } from '@/lib/db';
import { isAdmin } from '@/lib/auth/rbac';
import { helperCanSeeTask } from '@/lib/domain/cleaning';

export const dynamic = 'force-dynamic';

/** Photos are served only to authorised users (no public bucket). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || s.aal < 2) return new Response('Unauthorized', { status: 401 });
  const ph = await one<{ entity_type: string; entity_id: string; storage_key: string; mime_type: string }>('SELECT entity_type, entity_id, storage_key, mime_type FROM photos WHERE id=$1', [id]);
  if (!ph) return new Response('Not found', { status: 404 });
  let allowed = isAdmin(s as any);
  if (!allowed && (ph.entity_type === 'property' || ph.entity_type === 'room')) allowed = true; // all logged-in users
  if (!allowed && ph.entity_type === 'cleaning_task') allowed = await helperCanSeeTask(s as any, ph.entity_id);
  if (!allowed && ph.entity_type === 'cleaning_report') {
    const r = await one<{ cleaning_task_id: string }>('SELECT cleaning_task_id FROM cleaning_reports WHERE id=$1', [ph.entity_id]);
    allowed = !!r && await helperCanSeeTask(s as any, r.cleaning_task_id);
  }
  if (!allowed) return new Response('Forbidden', { status: 403 });
  const dir = path.resolve(process.env.STORAGE_DIR || './storage');
  const file = path.resolve(dir, ph.storage_key);
  if (!file.startsWith(dir + path.sep)) return new Response('Bad path', { status: 400 });
  try {
    const buf = await fs.readFile(file);
    return new Response(buf, { headers: { 'Content-Type': ph.mime_type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
