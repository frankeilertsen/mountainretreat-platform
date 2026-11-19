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

export interface ChannelSender { send(to: string, subject: string, text: string): Promise<void>; }

class ResendEmail implements ChannelSender {
  constructor(private apiKey: string, private from: string) {}
  async send(to: string, subject: string, text: string) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject, text, html: renderHtml(subject, text) }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
class LogOnlyEmail implements ChannelSender {
  async send(to: string, subject: string, text: string) {
    console.log(`\n[email:dev] to=${to}\nsubject: ${subject}\n${text}\n`);
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function renderHtml(subject: string, text: string) {
  const body = escapeHtml(text).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#2b2a27">
    <p style="letter-spacing:.2em;font-size:12px;color:#8a8579">MOUNTAIN RETREAT</p>
    <h2 style="font-weight:normal">${escapeHtml(subject)}</h2><p style="font-family:Arial,sans-serif;line-height:1.6">${body}</p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#8a8579">Byrampen Eiendom AS</p></div>`;
}

export function emailSender(): ChannelSender {
  return process.env.RESEND_API_KEY
    ? new ResendEmail(process.env.RESEND_API_KEY, process.env.EMAIL_FROM || 'booking@mountainretreat.no')
    : new LogOnlyEmail();
}

/** Deliver queued notifications. SMS/push are queued but have no sender yet (structure ready). */
export async function deliverQueued(limit = 50): Promise<{ sent: number; failed: number }> {
  const db = getPool();
  const rows = await q<{ id: string; to_address: string; subject: string; body: string; channel: string }>(
    `UPDATE notifications SET attempts = attempts + 1
     WHERE id IN (SELECT id FROM notifications WHERE status = 'queued' AND attempts < 5 ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, to_address, subject, body, channel`, [limit], db);
  const email = emailSender();
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      if (r.channel !== 'email') throw new Error(`No sender configured for channel ${r.channel}`);
      await email.send(r.to_address, r.subject, r.body);
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

export function appUrl(path = ''): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '') + path;
}
