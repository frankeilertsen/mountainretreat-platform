'use server';
import { run, str } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor } from '@/lib/audit';
import { DomainError } from '@/lib/errors';
import { addMailingFile, createMailing, deleteDraft, removeMailingFile, saveMailing, sendMailing, sendTest } from '@/lib/domain/mailings';

async function admin() {
  const u = await assertUser('admin');
  return { u, actor: actorFor(u, await clientIp()) };
}
const back = (id: string) => `/admin/epost/${id}`;

function fields(f: FormData) {
  return {
    kind: str(f, 'kind'), subject: str(f, 'subject'), body: String(f.get('body') ?? ''), subject_en: str(f, 'subject_en'), body_en: String(f.get('body_en') ?? ''),
    audience: { mode: (str(f, 'mode') === 'selected' ? 'selected' : 'all') as 'all' | 'selected', userIds: f.getAll('userIds').map(String), leaderIds: f.getAll('leaderIds').map(String) },
  };
}

export async function newMailingAction() {
  const { actor } = await admin();
  await run('/admin/epost', async () => ({ redirect: back(await createMailing(actor)) }));
}

/** Save the text and recipients, add uploaded files, and optionally send a test / send for real. */
export async function saveMailingAction(f: FormData) {
  const { u, actor } = await admin(); const id = str(f, 'id'); const intent = str(f, 'intent');
  await run(back(id), async () => {
    await saveMailing(id, fields(f), actor);
    for (const [name, kind] of [['images', 'image'], ['attachments', 'attachment']] as const) {
      for (const file of f.getAll(name)) {
        if (!(file instanceof File) || !file.size) continue;
        await addMailingFile(id, kind, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) }, actor);
      }
    }
    if (intent === 'test') { await sendTest(id, { id: u.id, email: u.email, name: u.name }); return `Lagret. Testen er sendt til ${u.email}.`; }
    if (intent === 'send') {
      if (str(f, 'confirm') !== 'ja') throw new DomainError('confirm', 'Kryss av for å bekrefte utsendelsen.');
      const n = await sendMailing(id, actor);
      return `Sendt til ${n} mottaker${n === 1 ? '' : 'e'}. E-postene går ut i løpet av noen minutter.`;
    }
    return 'Lagret.';
  });
}

export async function removeMailingFileAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(back(id), async () => { await removeMailingFile(id, str(f, 'fileId'), actor); return 'Filen er fjernet.'; });
}

export async function deleteMailingAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run('/admin/epost', async () => { await deleteDraft(id, actor); return 'Utkastet er slettet.'; });
}
