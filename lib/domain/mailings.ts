import crypto from 'crypto';
import { getPool, one, q, tx, type Db } from '../db';
import { DomainError } from '../errors';
import { putObject, deleteObject } from '../storage';
import { enqueue, appUrl } from '../notify';
import { audit, type Actor } from '../audit';
import { getStr } from '../settings';

/**
 * E-mail to members ("Utsendelser").
 *  - kind 'news'  = news and offers (marketing): only members who have said yes to news (marketing_consent), with an unsubscribe link.
 *  - kind 'info'  = important information about the membership/stays: all chosen members.
 *  - audience: everyone, or a selection of members and/or whole invitation chains (a member + everyone they invited, all levels).
 * Body format: blank line = new paragraph, **bold**, links are clickable, [bilde 2] places image 2, [knapp: Tekst | https://…] makes a button,
 * {navn} is replaced by the member's first name. Images not placed with [bilde N] are shown after the text.
 */
export type Audience = { mode: 'all' | 'selected'; userIds: string[]; leaderIds: string[] };
export type Mailing = { id: string; kind: 'news' | 'info'; subject: string; body: string; subject_en: string | null; body_en: string | null; audience: Audience; status: 'draft' | 'sent'; recipient_count: number | null; sent_at: string | null; created_at: string };
export type MailingFile = { id: string; kind: 'image' | 'attachment'; filename: string; mime_type: string; size_bytes: number; public_token: string; storage_key: string };

export const LIMITS = { imageBytes: 5 * 1024 * 1024, images: 10, attachmentBytes: 10 * 1024 * 1024, attachmentsTotal: 20 * 1024 * 1024 };
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MEMBER_ROLES = `('member','admin','super_admin')`;

export async function getMailing(id: string, db: Db = getPool()) {
  const m = await one<Mailing>(`SELECT * FROM mailings WHERE id=$1`, [id], db);
  if (!m) throw new DomainError('not_found', 'Fant ikke utsendelsen.', 404);
  const files = await q<MailingFile>(`SELECT * FROM mailing_files WHERE mailing_id=$1 ORDER BY kind, sort_order, created_at`, [id], db);
  return { mailing: m, images: files.filter(f => f.kind === 'image'), attachments: files.filter(f => f.kind === 'attachment') };
}

export async function createMailing(actor: Actor) {
  const m = await one<{ id: string }>(`INSERT INTO mailings (created_by) VALUES ($1) RETURNING id`, [actor.id]);
  return m!.id;
}

function draftOnly(m: { status: string }) { if (m.status !== 'draft') throw new DomainError('sent', 'Utsendelsen er allerede sendt og kan ikke endres.'); }

export async function saveMailing(id: string, input: { kind: string; subject: string; body: string; subject_en?: string; body_en?: string; audience: Audience }, actor: Actor) {
  const { mailing } = await getMailing(id);
  draftOnly(mailing);
  const aud: Audience = { mode: input.audience.mode === 'selected' ? 'selected' : 'all', userIds: [...new Set(input.audience.userIds)].slice(0, 2000), leaderIds: [...new Set(input.audience.leaderIds)].slice(0, 2000) };
  await getPool().query(`UPDATE mailings SET kind=$2, subject=$3, body=$4, subject_en=$5, body_en=$6, audience=$7, updated_at=now() WHERE id=$1`,
    [id, input.kind === 'info' ? 'info' : 'news', input.subject.trim().slice(0, 200), input.body.slice(0, 20000), input.subject_en?.trim().slice(0, 200) || null, input.body_en?.slice(0, 20000) || null, JSON.stringify(aud)]);
  await audit(null, actor, 'mailing.saved', 'mailing', id);
}

export async function addMailingFile(id: string, kind: 'image' | 'attachment', file: { name: string; type: string; data: Buffer }, actor: Actor) {
  const { mailing, images, attachments } = await getMailing(id);
  draftOnly(mailing);
  if (!file.data.length) throw new DomainError('empty', 'Filen er tom.');
  let ext = 'bin';
  if (kind === 'image') {
    ext = IMAGE_TYPES[file.type] ?? '';
    if (!ext) throw new DomainError('type', 'Bilder må være JPG, PNG, WEBP eller GIF.');
    if (file.data.length > LIMITS.imageBytes) throw new DomainError('size', 'Bildet er for stort (maks 5 MB).');
    if (images.length >= LIMITS.images) throw new DomainError('count', 'Maks 10 bilder per utsendelse.');
  } else {
    if (file.data.length > LIMITS.attachmentBytes) throw new DomainError('size', 'Vedlegget er for stort (maks 10 MB).');
    if (attachments.reduce((s, a) => s + a.size_bytes, 0) + file.data.length > LIMITS.attachmentsTotal) throw new DomainError('size', 'Vedleggene blir til sammen for store (maks 20 MB).');
    if (file.type === 'application/pdf') ext = 'pdf';
  }
  const key = `mail/${crypto.randomUUID()}.${ext}`;
  await putObject(key, file.data, file.type || 'application/octet-stream');
  const order = (kind === 'image' ? images : attachments).length + 1;
  await getPool().query(`INSERT INTO mailing_files (mailing_id, kind, storage_key, filename, mime_type, size_bytes, public_token, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, kind, key, file.name.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'fil', file.type || 'application/octet-stream', file.data.length, crypto.randomBytes(24).toString('base64url'), order]);
  await audit(null, actor, 'mailing.file_added', 'mailing', id, undefined, { kind, filename: file.name });
}

export async function removeMailingFile(id: string, fileId: string, actor: Actor) {
  const { mailing } = await getMailing(id);
  draftOnly(mailing);
  const f = await one<{ storage_key: string }>(`DELETE FROM mailing_files WHERE id=$1 AND mailing_id=$2 RETURNING storage_key`, [fileId, id]);
  if (f) await deleteObject(f.storage_key).catch(() => {});
  await audit(null, actor, 'mailing.file_removed', 'mailing', id);
}

export async function deleteDraft(id: string, actor: Actor) {
  const { mailing, images, attachments } = await getMailing(id);
  draftOnly(mailing);
  for (const f of [...images, ...attachments]) await deleteObject(f.storage_key).catch(() => {});
  await getPool().query(`DELETE FROM mailings WHERE id=$1`, [id]);
  await audit(null, actor, 'mailing.deleted', 'mailing', id);
}

/** Members who match the audience; for news only those who said yes to news. */
export async function resolveRecipients(kind: 'news' | 'info', a: Audience, db: Db = getPool()) {
  const rows = await q<{ id: string; email: string; name: string; lang: string; consent: boolean }>(
    `WITH RECURSIVE chain AS (
       SELECT id FROM users WHERE id = ANY($2::uuid[])
       UNION SELECT u.id FROM users u JOIN chain c ON u.invited_by_user_id = c.id
     )
     SELECT u.id, u.email, u.name, u.preferred_lang AS lang, u.marketing_consent AS consent FROM users u
     WHERE u.status='active' AND u.system_role IN ${MEMBER_ROLES} AND u.email IS NOT NULL AND u.email NOT LIKE '%@anonymized.invalid'
       AND ($3 = 'all' OR u.id = ANY($1::uuid[]) OR u.id IN (SELECT id FROM chain))
     ORDER BY u.name`, [a.userIds ?? [], a.leaderIds ?? [], a.mode], db);
  const chosen = kind === 'news' ? rows.filter(r => r.consent) : rows;
  return { recipients: chosen, withoutConsent: kind === 'news' ? rows.filter(r => !r.consent) : [] };
}

// -------------------------------------------------------------- rendering
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const imgUrl = (f: MailingFile) => appUrl(`/api/epost/bilde/${f.public_token}`);

function inline(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#8a6d2f">$1</a>');
}

function imageHtml(f: MailingFile) {
  return `<p style="margin:18px 0"><img src="${imgUrl(f)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px"></p>`;
}

/** Body text → HTML blocks. Returns the html and the images that were placed with [bilde N]. */
export function renderBody(text: string, images: MailingFile[], firstName: string) {
  const used = new Set<number>();
  const blocks = text.replace(/\r/g, '').replace(/\{navn\}/gi, firstName).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const html = blocks.map(b => {
    const img = b.match(/^\[bilde\s*(\d+)\]$/i);
    if (img) { const n = Number(img[1]); const f = images[n - 1]; if (!f) return ''; used.add(n); return imageHtml(f); }
    const btn = b.match(/^\[knapp:\s*(.+?)\s*\|\s*(https?:\/\/\S+?)\s*\]$/i);
    if (btn) return `<p style="margin:22px 0"><a href="${esc(btn[2])}" style="background:#b8975a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-family:Arial,sans-serif;font-weight:bold;display:inline-block">${esc(btn[1])}</a></p>`;
    const lines = b.split('\n');
    if (lines.every(l => /^[-•]\s+/.test(l))) return `<ul style="font-family:Arial,sans-serif;line-height:1.6;padding-left:20px">${lines.map(l => `<li>${inline(l.replace(/^[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p style="font-family:Arial,sans-serif;line-height:1.6;margin:0 0 14px">${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
  const rest = images.filter((_, i) => !used.has(i + 1)).map(imageHtml).join('\n');
  return html + rest;
}

export function renderMailingHtml(m: Pick<Mailing, 'kind'>, subject: string, body: string, images: MailingFile[], attachments: MailingFile[], opts: { firstName: string; lang: 'no' | 'en'; unsubscribeUrl?: string | null; company: string }) {
  const en = opts.lang === 'en';
  const att = attachments.length ? `<p style="font-family:Arial,sans-serif;font-size:13px;color:#6f6a60">${en ? 'Attached' : 'Vedlagt'}: ${attachments.map(a => esc(a.filename)).join(', ')}</p>` : '';
  const why = m.kind === 'news'
    ? (en ? 'You receive this because you are a Retreat Club member and have said yes to news.' : 'Du får denne e-posten fordi du er medlem av Retreat Club og har sagt ja til nyheter.')
    : (en ? 'You receive this because you are a Retreat Club member.' : 'Du får denne e-posten fordi du er medlem av Retreat Club.');
  const unsub = opts.unsubscribeUrl ? ` <a href="${esc(opts.unsubscribeUrl)}" style="color:#8a8579">${en ? 'Unsubscribe from news' : 'Meld deg av nyheter'}</a>` : '';
  return `<div style="background:#f5f2ec;padding:24px 0"><div style="font-family:Georgia,serif;max-width:560px;margin:auto;background:#fff;padding:28px;border-radius:12px;color:#2b2a27">
    <p style="margin:0 0 18px"><img src="${appUrl('/brand/logo-dark.png')}" alt="Mountain Retreat" width="200" style="display:block;height:auto"></p>
    <h1 style="font-weight:normal;font-size:26px;margin:0 0 18px;color:#2b2a27;font-family:Georgia,serif">${esc(subject)}</h1>
    ${renderBody(body, images, opts.firstName)}
    ${att}
    <p style="font-family:Arial,sans-serif;font-size:13px;margin-top:22px"><a href="${appUrl('/medlem')}" style="color:#8a6d2f">mountainretreat.no</a></p>
  </div>
  <p style="font-family:Arial,sans-serif;font-size:11px;color:#8a8579;text-align:center;max-width:560px;margin:14px auto 0">${esc(opts.company)} · ${why}${unsub}</p></div>`;
}

/** Plain-text alternative (for e-mail clients without HTML). */
export function renderText(body: string, firstName: string, attachments: MailingFile[], unsubscribeUrl: string | null, lang: 'no' | 'en') {
  const t = body.replace(/\{navn\}/gi, firstName).replace(/^\[bilde\s*\d+\]$/gim, '').replace(/^\[knapp:\s*(.+?)\s*\|\s*(\S+?)\s*\]$/gim, '$1: $2').replace(/\*\*(.+?)\*\*/g, '$1').trim();
  return t + (attachments.length ? `\n\n${lang === 'en' ? 'Attached' : 'Vedlagt'}: ${attachments.map(a => a.filename).join(', ')}` : '')
    + (unsubscribeUrl ? `\n\n${lang === 'en' ? 'Unsubscribe from news' : 'Meld deg av nyheter'}: ${unsubscribeUrl}` : '');
}

// -------------------------------------------------------------- unsubscribe links
function secret() { return process.env.TOKEN_PEPPER || 'dev-pepper'; }
export function unsubscribeToken(userId: string) { return crypto.createHmac('sha256', secret()).update(`unsub:${userId}`).digest('base64url').slice(0, 32); }
export function unsubscribeUrl(userId: string) { return appUrl(`/nyhetsbrev/avmeld?u=${userId}&t=${unsubscribeToken(userId)}`); }
export function checkUnsubscribe(userId: string, token: string) {
  const want = Buffer.from(unsubscribeToken(userId)), got = Buffer.from(token || '');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// -------------------------------------------------------------- sending
function versionFor(m: Mailing, lang: string) {
  const en = lang === 'en' && !!m.subject_en?.trim() && !!m.body_en?.trim();
  return { subject: en ? m.subject_en! : m.subject, body: en ? m.body_en! : m.body, lang: (en ? 'en' : 'no') as 'no' | 'en' };
}

async function queueOne(m: Mailing, images: MailingFile[], attachments: MailingFile[], r: { id: string; email: string; name: string; lang: string }, opts: { dedupeKey?: string; test?: boolean; company: string }, db: Db) {
  const v = versionFor(m, r.lang);
  const first = (r.name || '').split(' ')[0] || '';
  const unsub = m.kind === 'news' && !opts.test ? unsubscribeUrl(r.id) : m.kind === 'news' ? appUrl('/medlem/profil') : null;
  const subject = (opts.test ? '[TEST] ' : '') + v.subject;
  await enqueue({ userId: r.id, to: r.email, type: opts.test ? 'mailing_test' : 'mailing', dedupeKey: opts.dedupeKey, subject,
    body: renderText(v.body, first, attachments, unsub, v.lang),
    payload: { mailingId: m.id, html: renderMailingHtml(m, v.subject, v.body, images, attachments, { firstName: first, lang: v.lang, unsubscribeUrl: unsub, company: opts.company }), mailingAttachmentIds: attachments.map(a => a.id) } }, db);
}

function validate(m: Mailing) {
  if (!m.subject.trim()) throw new DomainError('subject', 'Skriv et emne.');
  if (!m.body.trim()) throw new DomainError('body', 'Skriv en tekst.');
}

export async function sendTest(id: string, to: { id: string; email: string; name: string; lang?: string }) {
  const { mailing, images, attachments } = await getMailing(id);
  validate(mailing);
  const company = await getStr('company_name', 'FKE Property AS');
  await queueOne(mailing, images, attachments, { ...to, lang: 'no' }, { test: true, company }, getPool());
  if (mailing.subject_en?.trim() && mailing.body_en?.trim()) await queueOne(mailing, images, attachments, { ...to, lang: 'en' }, { test: true, company }, getPool());
}

export async function sendMailing(id: string, actor: Actor) {
  return tx(async c => {
    const m = await one<Mailing>(`SELECT * FROM mailings WHERE id=$1 FOR UPDATE`, [id], c);
    if (!m) throw new DomainError('not_found', 'Fant ikke utsendelsen.', 404);
    draftOnly(m); validate(m);
    const files = await q<MailingFile>(`SELECT * FROM mailing_files WHERE mailing_id=$1 ORDER BY kind, sort_order, created_at`, [id], c);
    const images = files.filter(f => f.kind === 'image'), attachments = files.filter(f => f.kind === 'attachment');
    const { recipients } = await resolveRecipients(m.kind, m.audience, c);
    if (!recipients.length) throw new DomainError('no_recipients', 'Ingen mottakere. Velg mottakere – nyheter går bare til medlemmer som har sagt ja til nyheter.');
    const company = await getStr('company_name', 'FKE Property AS', c);
    for (const r of recipients) await queueOne(m, images, attachments, r, { dedupeKey: `mailing:${m.id}:${r.id}`, company }, c);
    await c.query(`UPDATE mailings SET status='sent', sent_at=now(), recipient_count=$2, updated_at=now() WHERE id=$1`, [id, recipients.length]);
    await audit(c, actor, 'mailing.sent', 'mailing', id, undefined, { recipients: recipients.length, kind: m.kind });
    return recipients.length;
  });
}

export async function mailingStats(id: string) {
  return (await one<{ sent: number; queued: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE status='sent')::int AS sent, count(*) FILTER (WHERE status='queued')::int AS queued, count(*) FILTER (WHERE status='failed')::int AS failed
     FROM notifications WHERE type='mailing' AND payload->>'mailingId' = $1`, [id]))!;
}

/** Members who have invited at least one other member (leaders of an invitation chain), with the size of their chain. */
export async function invitationChains() {
  return q<{ id: string; name: string; email: string; direct: number; total: number }>(
    `WITH RECURSIVE tree AS (
       SELECT u.id AS root, u.id FROM users u WHERE u.system_role IN ${MEMBER_ROLES}
       UNION ALL SELECT t.root, c.id FROM tree t JOIN users c ON c.invited_by_user_id = t.id
     )
     SELECT u.id, u.name, u.email, (SELECT count(*) FROM users d WHERE d.invited_by_user_id=u.id AND d.status='active')::int AS direct,
            (SELECT count(*) FROM tree t JOIN users x ON x.id=t.id AND x.status='active' WHERE t.root=u.id AND t.id<>u.id)::int AS total
     FROM users u WHERE u.status='active' AND u.system_role IN ${MEMBER_ROLES}
       AND EXISTS (SELECT 1 FROM users d WHERE d.invited_by_user_id=u.id)
     ORDER BY total DESC, u.name`);
}
