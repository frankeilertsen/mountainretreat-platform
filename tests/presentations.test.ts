import { describe, it, expect, beforeAll, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { one, q } from '../lib/db';
import { user } from './factory';
import { actorFor } from '../lib/audit';
import { createInvitation, getInvitationByToken } from '../lib/domain/invitations';
import { isPdf, listPresentations, readPresentation, updatePresentation, uploadPresentation } from '../lib/domain/presentations';
import { deliverQueued } from '../lib/notify';

const pdf = (extra = '') => new File([Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n${extra}\n%%EOF\n`)], 'Velkommen til hytta!.pdf', { type: 'application/pdf' });
const token = (link: string) => link.split('/').pop()!;

beforeAll(() => { process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-pres-')); });

describe('PDF presentations attached to invitations', () => {
  it('only admins upload; only real PDFs under 20 MB; first becomes default; default can be switched', async () => {
    const admin = await user('admin'), m = await user('member');
    await expect(uploadPresentation(m, { title: 'Hytta', file: pdf() }, actorFor(m))).rejects.toThrow(/tilgang/);
    await expect(uploadPresentation(admin, { title: 'Bilde', file: new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], 'x.pdf') }, actorFor(admin))).rejects.toThrow(/gyldig PDF/);
    await expect(uploadPresentation(admin, { title: 'Stor', file: new File([Buffer.alloc(21 * 1024 * 1024)], 'stor.pdf') }, actorFor(admin))).rejects.toThrow(/20 MB/);
    await expect(uploadPresentation(admin, { title: 'x', file: pdf() }, actorFor(admin))).rejects.toThrow(/tittel/);
    expect(isPdf(Buffer.from('%PDF-1.7 ... %%EOF'))).toBe(true);

    const a = await uploadPresentation(admin, { title: 'Velkommen', file: pdf('a') }, actorFor(admin));
    const b = await uploadPresentation(admin, { title: 'Leiligheten', file: pdf('b') }, actorFor(admin));
    let list = await listPresentations({ activeOnly: true });
    expect(list.find(p => p.id === a)!.is_default || list.some(p => p.is_default && p.id !== b)).toBe(true);
    await updatePresentation(admin, b, { makeDefault: true }, actorFor(admin));
    list = await listPresentations({ activeOnly: true });
    expect(list.filter(p => p.is_default).map(p => p.id)).toEqual([b]);
    const file = await readPresentation(b);
    expect(file!.original_filename).toBe('Velkommen-til-hytta.pdf');
    expect(isPdf(file!.data)).toBe(true);
    // Deactivated: hidden from members, not attachable, default cleared
    await updatePresentation(admin, b, { active: false }, actorFor(admin));
    expect(await readPresentation(b)).toBeNull();
    expect(await readPresentation(b, { includeInactive: true })).not.toBeNull();
    expect((await listPresentations({ activeOnly: true })).some(p => p.id === b)).toBe(false);
  });

  it('invitation e-mail describes the benefits, attaches the chosen PDF, and follows the chosen language', async () => {
    const admin = await user('admin');
    const pres = await uploadPresentation(admin, { title: 'Mountain Retreat', file: pdf('c'), makeDefault: true }, actorFor(admin));

    // Default presentation, Norwegian
    const r1 = await createInvitation(admin, { email: 'gjest1@example.no', name: 'Siri' }, actorFor(admin));
    const n1 = await one<{ body: string; subject: string; payload: any }>(`SELECT body, subject, payload FROM notifications WHERE to_address='gjest1@example.no'`);
    expect(n1!.payload.attachPresentationId).toBe(pres);
    expect(n1!.body).toMatch(/Som medlem får du:/);
    expect(n1!.body).toMatch(/medlemsrabatt/);
    expect(n1!.body).toMatch(/Ingen Airbnb-avgift/);
    expect(n1!.body).toMatch(/presentasjonen som er lagt ved/);
    const inv = await getInvitationByToken(token(r1.link));
    expect(inv!.presentation_id).toBe(pres);
    expect(inv!.lang).toBe('no');

    // English, explicitly no attachment
    await createInvitation(admin, { email: 'guest2@example.com', presentationId: null, lang: 'en' }, actorFor(admin));
    const n2 = await one<{ body: string; subject: string; payload: any }>(`SELECT body, subject, payload FROM notifications WHERE to_address='guest2@example.com'`);
    expect(n2!.subject).toMatch(/has invited you/);
    expect(n2!.body).toMatch(/As a member you get:/);
    expect(n2!.body).toMatch(/member discount/);
    expect(n2!.payload).toBeNull();

    // A hidden presentation can't be attached
    await updatePresentation(admin, pres, { active: false }, actorFor(admin));
    await expect(createInvitation(admin, { email: 'gjest3@example.no', presentationId: pres }, actorFor(admin))).rejects.toThrow(/finnes ikke lenger/);

    // The PDF is loaded and attached when the e-mail is sent (dev sender logs it)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverQueued(500);
    const out = log.mock.calls.map(c => String(c[0])).find(s => s.includes('to=gjest1@example.no'));
    log.mockRestore();
    expect(out).toMatch(/\[vedlegg: Velkommen-til-hytta\.pdf/);
    expect((await one<{ status: string }>(`SELECT status FROM notifications WHERE to_address='gjest1@example.no'`))!.status).toBe('sent');
  });

  it('members can attach a presentation when inviting', async () => {
    const admin = await user('admin'), m = await user('member', { invite_tier: 'admin_invited' });
    const p = await uploadPresentation(admin, { title: 'Til venner', file: pdf('d') }, actorFor(admin));
    await createInvitation(m, { email: 'venn@example.no', presentationId: p }, actorFor(m));
    expect((await q(`SELECT presentation_id FROM invitations WHERE invitee_email='venn@example.no'`))[0].presentation_id).toBe(p);
  });
});
