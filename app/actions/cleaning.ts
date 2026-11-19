'use server';
import { run, str } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor } from '@/lib/audit';
import { completeTask, reportIssue, savePhoto, setRoomDone, startTask, helperCanSeeTask } from '@/lib/domain/cleaning';
import { DomainError, forbidden } from '@/lib/errors';

async function helper() { const u = await assertUser('cleaning_portal'); return { u, actor: actorFor(u, await clientIp()) }; }
const back = (id: string) => `/renhold/oppgaver/${id}`;

export async function startTaskAction(f: FormData) {
  const { u, actor } = await helper(); const id = str(f, 'taskId');
  await run(back(id), async () => { await startTask(id, u as any, actor); return 'Startet.'; });
}
export async function completeTaskAction(f: FormData) {
  const { u, actor } = await helper(); const id = str(f, 'taskId');
  await run(back(id), async () => { await completeTask(id, u as any, str(f, 'notes'), actor); return 'Flott! Renholdet er markert som ferdig.'; });
}
export async function roomDoneAction(f: FormData) {
  const { u, actor } = await helper(); const id = str(f, 'taskId');
  await run(back(id), async () => { await setRoomDone(id, str(f, 'roomId'), str(f, 'done') === '1', u as any, actor); });
}
export async function reportAction(f: FormData) {
  const { u, actor } = await helper(); const id = str(f, 'taskId');
  await run(back(id), async () => {
    const kind = str(f, 'kind') as any;
    if (!['damage', 'missing_item', 'issue', 'comment'].includes(kind)) throw new DomainError('kind', 'Velg type.');
    const reportId = await reportIssue(id, kind, str(f, 'description'), u as any, actor);
    const file = f.get('photo');
    if (file instanceof File && file.size > 0) await savePhoto('cleaning_report', reportId, file, u as any, actor);
    return kind === 'comment' ? 'Kommentar lagret.' : 'Rapportert. Administrator er varslet.';
  });
}
export async function taskPhotoAction(f: FormData) {
  const { u, actor } = await helper(); const id = str(f, 'taskId');
  await run(back(id), async () => {
    if (!(await helperCanSeeTask(u as any, id))) throw forbidden();
    const file = f.get('photo');
    if (!(file instanceof File) || file.size === 0) throw new DomainError('nofile', 'Velg et bilde.');
    await savePhoto('cleaning_task', id, file, u as any, actor); return 'Bildet er lastet opp.';
  });
}
