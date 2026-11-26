import { Db, getPool, q } from './db';

export type NotificationInput = {
  userId?: string | null;
  to: string;
  type: string;
  subject: string;
  body: string;          // plain text; rendered into a simple HTML template on send
  channel?: 'email' | 'sms' | 'push';
  dedupeKey?: string;    // prevents duplicate sends for the same event
  payload?: unknown;
};

/** Queue a notification (outbox pattern). Call inside the business transaction so it is sent only if the change commits. */
export async function enqueue(n: NotificationInput, db: Db = getPool()): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, to_address, type, channel, subject, body, payload, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.userId ?? null, n.to, n.type, n.channel ?? 'email', n.subject, n.body, n.payload ? JSON.stringify(n.payload) : null, n.dedupeKey ?? null],
  );
}

/** Notify every active admin. */
export async function notifyAdmins(n: Omit<NotificationInput, 'to' | 'userId'>, db: Db = getPool()): Promise<void> {
  const admins = await q<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE system_role IN ('super_admin','admin') AND status = 'active'`, [], db);
  for (const a of admins) {
    await enqueue({ ...n, userId: a.id, to: a.email, dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${a.id}` : undefined }, db);
  }
}

export type Attachment = { filename: string; content: Buffer };
export interface ChannelSender { send(to: string, subject: string, text: string, opts?: { replyTo?: string; attachments?: Attachment[]; html?: string }): Promise<void>; }

class ResendEmail implements ChannelSender {
  constructor(private apiKey: string, private from: string) {}
  async send(to: string, subject: string, text: string, opts?: { replyTo?: string; attachments?: Attachment[]; html?: string }) {
    const attachments = opts?.attachments?.map(a => ({ filename: a.filename, content: a.content.toString('base64') }));
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject, text, html: opts?.html || renderHtml(subject, text), ...((opts?.replyTo || process.env.EMAIL_REPLY_TO) ? { reply_to: opts?.replyTo || process.env.EMAIL_REPLY_TO } : {}), ...(attachments?.length ? { attachments } : {}) }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
class LogOnlyEmail implements ChannelSender {
  async send(to: string, subject: string, text: string, opts?: { attachments?: Attachment[] }) {
    const att = opts?.attachments?.map(a => `\n[vedlegg: ${a.filename}, ${Math.round(a.content.length / 1024)} KB]`).join('') ?? '';
    console.log(`\n[email:dev] to=${to}\nsubject: ${subject}\n${text}${att}\n`);
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function renderHtml(subject: string, text: string) {
  const body = escapeHtml(text).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#2b2a27">
    <p><img src="${appUrl('/brand/logo-dark.png')}" alt="Mountain Retreat" width="220" style="display:block;height:auto"></p>
    <h2 style="font-weight:normal">${escapeHtml(subject)}</h2><p style="font-family:Arial,sans-serif;line-height:1.6">${body}</p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#8a8579">FKE Property AS</p></div>`;
}

export function emailSender(): ChannelSender {
  return process.env.RESEND_API_KEY
    ? new ResendEmail(process.env.RESEND_API_KEY, process.env.EMAIL_FROM || 'booking@mountainretreat.no')
    : new LogOnlyEmail();
}

/** SMS via Twilio's REST API (works with any Twilio-compatible provider). Without credentials messages are only logged. */
class TwilioSms implements ChannelSender {
  constructor(private sid: string, private token: string, private from: string) {}
  async send(to: string, _subject: string, text: string) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${this.sid}:${this.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: normalizePhone(to), From: this.from, Body: text.slice(0, 600) }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  }
}
class LogOnlySms implements ChannelSender {
  async send(to: string, _s: string, text: string) { console.log(`\n[sms:dev] to=${to}\n${text}\n`); }
}
export function normalizePhone(p: string): string {
  const d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  return d.length === 8 ? '+47' + d : '+' + d; // Norwegian 8-digit numbers
}
export function smsSender(): ChannelSender {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from } = process.env;
  return sid && tok && from ? new TwilioSms(sid, tok, from) : new LogOnlySms();
}

/** Deliver queued notifications (e-mail and SMS). Push is structured but has no sender yet. */
export async function deliverQueued(limit = 50): Promise<{ sent: number; failed: number }> {
  const db = getPool();
  const rows = await q<{ id: string; to_address: string; subject: string; body: string; channel: string; payload: any }>(
    `UPDATE notifications SET attempts = attempts + 1
     WHERE id IN (SELECT id FROM notifications WHERE status = 'queued' AND attempts < 5 ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, to_address, subject, body, channel, payload`, [limit], db);
  const email = emailSender(), sms = smsSender();
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      if (r.channel === 'email') await email.send(r.to_address, r.subject, r.body, { replyTo: r.payload?.replyTo, attachments: await loadAttachments(r.payload), html: typeof r.payload?.html === 'string' ? r.payload.html : undefined });
      else if (r.channel === 'sms') await sms.send(r.to_address, r.subject, r.body);
      else throw new Error(`No sender configured for channel ${r.channel}`);
      await db.query(`UPDATE notifications SET status='sent', sent_at=now(), last_error=NULL WHERE id=$1`, [r.id]);
      sent++;
    } catch (e) {
      await db.query(`UPDATE notifications SET last_error=$2, status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END WHERE id=$1`,
        [r.id, (e as Error).message.slice(0, 500)]);
      failed++;
    }
  }
  return { sent, failed };
}

/** Attachments referenced from a notification payload (loaded at send time, so files are not copied into the queue). */
async function loadAttachments(payload: any): Promise<Attachment[] | undefined> {
  if (Array.isArray(payload?.mailingAttachmentIds) && payload.mailingAttachmentIds.length) {
    const { getObject } = await import('./storage');
    const files = await q<{ storage_key: string; filename: string }>(`SELECT storage_key, filename FROM mailing_files WHERE id = ANY($1::uuid[]) ORDER BY sort_order`, [payload.mailingAttachmentIds]);
    const out: Attachment[] = [];
    for (const f of files) { const data = await getObject(f.storage_key); if (data) out.push({ filename: f.filename, content: data }); }
    return out;
  }
  if (!payload?.attachPresentationId) return undefined;
  const { readPresentation } = await import('./domain/presentations');
  const p = await readPresentation(payload.attachPresentationId, { includeInactive: true });
  return p ? [{ filename: p.original_filename, content: p.data }] : undefined; // missing file: the e-mail still goes out (the link on the invitation page remains)
}

export function appUrl(path = ''): string {
  // APP_URL = the site's address (your own domain). On Render, before a domain is connected, the service's own address is used.
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '') + path;
}
