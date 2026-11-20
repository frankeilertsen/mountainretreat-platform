'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = { href: string; label: string; badge?: number; danger?: boolean } | { group: string };

/** Left sidebar navigation with active state. */
export function SideNav({ items, exact = [] }: { items: NavItem[]; exact?: string[] }) {
  const path = usePathname();
  const isActive = (href: string) => exact.includes(href) ? path === href : path === href || path.startsWith(href + '/');
  return (
    <nav>
      {items.map((it, i) => 'group' in it
        ? <div key={'g' + i} className="group">{it.group}</div>
        : <Link key={it.href} href={it.href} className={isActive(it.href) ? 'active' : ''}>
            <span>{it.label}</span>
            {it.badge ? <span className={`badge ${it.danger ? 'b-danger' : 'b-warn'}`}>{it.badge}</span> : null}
          </Link>)}
    </nav>
  );
}

export function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  return <Link href={href} className={path === href.split('?')[0] ? 'active' : ''}>{children}</Link>;
}
