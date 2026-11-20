import Link from 'next/link';
import { q } from '@/lib/db';
import { addDays, fmtDate, isoWeekday, todayOslo } from '@/lib/format';
import { Flash } from '@/components/ui';
import { manualBlockAction, removeBlockAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kalender' };

/** Central availability overview: every property × every day, all channels in one place. */
export default async function CentralCalendar({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const today = todayOslo();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.fra ?? '') ? sp.fra! : addDays(today, -3);
  const days = 42;
  const to = addDays(from, days);
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  const blocks = await q(`SELECT ab.id, ab.property_id, ab.block_type, to_char(lower(ab.date_range),'YYYY-MM-DD') AS start, to_char(upper(ab.date_range),'YYYY-MM-DD') AS "end", ab.reference_id, ab.reason,
      cc.display_name AS channel, b.status AS booking_status, b.reference, u.name AS member
    FROM availability_blocks ab LEFT JOIN channel_connections cc ON cc.id=ab.source_connection_id
    LEFT JOIN bookings b ON ab.block_type='platform_booking' AND b.id=ab.reference_id LEFT JOIN users u ON u.id=b.member_id
    WHERE ab.date_range && daterange($1::date,$2::date) ORDER BY lower(ab.date_range)`, [from, to]);
  const conflicts = await q(`SELECT e.property_id, to_char(e.start_date,'YYYY-MM-DD') AS start, to_char(e.end_date,'YYYY-MM-DD') AS "end", cc.display_name FROM external_calendar_events e JOIN channel_connections cc ON cc.id=e.connection_id WHERE e.sync_state='conflict' AND daterange(e.start_date,e.end_date) && daterange($1::date,$2::date)`, [from, to]);
  const pending = await q(`SELECT b.property_id, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.id, u.name FROM bookings b JOIN users u ON u.id=b.member_id WHERE b.status='pending_review' AND daterange(b.start_date,b.end_date) && daterange($1::date,$2::date)`, [from, to]);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const manual = blocks.filter(b => b.block_type === 'manual_admin' && b.end >= today);

  const labelFor = (b: any) => b.block_type === 'platform_booking' ? `${b.member ?? ''}` : b.block_type === 'external_sync' ? (b.channel ?? 'Ekstern') : (b.reason ?? 'Sperret');
  const clsFor = (b: any) => b.block_type === 'platform_booking' ? (b.booking_status === 'awaiting_payment' ? 'blk-hold' : 'blk-platform_booking') : `blk-${b.block_type}`;
  return (
    <>
      <div className="page-head row between">
        <div><span className="eyebrow">Alle boliger · alle kanaler</span><h1>Sentral kalender</h1></div>
        <div className="row">
          <Link className="btn ghost small" href={`/admin/kalender?fra=${addDays(from, -28)}`}>←</Link>
          <Link className="btn ghost small" href="/admin/kalender">I dag</Link>
          <Link className="btn ghost small" href={`/admin/kalender?fra=${addDays(from, 28)}`}>→</Link>
        </div>
      </div>
      <Flash sp={sp} />
      <div className="legend" style={{ marginBottom: 12 }}>
        <span><i style={{ background: 'var(--gold)' }} />Bekreftet (Mountain Retreat)</span><span><i style={{ background: '#8a7448' }} />Venter betaling</span>
        <span><i style={{ background: '#6f8a9b' }} />Ekstern kanal</span><span><i style={{ background: '#4a4740' }} />Manuell sperring</span><span><i style={{ background: 'var(--danger)' }} />Konflikt</span>
        <span><i style={{ background: 'transparent', border: '1px dashed var(--gold)' }} />Forespørsel (holder ikke datoer)</span>
      </div>
      <div className="mcal">
        <table>
          <thead><tr><th className="prop">Bolig</th>{dates.map(d => <th key={d} className={`${isoWeekday(d) >= 6 ? 'wknd' : ''} ${d === today ? 'today' : ''}`} style={{ fontWeight: 400 }}><small>{['', 'ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'][isoWeekday(d)]}</small><br />{Number(d.slice(8))}</th>)}</tr></thead>
          <tbody>
            {props.map(p => {
              const pb = blocks.filter(b => b.property_id === p.id);
              const pc = conflicts.filter(c => c.property_id === p.id);
              const pp = pending.filter(x => x.property_id === p.id);
              return (
                <tr key={p.id}>
                  <td className="prop"><Link href={`/admin/boliger/${p.id}`}>{p.name}</Link></td>
                  {dates.map(d => {
                    const b = pb.find(x => x.start <= d && x.end > d);
                    const c = pc.find(x => x.start <= d && x.end > d);
                    const pr = !b && pp.find(x => x.start <= d && x.end > d);
                    const cls = `${isoWeekday(d) >= 6 ? 'wknd' : ''} ${d === today ? 'today' : ''}`;
                    if (c) return <td key={d} className={cls} title={`KONFLIKT: ${c.display_name}`}><span className="blk blk-conflict">!</span></td>;
                    if (b) {
                      const first = b.start === d || d === from, last = addDays(d, 1) === b.end;
                      const inner = <span className={`blk ${clsFor(b)} ${first ? 'start' : ''} ${last ? 'end' : ''}`} title={`${labelFor(b)} ${fmtDate(b.start)}–${fmtDate(b.end)}`}>{first ? <span className="lbl">{labelFor(b)}</span> : '\u00a0'}</span>;
                      return <td key={d} className={cls}>{b.block_type === 'platform_booking' ? <Link href={`/admin/bookinger/${b.reference_id}`}>{inner}</Link> : inner}</td>;
                    }
                    if (pr) return <td key={d} className={cls}><Link href={`/admin/bookinger/${pr.id}`} title={`Forespørsel: ${pr.name}`} style={{ display: 'block', height: 26, margin: '0 1px', border: '1px dashed var(--gold)', borderRadius: 6 }} /></td>;
                    return <td key={d} className={cls} />;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid g2" style={{ marginTop: 28, alignItems: 'start' }}>
        <div className="card">
          <h3>Sperr datoer manuelt</h3>
          <p className="muted" style={{ fontSize: '.88rem' }}>Sperringen gjelder umiddelbart her og sendes til alle tilkoblede kanaler via eksportfeedene (kanalene henter på egen timeplan).</p>
          <form action={manualBlockAction}>
            <div className="field"><label>Bolig</label><select name="propertyId">{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="fields"><div><label>Fra (første natt)</label><input type="date" name="start" required /></div><div><label>Til (utsjekk)</label><input type="date" name="end" required /></div></div>
            <div className="field" style={{ marginTop: 12 }}><label>Grunn</label><input name="reason" required placeholder="Eiers bruk, vedlikehold …" /></div>
            <button className="btn">Sperr</button>
          </form>
        </div>
        <div className="card">
          <h3>Aktive manuelle sperringer</h3>
          <ul className="list">{manual.map(m => <li key={m.id} className="row between"><span>{props.find(p => p.id === m.property_id)?.name}<br /><small>{fmtDate(m.start)} – {fmtDate(m.end)} · {m.reason}</small></span>
            <form action={removeBlockAction}><input type="hidden" name="id" value={m.id} /><button className="btn ghost small">Fjern</button></form></li>)}</ul>
          {manual.length === 0 && <p className="muted">Ingen i denne perioden.</p>}
        </div>
      </div>
    </>
  );
}
