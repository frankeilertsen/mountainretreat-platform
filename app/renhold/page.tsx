import { requireUser } from '@/lib/auth/current';
import { tasksForHelper } from '@/lib/domain/cleaning';
import { q } from '@/lib/db';
import { addDays, fmtDate, todayOslo } from '@/lib/format';
import { Flash, Empty } from '@/components/ui';
import { TaskCard } from '@/components/TaskCard';
import { getLang } from '@/lib/i18n/lang';
import { cleanDict } from '@/lib/i18n/cleaning';
import { fmtDateL } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

export default async function CleaningToday({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('cleaning_portal');
  const lang = await getLang();
  const C = cleanDict[lang].today;
  const today = todayOslo();
  const tasks = await tasksForHelper(u as any, today, addDays(today, 14));
  const todays = tasks.filter(t => t.date === today);
  const upcoming = tasks.filter(t => t.date > today && t.status !== 'not_needed');
  // Arrivals today on visible properties (check-ins without a turnover the same day are prep tasks)
  const checkins = tasks.filter(t => t.next_checkin === today);
  const counts = { out: todays.filter(t => t.task_type === 'turnover').length, in: checkins.length };
  return (
    <>
      <span className="eyebrow">{fmtDateL(today, lang, true)}</span>
      <h1>{C.title}</h1>
      <Flash sp={sp} lang={lang} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 16 }}><small>{C.checkout}</small><div className="big-num">{counts.out}</div></div>
        <div className="card" style={{ padding: 16 }}><small>{C.checkin}</small><div className="big-num">{counts.in}</div></div>
      </div>
      {todays.length === 0 ? <Empty>{C.none}</Empty> : todays.map(t => <TaskCard key={t.id} t={t} lang={lang} />)}
      <h2 style={{ marginTop: 28 }}>{C.upcoming}</h2>
      {upcoming.length === 0 ? <Empty>{C.noneUpcoming}</Empty> : upcoming.map(t => (
        <div key={t.id}><small className="muted">{fmtDateL(t.date, lang, true)}</small><TaskCard t={t} lang={lang} /></div>
      ))}
    </>
  );
}
