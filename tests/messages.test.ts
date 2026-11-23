import { describe, it, expect } from 'vitest';
import { one, q, getPool } from '../lib/db';
import { user } from './factory';
import { actorFor } from '../lib/audit';
import { adminConversations, adminUnansweredCount, memberConversations, memberUnreadCount, openConversation, postMessage, setConversationStatus, startConversation } from '../lib/domain/messages';

const mails = (type: string, to?: string) => q<{ to_address: string; subject: string; body: string }>(
  `SELECT to_address, subject, body FROM notifications WHERE type=$1 ${to ? 'AND to_address=$2' : ''} ORDER BY created_at`, to ? [type, to] : [type]);

describe('messages between members and the administration', () => {
  it('member asks, admins are notified once, admin answers, member gets notified in their language, unread badges follow', async () => {
    const admin = await user('admin'), m = await user('member', { preferred_lang: 'en' });
    await getPool().query(`DELETE FROM notifications`);
    const id = await startConversation(m, { subject: 'Ved og parkering', body: 'Hei! Er det ved på hytta?' }, actorFor(m));
    expect(await adminUnansweredCount()).toBeGreaterThanOrEqual(1);
    expect((await mails('message_from_member', admin.email)).length).toBe(1);
    // A second message before the admins have read the thread does not send another e-mail
    await postMessage(m, id, 'Og hvor parkerer vi?', actorFor(m));
    expect((await mails('message_from_member', admin.email)).length).toBe(1);
    expect((await adminConversations('unanswered')).find(c => c.id === id)?.unread).toBe(2);

    // Admin opens (marks read) and replies → member notified in English, admin badge clears
    await openConversation(admin, id);
    await postMessage(admin, id, 'Ja, to sekker står i boden. Parkering rett ved inngangen.', actorFor(admin));
    const toMember = await mails('message_from_admin', m.email);
    expect(toMember.length).toBe(1);
    expect(toMember[0].subject).toMatch(/^New message from Mountain Retreat/);
    expect(toMember[0].body).toContain('/medlem/meldinger/' + id);
    expect((await adminConversations('unanswered')).some(c => c.id === id)).toBe(false);
    expect(await memberUnreadCount(m.id)).toBe(1);
    const thread = await openConversation(m, id);
    expect(thread.messages.map(x => x.sender_side)).toEqual(['member', 'member', 'admin']);
    expect(await memberUnreadCount(m.id)).toBe(0);

    // Member writes again after reading → admins notified again
    await postMessage(m, id, 'Takk!', actorFor(m));
    expect((await mails('message_from_member', admin.email)).length).toBe(2);
  });

  it('keeps conversations private, history append-only, and lets admins close/reopen', async () => {
    const admin = await user('admin'), a = await user('member'), b = await user('member'), helper = await user('helper');
    const id = await startConversation(a, { subject: 'Spørsmål', body: 'Hemmelig spørsmål' }, actorFor(a));
    await expect(openConversation(b, id)).rejects.toThrow(/tilgang/);
    await expect(postMessage(b, id, 'snoking', actorFor(b))).rejects.toThrow(/tilgang/);
    await expect(startConversation(helper, { subject: 'Hei', body: 'Hei' }, actorFor(helper))).rejects.toThrow(/tilgang/);
    expect((await memberConversations(b.id)).length).toBe(0);
    // A member can't attach someone else's booking or start a thread on behalf of another member
    const other = await startConversation(a, { subject: 'Til meg selv', body: 'x', memberId: b.id }, actorFor(a));
    expect((await one<{ member_id: string }>(`SELECT member_id FROM conversations WHERE id=$1`, [other]))!.member_id).toBe(a.id);

    await expect(getPool().query(`UPDATE messages SET body='endret' WHERE conversation_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(getPool().query(`DELETE FROM messages WHERE conversation_id=$1`, [id])).rejects.toThrow(/append-only/);

    await setConversationStatus(admin, id, 'closed', actorFor(admin));
    await expect(postMessage(admin, id, 'svar', actorFor(admin))).rejects.toThrow(/lukket/);
    await expect(setConversationStatus(a, id, 'open', actorFor(a))).rejects.toThrow(/tilgang/);
    await postMessage(a, id, 'Jeg har et oppfølgingsspørsmål', actorFor(a)); // member reply re-opens
    expect((await one<{ status: string }>(`SELECT status FROM conversations WHERE id=$1`, [id]))!.status).toBe('open');
    expect((await q(`SELECT action FROM audit_log WHERE entity_id=$1 ORDER BY created_at`, [id])).map(r => r.action))
      .toEqual(['conversation.started', 'conversation.closed', 'conversation.reopened']);
  });

  it('admin can start a conversation with a member about their booking; validation and rate limit', async () => {
    const admin = await user('admin'), m = await user('member');
    const id = await startConversation(admin, { subject: 'Velkommen', body: 'Hyggelig å ha deg med!', memberId: m.id }, actorFor(admin));
    expect(await memberUnreadCount(m.id)).toBe(1);
    expect((await mails('message_from_admin', m.email))[0].subject).toMatch(/^Ny melding fra Mountain Retreat/);
    await expect(startConversation(admin, { subject: 'Hei', body: 'x', memberId: m.id, bookingId: '00000000-0000-0000-0000-000000000000' }, actorFor(admin))).rejects.toThrow(/tilhører ikke/);
    await expect(startConversation(m, { subject: '', body: 'x' }, actorFor(m))).rejects.toThrow(/emne/);
    await expect(postMessage(m, id, '   ', actorFor(m))).rejects.toThrow(/Skriv en melding/);
    await expect(postMessage(m, id, 'x'.repeat(5001), actorFor(m))).rejects.toThrow(/for lang/);
    for (let i = 0; i < 30; i++) await postMessage(m, id, `melding ${i}`, actorFor(m));
    await expect(postMessage(m, id, 'en til', actorFor(m))).rejects.toThrow(/For mange/);
  });
});
