import { addDays, todayOslo } from '@/lib/format';

type Block = { start: string; end: string };
const MONTHS = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];

/** Read-only availability: a night is busy if any block covers [date, date+1). Shows nothing about who/why. */
export function MonthCalendar({ blocks, months = 3, from, selStart, selEnd }: { blocks: Block[]; months?: number; from?: string; selStart?: string; selEnd?: string }) {
  const today = todayOslo();
  const first = (from ?? today).slice(0, 8) + '01';
  const busy = (d: string) => blocks.some(b => b.start <= d && b.end > d);
  const out = [];
  for (let m = 0; m < months; m++) {
    const start = new Date(first + 'T12:00:00Z'); start.setUTCMonth(start.getUTCMonth() + m);
    const y = start.getUTCFullYear(), mo = start.getUTCMonth();
    const firstIso = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    const offset = (new Date(firstIso + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(<div key={'o' + i} className="day out" />);
    for (let dd = 1; dd <= days; dd++) {
      const iso = addDays(firstIso, dd - 1);
      const sel = selStart && selEnd && iso >= selStart && iso < selEnd;
      const cls = ['day', iso < today ? 'past' : '', busy(iso) ? 'busy' : '', sel ? 'sel' : ''].join(' ');
      cells.push(<div key={iso} className={cls} title={busy(iso) ? 'Opptatt' : 'Ledig'}>{dd}</div>);
    }
    out.push(
      <div key={firstIso} className="cal-month">
        <h4>{MONTHS[mo]} {y}</h4>
        <div className="cal">{['Ma','Ti','On','To','Fr','Lø','Sø'].map(d => <div key={d} className="dow">{d}</div>)}{cells}</div>
      </div>
    );
  }
  return <div className="grid g3">{out}</div>;
}
