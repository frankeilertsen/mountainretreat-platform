import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/current';
import { one } from '@/lib/db';
import { isAdmin } from '@/lib/auth/rbac';
import { helperCanSeeTask } from '@/lib/domain/cleaning';
import { getObject, signedDownloadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Photos are served only to authorised users (private bucket; on Supabase via a 60-second signed link). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
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
  const signed = await signedDownloadUrl(ph.storage_key, { seconds: 120 });
  if (signed) return new Response(null, { status: 302, headers: { Location: signed, 'Cache-Control': 'private, max-age=60' } });
  const buf = await getObject(ph.storage_key);
  if (!buf) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': ph.mime_type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
