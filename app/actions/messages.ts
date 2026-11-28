'use server';
import { run, str } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor } from '@/lib/audit';
import { postMessage, setConversationStatus, startConversation } from '@/lib/domain/messages';

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
async function filesOf(f: FormData) {
  const out: { name: string; type: string; data: Buffer }[] = [];
  for (const v of f.getAll('files')) if (v instanceof File && v.size > 0) out.push({ name: v.name, type: v.type, data: Buffer.from(await v.arrayBuffer()) });
  return out;
}

/** Member: new conversation. */
export async function memberStartConversationAction(f: FormData) {
  const u = await assertUser('request_booking');
  const actor = actorFor(u, await clientIp());
  await run('/medlem/meldinger', async () => {
    const id = await startConversation(u as any, { subject: str(f, 'subject'), body: str(f, 'body'), bookingId: isUuid(str(f, 'bookingId')) ? str(f, 'bookingId') : null, files: await filesOf(f) }, actor);
    return { redirect: `/medlem/meldinger/${id}`, ok: 'Meldingen er sendt.' };
  });
}

/** Member or admin: reply in a thread (back = the page the form lives on). */
export async function replyAction(f: FormData) {
  const u = await assertUser('request_booking');
  const actor = actorFor(u, await clientIp());
  const id = str(f, 'conversationId');
  const back = (actor.type === 'admin' && str(f, 'area') === 'admin' ? '/admin/meldinger/' : '/medlem/meldinger/') + (isUuid(id) ? id : '');
  await run(back, async () => { await postMessage(u as any, id, str(f, 'body'), actor, await filesOf(f)); });
}

/** Admin: start a conversation with a member. */
export async function adminStartConversationAction(f: FormData) {
  const u = await assertUser('admin');
  const actor = actorFor(u, await clientIp());
  await run('/admin/meldinger/ny?medlem=' + encodeURIComponent(str(f, 'memberId')), async () => {
    const id = await startConversation(u as any, { subject: str(f, 'subject'), body: str(f, 'body'), memberId: str(f, 'memberId'), bookingId: isUuid(str(f, 'bookingId')) ? str(f, 'bookingId') : null, files: await filesOf(f) }, actor);
    return { redirect: `/admin/meldinger/${id}`, ok: 'Meldingen er sendt til medlemmet.' };
  });
}

export async function setConversationStatusAction(f: FormData) {
  const u = await assertUser('admin');
  const actor = actorFor(u, await clientIp());
  const id = str(f, 'conversationId');
  await run('/admin/meldinger/' + (isUuid(id) ? id : ''), async () => {
    const status = str(f, 'status') === 'closed' ? 'closed' : 'open';
    await setConversationStatus(u as any, id, status, actor);
    return status === 'closed' ? 'Samtalen er avsluttet.' : 'Samtalen er åpnet igjen.';
  });
}
