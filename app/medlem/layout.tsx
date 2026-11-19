import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/rbac';

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('request_booking');
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link href="/medlem" className="brand">Mountain Retreat</Link>
          <nav className="nav">
            <Link href="/medlem">Oversikt</Link>
            <Link href="/medlem/bookinger">Bookinger</Link>
            <Link href="/medlem/invitasjoner">Inviter</Link>
            <Link href="/medlem/bonus">Bonus</Link>
            <Link href="/medlem/profil">Profil</Link>
            {isAdmin(u as any) && <Link href="/admin">Admin →</Link>}
          </nav>
        </div>
      </header>
      <main><div className="container">{children}</div></main>
    </>
  );
}
