import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { isAdmin, can } from '@/lib/auth/rbac';
import { q } from '@/lib/db';
import { SideNav, NavItem } from '@/components/SideNav';

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('request_booking');
  const props = await q<{ slug: string; name: string }>(`SELECT slug, name FROM properties WHERE active ORDER BY name`);
  const items: NavItem[] = [
    { href: '/medlem', label: 'Oversikt' },
    { href: '/medlem/fordeler', label: 'Medlemsfordeler' },
    { group: 'Boliger' },
    ...props.map(p => ({ href: `/medlem/boliger/${p.slug}`, label: p.name })),
    { group: 'Min side' },
    { href: '/medlem/bookinger', label: 'Mine bookinger' },
    { href: '/medlem/invitasjoner', label: can(u as any, 'invite') ? 'Inviter venner' : 'Invitasjoner' },
    { href: '/medlem/bonus', label: 'Bonuslommebok' },
    { href: '/medlem/profil', label: 'Profil og personvern' },
  ];
  if (isAdmin(u as any)) items.push({ group: 'Administrasjon' }, { href: '/admin', label: 'Til admin' });
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link href="/medlem" className="brand">Mountain Retreat<span>Venner og familie</span></Link>
        <SideNav exact={['/medlem']} items={items} />
        <div className="user"><div>{u.name}</div><small>Medlem</small>
          <form action="/logout" method="post" style={{ marginTop: 12 }}><button className="btn ghost small">Logg ut</button></form></div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
