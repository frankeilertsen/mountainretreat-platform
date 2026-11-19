import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { DomainError } from './errors';

/**
 * Wraps a server action: runs it, then redirects back with a flash message.
 * Expected (DomainError) messages are shown to the user; unexpected errors are logged and shown generically.
 */
export async function run(back: string, fn: () => Promise<string | void | { redirect: string; ok?: string }>): Promise<never> {
  let target = back, msg: string | null = null, err: string | null = null;
  try {
    const r = await fn();
    if (typeof r === 'string') msg = r;
    else if (r && typeof r === 'object') { target = r.redirect; msg = r.ok ?? null; }
  } catch (e) {
    if (e instanceof DomainError) err = e.message;
    else if ((e as any)?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    else { console.error('[action error]', e); err = 'Noe gikk galt. Prøv igjen, eller kontakt administrator.'; }
  }
  revalidatePath(target.split('?')[0]);
  const sep = target.includes('?') ? '&' : '?';
  redirect(err ? `${target}${sep}feil=${encodeURIComponent(err)}` : msg ? `${target}${sep}ok=${encodeURIComponent(msg)}` : target);
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
export const int = (f: FormData, k: string, def = 0) => { const n = parseInt(String(f.get(k) ?? ''), 10); return Number.isFinite(n) ? n : def; };
/** "1 250,50" kr → øre */
export const kr = (f: FormData, k: string) => {
  const raw = String(f.get(k) ?? '').replace(/\s/g, '').replace(',', '.');
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new DomainError('bad_amount', 'Ugyldig beløp.');
  return Math.round(n * 100);
};
export const date = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new DomainError('bad_date', 'Ugyldig dato.');
  return v;
};
