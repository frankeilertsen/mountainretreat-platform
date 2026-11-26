import { describe, it, expect } from 'vitest';
import { getPool, one, q } from '../lib/db';
import { user } from './factory';
import { createMailing, saveMailing, resolveRecipients, sendMailing, sendTest, renderBody, checkUnsubscribe, unsubscribeToken, addMailingFile } from '../lib/domain/mailings';

describe('e-mail to members', () => {
  it('news goes only to members who said yes; info to all; invitation chains include every level', async () => {
    const admin = await user('admin');
    const actor = { id: admin.id, type: 'admin' as const };
    const top = await user('member', { name: 'Topp Leder', marketing_consent: true });
    const a = await user('member', { name: 'Anne Ja', marketing_consent: true, invited_by_user_id: top.id });
    const b = await user('member', { name: 'Bjørn Nei', marketing_consent: false, invited_by_user_id: a.id });
    const other = await user('member', { name: 'Utenfor', marketing_consent: true });
    const helper = await user('helper', { marketing_consent: true });

    const chain = await resolveRecipients('info', { mode: 'selected', userIds: [], leaderIds: [top.id] });
    expect(chain.recipients.map(r => r.id).sort()).toEqual([top.id, a.id, b.id].sort());
    const news = await resolveRecipients('news', { mode: 'selected', userIds: [other.id], leaderIds: [top.id] });
    expect(news.recipients.map(r => r.id).sort()).toEqual([top.id, a.id, other.id].sort());
    expect(news.withoutConsent.map(r => r.id)).toEqual([b.id]);
    const all = await resolveRecipients('info', { mode: 'all', userIds: [], leaderIds: [] });
    expect(all.recipients.some(r => r.id === helper.id)).toBe(false);

    const id = await createMailing(actor);
    await saveMailing(id, { kind: 'news', subject: 'Lanseringstilbud', body: 'Hei {navn}!\n\n**5 %** ekstra i desember.\n\n[bilde 1]\n\n[knapp: Book nå | https://mountainretreat.no/medlem]', audience: { mode: 'selected', userIds: [other.id], leaderIds: [top.id] } }, actor);
    await addMailingFile(id, 'attachment', { name: 'prisliste.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 test') }, actor);
    await sendTest(id, { id: admin.id, email: admin.email, name: 'Frank Test' });
    expect((await q(`SELECT 1 FROM notifications WHERE type='mailing_test' AND user_id=$1 AND subject LIKE '[TEST]%'`, [admin.id])).length).toBe(1);
    expect(await sendMailing(id, actor)).toBe(3);
    const n = (await one<any>(`SELECT subject, body, payload FROM notifications WHERE type='mailing' AND user_id=$1`, [a.id]))!;
    expect(n.subject).toBe('Lanseringstilbud');
    expect(n.body).toMatch(/^Hei Anne!/);
    expect(n.payload.html).toContain('<strong>5 %</strong>');
    expect(n.payload.html).toContain('Meld deg av nyheter');
    expect(n.payload.mailingAttachmentIds).toHaveLength(1);
    expect((await q(`SELECT 1 FROM notifications WHERE type='mailing' AND user_id=$1`, [b.id])).length).toBe(0);
    await expect(saveMailing(id, { kind: 'news', subject: 'x', body: 'y', audience: { mode: 'all', userIds: [], leaderIds: [] } }, actor)).rejects.toThrow(/allerede sendt/);
    await expect(sendMailing(id, actor)).rejects.toThrow(/allerede sendt/);
  });

  it('body markup and unsubscribe tokens', async () => {
    const html = renderBody('Hei {navn}\n\n- én\n- to\n\nSe https://mountainretreat.no.', [], 'Kari');
    expect(html).toContain('Hei Kari');
    expect(html).toContain('<li>én</li>');
    expect(html).toContain('<a href="https://mountainretreat.no"');
    expect(renderBody('<script>x</script>', [], 'A')).not.toContain('<script>');
    const u = '6f1c2a3b-0000-4000-8000-000000000001';
    expect(checkUnsubscribe(u, unsubscribeToken(u))).toBe(true);
    expect(checkUnsubscribe(u, 'feil')).toBe(false);
  });
});
