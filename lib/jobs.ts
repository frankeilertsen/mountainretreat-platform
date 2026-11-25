import { getPool, one, q, tx } from './db';
import { autoResolveCancellations, completeStays, expireHolds, processRefunds, sendHoldReminders } from './domain/bookings';
import { vestAndExpireRewards } from './domain/rewards';
import { syncAllDue, staleExportFeeds } from './channels/sync';
import { deliverQueued, notifyAdmins, enqueue, appUrl } from './notify';
import { getNum } from './settings';
import { addDays, todayOslo, fmtDate } from './format';
import { audit, SYSTEM } from './audit';
import { notifyHelper, sameDayCleaningReminders } from './domain/cleaning';
import { helperMsg } from './i18n/cleaning';
import { checkOpenVippsPayments } from './payments/vipps';
import { sendReviewRequests } from './domain/reviews';

type JobFn = () => Promise<unknown>;

/** Every background job. Each is idempotent and safe to run concurrently with itself (row locks / dedupe keys). */
export const JOBS: Record<string, JobFn> = {
  expire_holds: expireHolds,
  hold_reminders: sendHoldReminders,
  auto_resolve_cancellations: autoResolveCancellations,
  complete_stays: completeStays,
  rewards_vest_expire: vestAndExpireRewards,
  reward_expiry_warnings: rewardExpiryWarnings,
  channel_sync: syncAllDue,
  export_feed_watch: exportFeedWatch,
  cleaning_reminders: cleaningDayBeforeReminders,
  cleaning_same_day: async () => sameDayCleaningReminders(await getNum('cleaning_same_day_reminder_hour', 7)),
  checkin_reminders: checkinReminders,
  retry_refunds: () => processRefunds(),
  vipps_check: () => checkOpenVippsPayments(),
  invoice_overdue: invoiceOverdue,
  review_requests: () => sendReviewRequests(),
  retention_purge: retentionPurge,
  deliver_notifications: () => deliverQueued(100),
};

export async function runJob(name: string) {
  const fn = JOBS[name];
  if (!fn) throw new Error('Unknown job ' + name);
  const run = await one<{ id: string }>(`INSERT INTO job_runs (job) VALUES ($1) RETURNING id`, [name]);
  try {
    const detail = await fn();
    await getPool().query(`UPDATE job_runs SET finished_at=now(), status='success', detail=$2 WHERE id=$1`, [run!.id, JSON.stringify(detail ?? null)]);
    return detail;
  } catch (e) {
    await getPool().query(`UPDATE job_runs SET finished_at=now(), status='failure', detail=$2 WHERE id=$1`, [run!.id, JSON.stringify({ error: (e as Error).message })]);
    throw e;
  }
}

export async function runAllJobs() {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(JOBS)) {
    try { out[name] = await runJob(name); } catch (e) { out[name] = { error: (e as Error).message }; }
  }
  return out;
}

/** Invoices sent from Fiken that are past due: mark as overdue and tell the administrators once. */
async function invoiceOverdue() {
  const rows = await q<{ id: string; reference: string; name: string; amount_ore: number; fiken: string | null }>(
    `UPDATE invoices i SET status='overdue' FROM payments p, bookings b, users u
      WHERE p.id=i.payment_id AND b.id=p.booking_id AND u.id=b.member_id AND i.status='sent' AND i.due_date < current_date
      RETURNING i.id, b.reference, u.name, i.amount_ore, i.fiken_invoice_number AS fiken`);
  for (const r of rows) {
    await notifyAdmins({ type: 'invoice_overdue', dedupeKey: `invoice_overdue:${r.id}`, subject: `Faktura forfalt: ${r.name} (${r.reference})`,
      body: `Fakturaen${r.fiken ? ` (Fiken nr. ${r.fiken})` : ''} på ${(r.amount_ore / 100).toFixed(0)} kr er forfalt. Sjekk i Fiken og send purring om nødvendig: ${appUrl('/admin/betalinger/faktura/' + r.id)}` });
  }
  return rows.length;
}

async function rewardExpiryWarnings() {
  const rows = await q<{ id: string; user_id: string; email: string; name: string; remaining_amount_ore: number; days: number }>(
    `SELECT rc.id, rc.user_id, u.email, u.name, rc.remaining_amount_ore, (rc.expires_at::date - current_date) AS days
     FROM reward_credits rc JOIN users u ON u.id=rc.user_id
     WHERE rc.status IN ('available','partially_used') AND rc.remaining_amount_ore > 0 AND rc.expires_at::date - current_date IN (60, 7)`);
  for (const r of rows) {
    await enqueue({ userId: r.user_id, to: r.email, type: 'reward_expiring', dedupeKey: `reward_expiring:${r.id}:${r.days}`,
      subject: `Bonusen din utløper om ${r.days} dager`, body: `Hei ${r.name}! Du har ${(r.remaining_amount_ore / 100).toFixed(0)} kr i bonus som utløper om ${r.days} dager. Bruk den på neste opphold: ${appUrl('/medlem')}` });
  }
  return rows.length;
}

async function exportFeedWatch() {
  const stale = await staleExportFeeds();
  for (const s of stale) {
    await notifyAdmins({ type: 'export_feed_stale', dedupeKey: `export_feed_stale:${s.id}:${todayOslo()}`, subject: `${s.display_name} har ikke hentet kalenderen på over 24 timer`,
      body: `Eksportfeeden for ${s.property} hentes ikke. Sjekk at lenken er lagt inn i ${s.display_name}s kalenderinnstillinger.` });
  }
  return stale.length;
}

async function cleaningDayBeforeReminders() {
  const tomorrow = addDays(todayOslo(), 1);
  const rows = await q<{ id: string; email: string; name: string; user_id: string; property: string }>(
    `SELECT t.id, u.email, u.name, u.id AS user_id, p.name AS property FROM cleaning_tasks t JOIN users u ON u.id=t.assigned_to_user_id JOIN properties p ON p.id=t.property_id
     WHERE t.checkout_date=$1 AND t.status IN ('assigned')`, [tomorrow]);
  for (const r of rows) {
    await notifyHelper(getPool(), r.user_id, helperMsg.reminderTomorrow(r.property, tomorrow), r.id, { dedupe: `cleaning_reminder:${r.id}` });
  }
  const unassigned = await one<{ n: number }>(`SELECT count(*)::int AS n FROM cleaning_tasks WHERE checkout_date BETWEEN current_date AND current_date + 2 AND status='open'`);
  if (unassigned && unassigned.n > 0) {
    await notifyAdmins({ type: 'cleaning_unassigned', dedupeKey: `cleaning_unassigned:${todayOslo()}`, subject: `${unassigned.n} renholdsjobb(er) uten renholder de neste 3 dagene`, body: appUrl('/admin/renhold') });
  }
  return rows.length;
}

async function checkinReminders() {
  const in3 = addDays(todayOslo(), 3);
  const rows = await q<{ id: string; reference: string; email: string; name: string; member_id: string; property: string; address: string | null; cin: string; start: string }>(
    `SELECT b.id, b.reference, u.email, u.name, u.id AS member_id, p.name AS property, p.address, to_char(p.check_in_time,'HH24:MI') AS cin, to_char(b.start_date,'YYYY-MM-DD') AS start
     FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id WHERE b.status='confirmed' AND b.start_date=$1`, [in3]);
  for (const r of rows) {
    await enqueue({ userId: r.member_id, to: r.email, type: 'checkin_reminder', dedupeKey: `checkin_reminder:${r.id}`, subject: `Snart tid for ${r.property}!`,
      body: `Hei ${r.name}! Vi gleder oss til å ha deg på besøk ${fmtDate(r.start, true)}. Innsjekk fra kl. ${r.cin}.${r.address ? `\nAdresse: ${r.address}` : ''}` });
  }
  return rows.length;
}

async function retentionPurge() {
  const auditDays = await getNum('audit_log_retention_days', 365);
  const notifDays = await getNum('notification_log_retention_days', 365);
  return tx(async c => {
    await c.query(`SET LOCAL app.allow_audit_purge = 'on'`);
    const a = await c.query(`DELETE FROM audit_log WHERE created_at < now() - make_interval(days => $1)`, [auditDays]);
    const n = await c.query(`DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1) AND status <> 'queued'`, [notifDays]);
    await c.query(`DELETE FROM login_tokens WHERE expires_at < now() - interval '7 days'`);
    await c.query(`DELETE FROM sessions WHERE expires_at < now() - interval '30 days'`);
    await c.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
    await c.query(`DELETE FROM captcha_used WHERE used_at < now() - interval '1 day'`);
    await audit(c, SYSTEM, 'retention.purge', 'system', null, undefined, { audit: a.rowCount, notifications: n.rowCount });
    return { audit: a.rowCount, notifications: n.rowCount };
  });
}
