import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { one } from '@/lib/db';
import { SideNav } from '@/components/SideNav';
import { Logo } from '@/components/Logo';
import { adminUnansweredCount } from '@/lib/domain/messages';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('admin');
  const c = await one<{ pending: number; cancel: number; loyalty: number; sync: number; reports: number; refunds: number; inquiries: number }>(`SELECT
    (SELECT count(*) FROM bookings WHERE status='pending_review')::int AS pending,
    (SELECT count(*) FROM bookings WHERE status='cancellation_requested')::int AS cancel,
    (SELECT count(*) FROM loyalty_applications WHERE status='pending')::int AS loyalty,
    (SELECT count(*) FROM channel_connections WHERE active AND (last_sync_status='failure' OR id IN (SELECT connection_id FROM external_calendar_events WHERE sync_state='conflict')))::int AS sync,
    (SELECT count(*) FROM cleaning_reports WHERE resolved_at IS NULL AND kind <> 'comment')::int AS reports,
    (SELECT count(*) FROM refunds WHERE status IN ('failed','pending'))::int AS refunds,
    (SELECT count(*) FROM long_term_inquiries WHERE status='new')::int AS inquiries`);
  const unanswered = await adminUnansweredCount();
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Logo href="/admin" width={210} label="Administrasjon" />
        <SideNav exact={['/admin']} items={[
          { href: '/admin', label: 'Oversikt', badge: (c?.pending ?? 0) + (c?.cancel ?? 0) + (c?.loyalty ?? 0) },
          { group: 'Drift' },
          { href: '/admin/bookinger', label: 'Bookinger', badge: c?.pending },
          { href: '/admin/kalender', label: 'Kalender' },
          { href: '/admin/renhold', label: 'Renhold', badge: c?.reports },
          { href: '/admin/kanaler', label: 'Kanaler og synk', badge: c?.sync, danger: true },
          { group: 'Medlemmer' },
          { href: '/admin/medlemmer', label: 'Medlemmer og ansatte', badge: c?.loyalty },
          { href: '/admin/meldinger', label: 'Meldinger', badge: unanswered },
          { href: '/admin/presentasjoner', label: 'Presentasjoner (PDF)' },
          { href: '/admin/bonus', label: 'Medlemsfordeler' },
          { href: '/admin/foresporsler', label: 'Fast leie – forespørsler', badge: c?.inquiries },
          { group: 'Økonomi' },
          { href: '/admin/betalinger', label: 'Betalinger', badge: c?.refunds, danger: true },
          { href: '/admin/rapporter', label: 'Rapporter' },
          { group: 'Oppsett' },
          { href: '/admin/boliger', label: 'Boliger' },
          { href: '/admin/innstillinger', label: 'Innstillinger' },
          { href: '/admin/sikkerhetskopi', label: 'Sikkerhetskopi' },
          { href: '/admin/logg', label: 'Revisjonslogg' },
          { group: 'Visninger' },
          { href: '/medlem', label: 'Medlemsportal' },
          { href: '/renhold', label: 'Renholdsportal' },
        ]} />
        <div className="user">
          <div>{u.name}</div><small>{u.system_role === 'super_admin' ? 'Super-admin' : 'Eiendomsadministrator'}</small>
          <form action="/logout" method="post" style={{ marginTop: 12 }}><button className="btn ghost small">Logg ut</button></form>
        </div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
