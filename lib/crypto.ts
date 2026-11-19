import crypto from 'crypto';

function pepper(): string {
  const p = process.env.TOKEN_PEPPER;
  if (!p) throw new Error('TOKEN_PEPPER is not set');
  return p;
}

/** 32 random bytes, URL-safe. Shown once to the user; only the hash is stored. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', pepper()).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY is not set');
  const buf = Buffer.from(k, 'base64');
  if (buf.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 bytes (base64)');
  return buf.subarray(0, 32);
}

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map(s => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function humanCode(len = 6): string {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

export function hmacSign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
