'use server';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { checkUnsubscribe } from '@/lib/domain/mailings';
import { audit, SYSTEM } from '@/lib/audit';

export async function unsubscribeAction(f: FormData) {
  const u = String(f.get('u') ?? ''), t = String(f.get('t') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(u) || !checkUnsubscribe(u, t)) redirect('/nyhetsbrev/avmeld');
  await getPool().query(`UPDATE users SET marketing_consent=false, updated_at=now() WHERE id=$1`, [u]);
  await audit(null, SYSTEM, 'user.unsubscribed_news', 'user', u);
  redirect(`/nyhetsbrev/avmeld?u=${u}&t=${encodeURIComponent(t)}&ferdig=1`);
}
