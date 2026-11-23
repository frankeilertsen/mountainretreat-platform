import { Db, getPool, one, q, tx } from '../db';
import { audit, Actor } from '../audit';
import { appUrl, enqueue, notifyAdmins } from '../notify';
import { DomainError, forbidden } from '../errors';
import { can, isAdmin, UserLike } from '../auth/rbac';
import { rateLimit } from '../ratelimit';

/**
 * Messages between members and the administration.
 *
 * - One conversation belongs to one member; every admin sees all conversations (shared inbox).
 * - Messages are append-only (database trigger), so the history is always complete.
 * - Read state is tracked per side (member / administration), which gives unread badges on both sides.
 * - E-mail notice goes out on the first unread message only, so a burst of messages does not flood the inbox.
 */
export type Side = 'member' | 'admin';
type Actorish = UserLike & { name: string; email: string };

export type ConversationRow = {
  id: string; member_id: string; member_name: string; subject: string; status: 'open' | 'closed'; booking_id: string | null; booking_ref: string | null;
  last_message_at: string; last_message_by: Side; unread: number; preview: string; message_count: number;
};
export type MessageRow = { id: string; sender_side: Side; sender_name: string; body: string; created_at: string };

const sideOf = (u: UserLike): Side => (isAdmin(u) ? 'admin' : 'member');
const clean = (s: string, max: number) => s.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);

function checkBody(body: string) {
  const b = clean(body, 5000);
  if (b.length < 1) throw new DomainError('empty', 'Skriv en melding.');
  if (body.trim().length > 5000) throw new DomainError('too_long', 'Meldingen er for lang (maks 5000 tegn).');
  return b;
}

/** Load a conversation the user may see; members only their own, admins all. */
async function loadFor(u: UserLike, id: string, db: Db = getPool()) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError('not_found', 'Fant ikke samtalen.', 404);
  const c = await one<any>(`SELECT * FROM conversations WHERE id=$1`, [id], db);
  if (!c) throw new DomainError('not_found', 'Fant ikke samtalen.', 404);
  if (!isAdmin(u) && c.member_id !== u.id) throw forbidden();
  return c;
}

/** Start a conversation. Members start their own; admins start one with a chosen member. */
export async function startConversation(u: Actorish, input: { subject: string; body: string; memberId?: string; bookingId?: string | null }, actor: Actor): Promise<string> {
  if (!can(u, 'request_booking')) throw forbidden();
  const side = sideOf(u);
  const subject = clean(input.subject, 160).replace(/\n/g, ' ');
  if (subject.length < 2) throw new DomainError('subject', 'Skriv et emne.');
  const body = checkBody(input.body);
  await rateLimit(`msg:${u.id}`, side === 'admin' ? 300 : 30, 3600);
  const memberId = side === 'admin' ? input.memberId : u.id;
  if (!memberId) throw new DomainError('member', 'Velg et medlem.');
  return tx(async c => {
    const member = await one<{ id: string; status: string; system_role: string }>(`SELECT id, status, system_role FROM users WHERE id=$1`, [memberId], c);
    if (!member || member.status !== 'active' || !['member', 'admin', 'super_admin'].includes(member.system_role)) throw new DomainError('member', 'Medlemmet finnes ikke eller er ikke aktivt.');
    let bookingId: string | null = null;
    if (input.bookingId) {
      const b = await one<{ id: string }>(`SELECT id FROM bookings WHERE id=$1 AND member_id=$2`, [input.bookingId, memberId], c);
      if (!b) throw new DomainError('booking', 'Bookingen tilhører ikke dette medlemmet.');
      bookingId = b.id;
    }
    const conv = (await one<{ id: string }>(
      `INSERT INTO conversations (member_id, subject, booking_id, started_by, created_by_user_id, last_message_by, ${side === 'admin' ? 'admin_last_read_at' : 'member_last_read_at'})
       VALUES ($1,$2,$3,$4,$5,$4, now()) RETURNING id`, [memberId, subject, bookingId, side, u.id], c))!;
    await c.query(`INSERT INTO messages (conversation_id, sender_user_id, sender_side, body) VALUES ($1,$2,$3,$4)`, [conv.id, u.id, side, body]);
    await audit(c, actor, 'conversation.started', 'conversation', conv.id, undefined, { subject, booking_id: bookingId, side });
    await notifyOtherSide(c, conv.id, side, u, subject, body, true);
    return conv.id;
  });
}

/** Reply in a conversation. A member reply re-opens a closed conversation. */
export async function postMessage(u: Actorish, conversationId: string, rawBody: string, actor: Actor): Promise<void> {
  if (!can(u, 'request_booking')) throw forbidden();
  const side = sideOf(u);
  const body = checkBody(rawBody);
  await rateLimit(`msg:${u.id}`, side === 'admin' ? 300 : 30, 3600);
  await tx(async c => {
    const conv = await loadFor(u, conversationId, c);
    await c.query(`SELECT 1 FROM conversations WHERE id=$1 FOR UPDATE`, [conv.id]);
    if (conv.status === 'closed' && side === 'admin') throw new DomainError('closed', 'Samtalen er lukket. Åpne den igjen for å svare.');
    // Was the other side already notified about something they haven't read yet?
    const otherRead = side === 'member' ? conv.admin_last_read_at : conv.member_last_read_at;
    const pending = await one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_side=$2 AND ($3::timestamptz IS NULL OR created_at > $3) LIMIT 1`, [conv.id, side, otherRead], c);
    await c.query(`INSERT INTO messages (conversation_id, sender_user_id, sender_side, body) VALUES ($1,$2,$3,$4)`, [conv.id, u.id, side, body]);
    await c.query(`UPDATE conversations SET last_message_at=now(), last_message_by=$2, ${side === 'admin' ? 'admin_last_read_at' : 'member_last_read_at'}=now(),
                   status='open', closed_at=NULL WHERE id=$1`, [conv.id, side]);
    if (conv.status === 'closed') await audit(c, actor, 'conversation.reopened', 'conversation', conv.id, undefined, { by: side });
    if (!pending) await notifyOtherSide(c, conv.id, side, u, conv.subject, body, false);
  });
}

async function notifyOtherSide(c: Db, conversationId: string, from: Side, sender: Actorish, subject: string, body: string, isNew: boolean) {
  const excerpt = body.length > 600 ? body.slice(0, 600) + ' …' : body;
  if (from === 'member') {
    await notifyAdmins({
      type: 'message_from_member', subject: `${isNew ? 'Ny melding' : 'Nytt svar'} fra ${sender.name}: ${subject}`,
      body: `${sender.name} har sendt en melding:\n\n${excerpt}\n\nSvar her: ${appUrl('/admin/meldinger/' + conversationId)}`,
    }, c);
    return;
  }
  const m = await one<{ id: string; email: string; name: string; preferred_lang: string; status: string; notify_email: boolean }>(
    `SELECT u.id, u.email, u.name, u.preferred_lang, u.status, u.notify_email FROM conversations cv JOIN users u ON u.id=cv.member_id WHERE cv.id=$1`, [conversationId], c);
  if (!m || m.status !== 'active') return;
  const link = appUrl('/medlem/meldinger/' + conversationId);
  const first = m.name.split(' ')[0];
  await enqueue(m.preferred_lang === 'en'
    ? { userId: m.id, to: m.email, type: 'message_from_admin', subject: `New message from Mountain Retreat: ${subject}`,
        body: `Hi ${first}!\n\nYou have a new message from Mountain Retreat:\n\n${excerpt}\n\nRead and reply: ${link}` }
    : { userId: m.id, to: m.email, type: 'message_from_admin', subject: `Ny melding fra Mountain Retreat: ${subject}`,
        body: `Hei ${first}!\n\nDu har fått en ny melding fra Mountain Retreat:\n\n${excerpt}\n\nLes og svar: ${link}` }, c);
}

/** Thread for display; marks it read for the viewer's side. */
export async function openConversation(u: UserLike, id: string, opts: { markRead?: boolean } = { markRead: true }) {
  const conv = await loadFor(u, id);
  const side: Side = isAdmin(u) ? 'admin' : 'member';
  const hadUnread = !!(await one(`SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_side<>$2 AND ($3::timestamptz IS NULL OR created_at > $3) LIMIT 1`,
    [conv.id, side, side === 'admin' ? conv.admin_last_read_at : conv.member_last_read_at]));
  if (opts.markRead !== false) {
    await getPool().query(`UPDATE conversations SET ${isAdmin(u) ? 'admin_last_read_at' : 'member_last_read_at'}=now() WHERE id=$1`, [conv.id]);
  }
  const messages = await q<MessageRow>(
    `SELECT m.id, m.sender_side, u.name AS sender_name, m.body, m.created_at FROM messages m JOIN users u ON u.id=m.sender_user_id
     WHERE m.conversation_id=$1 ORDER BY m.created_at, m.id`, [conv.id]);
  const meta = await one<{ member_name: string; member_email: string; member_phone: string | null; booking_ref: string | null; booking_id: string | null; property: string | null }>(
    `SELECT u.name AS member_name, u.email AS member_email, u.phone AS member_phone, b.reference AS booking_ref, b.id AS booking_id, p.name AS property
     FROM conversations cv JOIN users u ON u.id=cv.member_id LEFT JOIN bookings b ON b.id=cv.booking_id LEFT JOIN properties p ON p.id=b.property_id WHERE cv.id=$1`, [conv.id]);
  return { conv, messages, meta: meta!, hadUnread };
}

const LIST_SQL = (side: Side) => `
  SELECT cv.id, cv.member_id, u.name AS member_name, cv.subject, cv.status, cv.booking_id, b.reference AS booking_ref, cv.last_message_at, cv.last_message_by,
    (SELECT count(*) FROM messages m WHERE m.conversation_id=cv.id AND m.sender_side <> '${side}'
       AND (cv.${side}_last_read_at IS NULL OR m.created_at > cv.${side}_last_read_at))::int AS unread,
    (SELECT left(m.body, 140) FROM messages m WHERE m.conversation_id=cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
    (SELECT count(*) FROM messages m WHERE m.conversation_id=cv.id)::int AS message_count
  FROM conversations cv JOIN users u ON u.id=cv.member_id LEFT JOIN bookings b ON b.id=cv.booking_id`;

export async function memberConversations(memberId: string): Promise<ConversationRow[]> {
  return q<ConversationRow>(`${LIST_SQL('member')} WHERE cv.member_id=$1 ORDER BY cv.last_message_at DESC`, [memberId]);
}

export type AdminFilter = 'unanswered' | 'open' | 'closed' | 'all';
export async function adminConversations(filter: AdminFilter = 'open', opts: { search?: string; memberId?: string } = {}): Promise<ConversationRow[]> {
  const where: string[] = [], params: unknown[] = [];
  if (filter === 'unanswered') where.push(`cv.status='open' AND cv.last_message_by='member'`);
  if (filter === 'open') where.push(`cv.status='open'`);
  if (filter === 'closed') where.push(`cv.status='closed'`);
  if (opts.memberId) { params.push(opts.memberId); where.push(`cv.member_id=$${params.length}`); }
  if (opts.search) {
    params.push('%' + opts.search.replace(/[%_\\]/g, m => '\\' + m) + '%');
    where.push(`(cv.subject ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR b.reference ILIKE $${params.length}
      OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=cv.id AND m.body ILIKE $${params.length}))`);
  }
  return q<ConversationRow>(`${LIST_SQL('admin')} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cv.last_message_at DESC LIMIT 200`, params);
}

/** Unread messages for the member (badge in the member menu). */
export async function memberUnreadCount(memberId: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
    WHERE cv.member_id=$1 AND m.sender_side='admin' AND (cv.member_last_read_at IS NULL OR m.created_at > cv.member_last_read_at)`, [memberId]))?.n ?? 0;
}

/** Open conversations waiting for an answer from the administration (badge in the admin menu). */
export async function adminUnansweredCount(): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM conversations WHERE status='open' AND last_message_by='member'`))?.n ?? 0;
}

export async function setConversationStatus(u: UserLike, id: string, status: 'open' | 'closed', actor: Actor): Promise<void> {
  if (!can(u, 'admin')) throw forbidden();
  const conv = await loadFor(u, id);
  if (conv.status === status) return;
  await tx(async c => {
    await c.query(`UPDATE conversations SET status=$2, closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END WHERE id=$1`, [id, status]);
    await audit(c, actor, status === 'closed' ? 'conversation.closed' : 'conversation.reopened', 'conversation', id);
  });
}
