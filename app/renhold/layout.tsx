import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/rbac';
import { Logo } from '@/components/Logo';
import { getLang } from '@/lib/i18n/lang';
import { cleanDict } from '@/lib/i18n/cleaning';
import { LangSwitch } from '@/components/LangSwitch';

export const metadata = { title: 'Renhold' };

export default async function CleaningLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('cleaning_portal');
  const lang = await getLang();
  const C = cleanDict[lang];
  return (
    <>
      <header className="topbar"><div className="container" style={{ height: 58 }}>
        <span className="row" style={{ gap: 10 }}><Logo variant="mark" href="/renhold" width={84} /><span className="logo-label">{C.portal}</span></span>
        <span className="row clean-head-right"><LangSwitch lang={lang} className="compact" /><small className="muted hide-sm">{u.name.split(' ')[0]}</small>{isAdmin(u as any) && <Link href="/admin" className="btn ghost small">{C.admin}</Link>}
          <form action="/logout" method="post" className="hide-sm"><button className="btn ghost small">{C.logout}</button></form></span>
      </div></header>
      <div className="clean">{children}</div>
      <nav className="tabbar">
        <Link href="/renhold"><span>☀︎</span>{C.tabs.today}</Link>
        <Link href="/renhold/kalender?visning=uke"><span>▦</span>{C.tabs.week}</Link>
        <Link href="/renhold/kalender?visning=maaned"><span>◫</span>{C.tabs.month}</Link>
        <Link href="/renhold/profil"><span>◎</span>{C.tabs.profile}</Link>
      </nav>
    </>
  );
}
