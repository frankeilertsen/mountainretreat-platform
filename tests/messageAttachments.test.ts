import { describe, it, expect } from 'vitest';
import { one } from '../lib/db';
import { user } from './factory';
import { actorFor } from '../lib/audit';
import { attachmentFor, openConversation, postMessage, startConversation } from '../lib/domain/messages';
import { getObject } from '../lib/storage';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const mb = (n: number) => Buffer.alloc(n * 1024 * 1024, 1);

describe('message attachments', () => {
  it('member attaches an image and a PDF; only the member and admins can open them', async () => {
    const m = await user('member'), other = await user('member'), a = await user('admin');
    const id = await startConversation(m, { subject: 'Skade', body: 'Se bildet', files: [{ name: 'skade.png', type: 'image/png', data: png }, { name: 'kvittering.pdf', type: '', data: Buffer.from('%PDF-1.4') }] }, actorFor(m));
    const { messages } = await openConversation(a, id);
    expect(messages[0].attachments.map(x => [x.filename, x.mime_type])).toEqual([['skade.png', 'image/png'], ['kvittering.pdf', 'application/pdf']]);
    const att = await attachmentFor(m, messages[0].attachments[0].id);
    expect((await getObject(att!.storage_key))!.equals(png)).toBe(true);
    expect(await attachmentFor(a, messages[0].attachments[1].id)).not.toBeNull();
    await expect(attachmentFor(other, messages[0].attachments[0].id)).rejects.toThrow();
    const mail = await one<{ body: string }>(`SELECT body FROM notifications WHERE type='message_from_member' AND user_id=$1 ORDER BY created_at DESC LIMIT 1`, [a.id]);
    expect(mail!.body).toMatch(/📎 2 vedlegg/);
  });

  it('a reply can be only an attachment; limits and file types are enforced', async () => {
    const m = await user('member'), a = await user('admin');
    const id = await startConversation(m, { subject: 'Hei', body: 'Hei' }, actorFor(m));
    await postMessage(a, id, '', actorFor(a), [{ name: 'kart.jpg', type: 'image/jpeg', data: png }]);
    const { messages } = await openConversation(m, id);
    expect(messages[1].attachments).toHaveLength(1);
    await expect(postMessage(m, id, '', actorFor(m))).rejects.toThrow(/Skriv en melding/);
    await expect(postMessage(m, id, 'x', actorFor(m), [{ name: 'virus.exe', type: 'application/x-msdownload', data: png }])).rejects.toThrow(/kan ikke legges ved/);
    await expect(postMessage(m, id, 'x', actorFor(m), [{ name: 'stor.pdf', type: 'application/pdf', data: mb(11) }])).rejects.toThrow(/maks 10 MB/);
    await expect(postMessage(m, id, 'x', actorFor(m), [1, 2, 3].map(i => ({ name: `f${i}.pdf`, type: 'application/pdf', data: mb(8) })))).rejects.toThrow(/20 MB/);
    await expect(postMessage(m, id, 'x', actorFor(m), [1, 2, 3, 4, 5, 6].map(i => ({ name: `f${i}.png`, type: 'image/png', data: png })))).rejects.toThrow(/maks 5/);
  });
});
