import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { one } from '@/lib/db';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('admin');
  const c = await one<{ pending: number; cancel: number; loyalty: number; sync: number; reports: number; refunds: number }>(`SELECT
    (SELECT count(*) FROM bookings WHERE status='pending_review')::int AS pending,
    (SELECT count(*) FROM bookings WHERE status='cancellation_requested')::int AS cancel,
    (SELECT count(*) FROM loyalty_applications WHERE status='pending')::int AS loyalty,
    (SELECT count(*) FROM channel_connections WHERE active AND (last_sync_status='failure' OR id IN (SELECT connection_id FROM external_calendar_events WHERE sync_state='conflict')))::int AS sync,
    (SELECT count(*) FROM cleaning_reports WHERE resolved_at IS NULL AND kind <> 'comment')::int AS reports,
    (SELECT count(*) FROM refunds WHERE status IN ('failed','pending'))::int AS refunds`);
  const n = (v?: number, danger = false) => v ? <span className={`badge ${danger ? 'b-danger' : 'b-warn'}`}>{v}</span> : null;
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link href="/admin" className="brand">Mountain Retreat<span style={{ display: 'block', marginLeft: 0, marginTop: 4 }}>Administrasjon</span></Link>
        <nav>
          <Link href="/admin">Oversikt {n((c?.pending ?? 0) + (c?.cancel ?? 0) + (c?.loyalty ?? 0))}</Link>
          <div className="group">Drift</div>
          <Link href="/admin/bookinger">Bookinger</Link>
          <Link href="/admin/kalender">Kalender</Link>
          <Link href="/admin/renhold">Renhold {n(c?.reports)}</Link>
          <Link href="/admin/kanaler">Kanaler og synk {n(c?.sync, true)}</Link>
          <div className="group">Medlemmer</div>
          <Link href="/admin/medlemmer">Medlemmer og ansatte</Link>
          <Link href="/admin/bonus">Verving og bonus</Link>
          <div className="group">Økonomi</div>
          <Link href="/admin/betalinger">Betalinger {n(c?.refunds, true)}</Link>
          <Link href="/admin/rapporter">Rapporter</Link>
          <div className="group">Oppsett</div>
          <Link href="/admin/boliger">Boliger</Link>
          <Link href="/admin/innstillinger">Innstillinger</Link>
          <Link href="/admin/logg">Revisjonslogg</Link>
          <div className="group">{u.name}</div>
          <Link href="/medlem">Medlemsvisning</Link>
          <Link href="/renhold">Renholdsvisning</Link>
          <form action="/logout" method="post" style={{ padding: '8px 12px' }}><button className="btn ghost small">Logg ut</button></form>
        </nav>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
