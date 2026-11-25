import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { SideNav } from '@/components/SideNav';
import { Logo } from '@/components/Logo';
import { adminBadges, badgeSignature } from '@/lib/domain/badges';
import { LiveBadges } from '@/components/LiveBadges';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('admin');
  const c = await adminBadges();
  const unanswered = c.unanswered;
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Logo href="/admin" width={210} label="Administrasjon" />
        <LiveBadges scope="admin" sig={badgeSignature(c)} />
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
          { href: '/admin/betalinger', label: 'Betalinger', badge: (c?.refunds ?? 0) + (c?.invoices ?? 0) || undefined, danger: true },
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
