import { getSession } from '@/lib/auth/current';
import { attachmentFor } from '@/lib/domain/messages';
import { INLINE_IMAGE } from '@/lib/domain/messageFiles';
import { getObject } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Download / show a message attachment. Only the member in the conversation and administrators get it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getSession();
  if (!u) return new Response('Ikke innlogget', { status: 401 });
  const { id } = await params;
  let a: Awaited<ReturnType<typeof attachmentFor>> = null;
  try { a = await attachmentFor(u as any, id); } catch { a = null; }
  if (!a) return new Response('Fant ikke filen', { status: 404 });
  const data = await getObject(a.storage_key);
  if (!data) return new Response('Fant ikke filen', { status: 404 });
  const inline = INLINE_IMAGE.has(a.mime_type) && new URL(req.url).searchParams.get('last_ned') !== '1';
  const ascii = a.filename.replace(/[^\x20-\x7e]/g, '_');
  return new Response(new Uint8Array(data), { headers: {
    'Content-Type': a.mime_type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  } });
}
