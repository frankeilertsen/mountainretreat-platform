'use client';
import { useState } from 'react';

export type SeasonDay = { d: string; color: string | null; price: number | null; label: string | null; past?: boolean };
type Cat = { id: string; name: string; color: string | null };
const MONTHS = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];
const WD = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'];
const ink = (hex: string | null) => { if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined; const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l < 0.55 ? '#fff' : '#1d1b17'; };
const k = (ore: number) => (ore / 100000).toLocaleString('nb-NO', { maximumFractionDigits: 2 });

/** Month grids coloured by season with the nightly price (in thousand kr). Click a first and a last night, then pick a season. */
export function SeasonCalendar({ days, cats, propertyId, action }: { days: SeasonDay[]; cats: Cat[]; propertyId: string; action: (f: FormData) => void }) {
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const lo = a && b ? (a < b ? a : b) : a, hi = a && b ? (a < b ? b : a) : a;
  const pick = (d: string) => { if (!a || b) { setA(d); setB(null); } else setB(d); };
  const months = new Map<string, SeasonDay[]>();
  for (const day of days) { const m = day.d.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m)!.push(day); }
  const fmt = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`;
  return (
    <div>
      <div className="season-bar">
        {!a ? <span className="muted">Trykk på første natt, deretter siste natt i perioden du vil endre.</span>
          : <form action={action} className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="start" value={lo!} /><input type="hidden" name="end" value={hi!} />
              <strong>{b ? `${fmt(lo!)} – ${fmt(hi!)}` : `${fmt(a)} (trykk siste natt, eller velg for én natt)`}:</strong>
              {cats.map(c => <button key={c.id} name="season_category_id" value={c.id} className="btn small season-btn" style={{ background: c.color ?? undefined, color: ink(c.color) }}>{c.name}</button>)}
              <button name="season_category_id" value="" className="btn ghost small">Ingen (stengt)</button>
              <button type="button" className="btn ghost small" onClick={() => { setA(null); setB(null); }}>Avbryt</button>
            </form>}
      </div>
      <div className="season-months">{[...months.entries()].map(([m, list]) => {
        const lead = (new Date(m + '-01T12:00:00Z').getUTCDay() + 6) % 7;
        const priced = list.filter(x => x.price && !x.past);
        const avg = priced.length ? Math.round(priced.reduce((s, x) => s + x.price!, 0) / priced.length / 5000) * 50 : 0;
        return (
          <div key={m} className="season-month">
            <div className="row between"><strong>{MONTHS[Number(m.slice(5)) - 1]} {m.slice(0, 4)}</strong>{avg > 0 && <small className="muted">snitt {avg.toLocaleString('nb-NO')} kr</small>}</div>
            <div className="season-grid">
              {WD.map(w => <small key={w} className="muted">{w}</small>)}
              {Array.from({ length: lead }, (_, i) => <span key={'x' + i} />)}
              {list.map(x => {
                const sel = lo && hi && x.d >= lo && x.d <= hi;
                return <button type="button" key={x.d} title={`${fmt(x.d)}: ${x.label ?? 'Ingen sesong'}`} onClick={() => pick(x.d)} disabled={x.past}
                  className={`season-day${sel ? ' sel' : ''}${x.color || x.past ? '' : ' none'}${x.past ? ' past' : ''}`} style={x.color ? { background: x.color, color: ink(x.color) } : undefined}>
                  <b>{Number(x.d.slice(8))}</b><small>{x.price ? k(x.price) : '–'}</small></button>;
              })}
            </div>
          </div>
        );
      })}</div>
    </div>
  );
}
