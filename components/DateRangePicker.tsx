'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/** One night (the night starting on date d). busy = taken, ok = bookable (has a price), min = minimum nights when checking in that day. */
export type PickerNight = { d: string; busy: boolean; ok: boolean; min: number; color: string | null; season: string | null };

const L = {
  no: { months: ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'], wd: ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'],
    choose: 'Velg datoer', pickIn: 'Velg innsjekk', pickOut: 'Velg utsjekk', nights: (n: number) => `${n} ${n === 1 ? 'natt' : 'netter'}`, min: (n: number, s: string | null) => `Min. ${n} netter${s ? ` (${s})` : ''}`,
    busy: 'Opptatt', clear: 'Nullstill', close: 'Ferdig', checkIn: 'Innsjekk', checkOut: 'Utsjekk', prev: 'Forrige måned', next: 'Neste måned', changeover: 'Utsjekk mulig' },
  en: { months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], wd: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    choose: 'Choose dates', pickIn: 'Choose check-in', pickOut: 'Choose check-out', nights: (n: number) => `${n} night${n === 1 ? '' : 's'}`, min: (n: number, s: string | null) => `Min. ${n} nights${s ? ` (${s})` : ''}`,
    busy: 'Booked', clear: 'Clear', close: 'Done', checkIn: 'Check-in', checkOut: 'Check-out', prev: 'Previous month', next: 'Next month', changeover: 'Check-out possible' },
};

const addDays = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

export function DateRangePicker({ nights, start, end, lang = 'no', today }: { nights: PickerNight[]; start?: string; end?: string; lang?: 'no' | 'en'; today: string }) {
  const T = L[lang];
  const map = useMemo(() => new Map(nights.map(n => [n.d, n])), [nights]);
  const [s, setS] = useState<string | null>(start ?? null);
  const [e, setE] = useState<string | null>(end ?? null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const months = useMemo(() => [...new Set(nights.map(n => n.d.slice(0, 7)))], [nights]);
  const [page, setPage] = useState(() => Math.max(0, months.indexOf((start ?? today).slice(0, 7))));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const canStart = (d: string) => { const n = map.get(d); return !!n && d >= today && !n.busy && n.ok; };
  /** check-out on d after check-in a: every night a..d-1 free and bookable, and long enough */
  const canEnd = (a: string, d: string) => {
    if (d <= a) return false;
    for (let x = a; x < d; x = addDays(x, 1)) { const n = map.get(x); if (!n || n.busy || !n.ok) return false; }
    return diff(a, d) >= (map.get(a)?.min ?? 1);
  };
  const choosingEnd = !!s && !e;
  const click = (d: string) => {
    if (choosingEnd && canEnd(s!, d)) { setE(d); setOpen(false); return; }
    if (canStart(d)) { setS(d); setE(null); }
  };
  const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'en' ? 'en-GB' : 'nb-NO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const startInfo = s ? map.get(s) : null;
  const rangeEnd = e ?? (choosingEnd && hover && canEnd(s!, hover) ? hover : null);

  const Month = ({ m }: { m: string }) => {
    const [y, mo] = m.split('-').map(Number);
    const first = `${m}-01`, lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return (
      <div className="drp-month">
        <div className="drp-title">{T.months[mo - 1]} {y}</div>
        <div className="drp-grid">
          {T.wd.map(w => <span key={w} className="drp-wd">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={'x' + i} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = `${m}-${String(i + 1).padStart(2, '0')}`;
            const n = map.get(d);
            const past = d < today;
            const selectable = choosingEnd ? (canEnd(s!, d) || canStart(d)) : canStart(d);
            const isEndOption = choosingEnd && canEnd(s!, d);
            const inRange = s && rangeEnd && d > s && d < rangeEnd;
            const cls = ['drp-day', past ? 'past' : '', n?.busy && !isEndOption ? 'busy' : '', !n?.ok && !n?.busy && !past && !isEndOption ? 'closed' : '',
              d === s ? 'sel-start' : '', d === rangeEnd ? 'sel-end' : '', inRange ? 'in-range' : '', !selectable ? 'off' : ''].filter(Boolean).join(' ');
            return (
              <button type="button" key={d} className={cls} disabled={!selectable} onClick={() => click(d)} onMouseEnter={() => setHover(d)}
                title={n?.busy ? (isEndOption ? T.changeover : T.busy) : n?.season ?? ''} aria-pressed={d === s || d === e}>
                <span>{i + 1}</span>{n?.color && !past && <i style={{ background: n.color }} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="drp" ref={box}>
      <input type="hidden" name="fra" value={s && e ? s : ''} /><input type="hidden" name="til" value={s && e ? e : ''} />
      <button type="button" className="drp-trigger" onClick={() => { setOpen(o => !o); if (s) setPage(Math.max(0, months.indexOf(s.slice(0, 7)))); }} aria-expanded={open}>
        <span className="drp-field"><small>{T.checkIn}</small><strong>{s ? fmt(s) : '—'}</strong></span>
        <span className="drp-field"><small>{T.checkOut}</small><strong>{e ? fmt(e) : '—'}</strong></span>
        {s && e && <span className="drp-nights">{T.nights(diff(s, e))}</span>}
      </button>
      {open && (
        <div className="drp-pop" role="dialog">
          <div className="drp-head">
            <button type="button" className="drp-nav" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} aria-label={T.prev}>‹</button>
            <strong>{choosingEnd ? T.pickOut : T.pickIn}{choosingEnd && startInfo ? <small className="muted"> · {T.min(startInfo.min, startInfo.season)}</small> : null}</strong>
            <button type="button" className="drp-nav" onClick={() => setPage(p => Math.min(months.length - 1, p + 1))} disabled={page >= months.length - 1} aria-label={T.next}>›</button>
          </div>
          <div className="drp-months">
            <Month m={months[page]} />
            {months[page + 1] && <div className="drp-second"><Month m={months[page + 1]} /></div>}
          </div>
          <div className="drp-foot">
            <span className="drp-legend"><i className="lg-busy" /> {T.busy}</span>
            <span className="row" style={{ gap: 8 }}>
              {(s || e) && <button type="button" className="btn ghost small" onClick={() => { setS(null); setE(null); }}>{T.clear}</button>}
              <button type="button" className="btn small" onClick={() => setOpen(false)}>{T.close}</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
