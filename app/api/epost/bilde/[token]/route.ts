import { one } from '@/lib/db';
import { getObject } from '@/lib/storage';

/** Images in member e-mails. Public (e-mail clients cannot log in), but only reachable with the long random token. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response('Not found', { status: 404 });
  const f = await one<{ storage_key: string; mime_type: string }>(`SELECT storage_key, mime_type FROM mailing_files WHERE public_token=$1 AND kind='image'`, [token]);
  if (!f) return new Response('Not found', { status: 404 });
  const data = await getObject(f.storage_key);
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': f.mime_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
