import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { user } from './factory';
import { actorFor } from '../lib/audit';
import { getObject, putObject, signedDownloadUrl, storageBackend } from '../lib/storage';
import { presentationForResponse, startDirectUpload, uploadPresentation } from '../lib/domain/presentations';

/** A small stand-in for Supabase Storage's REST API (the endpoints the app uses), so the adapter can be tested offline. */
const files = new Map<string, Buffer>();
const seenKeys: string[] = [];
let server: http.Server;
const env = { ...process.env };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
      const body = Buffer.concat(chunks);
      const authed = req.headers.apikey === 'sb_secret_test';
      let m: RegExpMatchArray | null;
      if ((m = p.match(/^\/object\/upload\/sign\/mountainretreat\/(.+)$/))) {
        if (req.method === 'POST') { if (!authed) return void res.writeHead(401).end(); return void res.end(JSON.stringify({ url: `/object/upload/sign/mountainretreat/${m[1]}?token=t1` })); }
        if (req.method === 'PUT' && url.searchParams.get('token') === 't1') { files.set(m[1], body); return void res.end('{}'); }
      }
      if (!authed) return void res.writeHead(401).end();
      seenKeys.push(String(req.headers.apikey));
      if ((m = p.match(/^\/object\/sign\/mountainretreat\/(.+)$/))) return void res.end(JSON.stringify({ signedURL: `/object/sign/mountainretreat/${m[1]}?token=dl` }));
      if ((m = p.match(/^\/object\/authenticated\/mountainretreat\/(.+)$/))) { const f = files.get(m[1]); return f ? void res.end(f) : void res.writeHead(400).end('{"error":"not_found"}'); }
      if ((m = p.match(/^\/object\/mountainretreat\/(.+)$/))) {
        if (req.method === 'POST') { files.set(m[1], body); return void res.end('{}'); }
        if (req.method === 'DELETE') { files.delete(m[1]); return void res.end('{}'); }
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>(r => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
});
afterAll(() => { server.close(); process.env.SUPABASE_URL = env.SUPABASE_URL; process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY; if (!env.SUPABASE_URL) delete process.env.SUPABASE_URL; if (!env.SUPABASE_SECRET_KEY) delete process.env.SUPABASE_SECRET_KEY; });

const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');

describe('Supabase Storage adapter (used on Vercel)', () => {
  it('stores, reads and signs files with the secret key in the apikey header', async () => {
    expect(storageBackend()).toBe('supabase');
    const key = 'property/11111111-2222-3333-4444-555555555555.jpeg';
    await putObject(key, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg');
    expect((await getObject(key))!.equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(await getObject('property/99999999-2222-3333-4444-555555555555.jpeg')).toBeNull();
    const url = await signedDownloadUrl(key, { downloadAs: 'bilde.jpg' });
    expect(url).toMatch(/\/storage\/v1\/object\/sign\/mountainretreat\/property\/.+\?token=dl&download=bilde.jpg$/);
    expect(seenKeys.every(k => k === 'sb_secret_test')).toBe(true);
    await expect(putObject('../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Invalid storage key/);
  });

  it('large PDFs go straight from the browser to storage; the server checks them and serves them through a short-lived link', async () => {
    const admin = await user('admin');
    const up = (await startDirectUpload(admin))!;
    expect(up.key).toMatch(/^presentations\/[0-9a-f-]{36}\.pdf$/);
    // the browser's PUT
    expect((await fetch(up.uploadUrl, { method: 'PUT', body: new Uint8Array(pdf) })).ok).toBe(true);
    const id = await uploadPresentation(admin, { title: 'Stor presentasjon', uploadedKey: up.key, originalName: 'Hytta 2027.pdf' }, actorFor(admin));
    const res = (await presentationForResponse(id))!;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/object/sign/mountainretreat/presentations/');

    // Not a PDF → rejected and the uploaded object is removed again
    const bad = (await startDirectUpload(admin))!;
    await fetch(bad.uploadUrl, { method: 'PUT', body: new Uint8Array(Buffer.from('MZ not a pdf')) });
    await expect(uploadPresentation(admin, { title: 'Virus', uploadedKey: bad.key }, actorFor(admin))).rejects.toThrow(/gyldig PDF/);
    expect(files.has(bad.key)).toBe(false);
    // A key that was never uploaded, or a key outside the presentations folder
    await expect(uploadPresentation(admin, { title: 'Mangler', uploadedKey: 'presentations/00000000-0000-0000-0000-000000000000.pdf' }, actorFor(admin))).rejects.toThrow(/Fant ikke/);
    await expect(uploadPresentation(admin, { title: 'Feil', uploadedKey: 'property/00000000-0000-0000-0000-000000000000.jpeg' }, actorFor(admin))).rejects.toThrow(/Ugyldig opplasting/);
    // Members can't start uploads
    const m = await user('member');
    await expect(startDirectUpload(m)).rejects.toThrow(/tilgang/);
  });
});
