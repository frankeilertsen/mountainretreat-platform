import { one } from '../db';
import { adminUnansweredCount, memberUnreadCount } from './messages';

export type AdminBadges = { pending: number; cancel: number; loyalty: number; sync: number; reports: number; refunds: number; inquiries: number; invoices: number; unanswered: number };

/** Counts shown as badges in the admin menu. */
export async function adminBadges(): Promise<AdminBadges> {
  const c = await one<Omit<AdminBadges, 'unanswered'>>(`SELECT
    (SELECT count(*) FROM bookings WHERE status='pending_review')::int AS pending,
    (SELECT count(*) FROM bookings WHERE status='cancellation_requested')::int AS cancel,
    (SELECT count(*) FROM loyalty_applications WHERE status='pending')::int AS loyalty,
    (SELECT count(*) FROM channel_connections WHERE active AND (last_sync_status='failure' OR id IN (SELECT connection_id FROM external_calendar_events WHERE sync_state='conflict')))::int AS sync,
    (SELECT count(*) FROM cleaning_reports WHERE resolved_at IS NULL AND kind <> 'comment')::int AS reports,
    (SELECT count(*) FROM refunds WHERE status IN ('failed','pending'))::int AS refunds,
    (SELECT count(*) FROM long_term_inquiries WHERE status='new')::int AS inquiries,
    (SELECT count(*) FROM invoices WHERE status IN ('draft','overdue'))::int AS invoices`);
  return { ...c!, unanswered: await adminUnansweredCount() };
}

export async function memberBadges(userId: string) {
  return { unread: await memberUnreadCount(userId) };
}

/** Stable fingerprint, so the browser can tell when anything changed. */
export const badgeSignature = (b: Record<string, number>) => Object.keys(b).sort().map(k => `${k}:${b[k]}`).join(',');
