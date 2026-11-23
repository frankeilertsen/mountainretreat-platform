import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { isAdmin, can } from '@/lib/auth/rbac';
import { q } from '@/lib/db';
import { SideNav, NavItem } from '@/components/SideNav';
import { Logo } from '@/components/Logo';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const N = t.nav;
  const props = await q<{ slug: string; name: string }>(`SELECT slug, name FROM properties WHERE active ORDER BY name`);
  const items: NavItem[] = [
    { href: '/medlem', label: N.overview },
    { href: '/medlem/fordeler', label: N.benefits },
    { group: N.properties },
    ...props.map(p => ({ href: `/medlem/boliger/${p.slug}`, label: p.name })),
    { group: N.myPage },
    { href: '/medlem/bookinger', label: N.bookings },
    { href: '/medlem/invitasjoner', label: can(u as any, 'invite') ? N.invite : N.invitations },
    { href: '/medlem/bonus', label: N.wallet },
    { href: '/medlem/profil', label: N.profile },
  ];
  if (isAdmin(u as any)) items.push({ group: N.admin }, { href: '/admin', label: N.toAdmin });
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Logo href="/medlem" width={210} label={N.tagline} />
        <SideNav exact={['/medlem']} items={items} />
        <div className="user"><div>{u.name}</div><small>{N.member}</small>
          <div style={{ margin: '12px 0' }}><LangSwitch lang={lang} /></div>
          <form action="/logout" method="post"><button className="btn ghost small">{t.common.logout}</button></form></div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
