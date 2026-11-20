import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/rbac';
import { Logo } from '@/components/Logo';

export const metadata = { title: 'Renhold' };

export default async function CleaningLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('cleaning_portal');
  return (
    <>
      <header className="topbar"><div className="container" style={{ height: 58 }}>
        <span className="row" style={{ gap: 10 }}><Logo variant="mark" href="/renhold" width={84} /><span className="logo-label">Renhold</span></span>
        <span className="row"><small className="muted">{u.name.split(' ')[0]}</small>{isAdmin(u as any) && <Link href="/admin" className="btn ghost small">Admin</Link>}
          <form action="/logout" method="post"><button className="btn ghost small">Logg ut</button></form></span>
      </div></header>
      <div className="clean">{children}</div>
      <nav className="tabbar">
        <Link href="/renhold"><span>☀︎</span>I dag</Link>
        <Link href="/renhold/kalender?visning=uke"><span>▦</span>Uke</Link>
        <Link href="/renhold/kalender?visning=maaned"><span>◫</span>Måned</Link>
        <Link href="/renhold/profil"><span>◎</span>Profil</Link>
      </nav>
    </>
  );
}
