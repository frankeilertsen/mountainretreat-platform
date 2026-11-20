import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/rbac';

export const metadata = { title: 'Renhold' };

export default async function CleaningLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('cleaning_portal');
  return (
    <>
      <header className="topbar"><div className="container" style={{ height: 58 }}>
        <Link href="/renhold" className="brand">Renhold</Link>
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
