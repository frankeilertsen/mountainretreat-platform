'use server';
import { run, str } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor } from '@/lib/audit';
import { startDirectUpload, updatePresentation, uploadPresentation } from '@/lib/domain/presentations';

async function admin() { const u = await assertUser('admin'); return { u, actor: actorFor(u, await clientIp()) }; }

export async function uploadPresentationAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/presentasjoner', async () => {
    const file = f.get('file');
    await uploadPresentation(u as any, { title: str(f, 'title'), file: file instanceof File && file.size > 0 ? file : null, uploadedKey: str(f, 'uploadedKey') || undefined, originalName: str(f, 'originalName'), propertyId: str(f, 'propertyId') || null, makeDefault: !!f.get('makeDefault') }, actor);
    return 'Presentasjonen er lastet opp.';
  });
}

/** Direct upload (Supabase): returns a one-time upload link, or null when the file should go through the form. */
export async function startPresentationUploadAction(): Promise<{ key: string; uploadUrl: string } | null> {
  const { u } = await admin();
  return startDirectUpload(u as any);
}

export async function updatePresentationAction(f: FormData) {
  const { u, actor } = await admin();
  const op = str(f, 'op');
  await run('/admin/presentasjoner', async () => {
    const id = str(f, 'id');
    if (op === 'default') { await updatePresentation(u as any, id, { makeDefault: true }, actor); return 'Satt som standard.'; }
    if (op === 'deactivate') { await updatePresentation(u as any, id, { active: false }, actor); return 'Presentasjonen er skjult og kan ikke lenger legges ved.'; }
    if (op === 'activate') { await updatePresentation(u as any, id, { active: true }, actor); return 'Presentasjonen er aktiv igjen.'; }
    await updatePresentation(u as any, id, { title: str(f, 'title'), propertyId: str(f, 'propertyId') || null }, actor);
    return 'Lagret.';
  });
}
