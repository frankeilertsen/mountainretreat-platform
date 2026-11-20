import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { tasksForHelper } from '@/lib/domain/cleaning';
import { addDays, fmtDate, isoWeekday, todayOslo } from '@/lib/format';
import { TaskCard } from '@/components/TaskCard';
import { Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
const MONTHS = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];

export default async function CleaningCalendar({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('cleaning_portal');
  const view = sp.visning === 'maaned' ? 'maaned' : sp.visning === 'dag' ? 'dag' : 'uke';
  const today = todayOslo();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.dato ?? '') ? sp.dato! : today;
  let from: string, to: string;
  if (view === 'dag') { from = anchor; to = anchor; }
  else if (view === 'uke') { from = addDays(anchor, 1 - isoWeekday(anchor)); to = addDays(from, 6); }
  else { from = anchor.slice(0, 8) + '01'; const d = new Date(from + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); to = addDays(d.toISOString().slice(0, 10), -1); }
  const step = view === 'dag' ? 1 : view === 'uke' ? 7 : 31;
  const tasks = await tasksForHelper(u as any, from, to);
  const prev = view === 'maaned' ? addDays(from, -1).slice(0, 8) + '01' : addDays(from, -step);
  const next = view === 'maaned' ? addDays(to, 1) : addDays(from, step);
  const title = view === 'maaned' ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : view === 'uke' ? `Uke ${weekNo(from)}` : fmtDate(from, true);

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <Link className="btn ghost small" href={`?visning=${view}&dato=${prev}`}>←</Link>
        <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{title}</h2>
        <Link className="btn ghost small" href={`?visning=${view}&dato=${next}`}>→</Link>
      </div>
      <div className="nav" style={{ marginBottom: 16, justifyContent: 'center' }}>
        {[['dag', 'Dag'], ['uke', 'Uke'], ['maaned', 'Måned']].map(([k, l]) => <Link key={k} href={`?visning=${k}&dato=${anchor}`} className={view === k ? 'active' : ''}>{l}</Link>)}
      </div>
      {view === 'maaned' ? <MonthGrid from={from} to={to} tasks={tasks} today={today} /> : (
        Array.from({ length: view === 'dag' ? 1 : 7 }, (_, i) => addDays(from, i)).map(d => {
          const dt = tasks.filter(t => t.date === d);
          return (
            <div key={d} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: '1rem', color: d === today ? 'var(--gold-2)' : undefined }}>{fmtDate(d, true)}</h3>
              {dt.length === 0 ? <small className="muted">Ingen oppgaver</small> : dt.map(t => <TaskCard key={t.id} t={t} />)}
            </div>
          );
        })
      )}
    </>
  );
}

function MonthGrid({ from, to, tasks, today }: { from: string; to: string; tasks: any[]; today: string }) {
  const offset = isoWeekday(from) - 1;
  const days: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="cal">
      {['Ma','Ti','On','To','Fr','Lø','Sø'].map(d => <div key={d} className="dow">{d}</div>)}
      {Array.from({ length: offset }, (_, i) => <div key={'o' + i} className="day out" />)}
      {days.map(d => {
        const dt = tasks.filter(t => t.date === d && t.status !== 'not_needed');
        const urgent = dt.some(t => t.same_day && t.status !== 'done');
        return (
          <Link key={d} href={`?visning=dag&dato=${d}`} className={`day ${dt.length ? (urgent ? 'urgent' : 'has') : ''} ${d === today ? 'today' : ''}`} style={{ textDecoration: 'none' }}>
            {Number(d.slice(8))}{dt.length > 0 && <small>{dt.length} jobb</small>}
          </Link>
        );
      })}
      {days.length === 0 && <Empty>–</Empty>}
    </div>
  );
}

function weekNo(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - y.getTime()) / 86400000 + 1) / 7);
}
