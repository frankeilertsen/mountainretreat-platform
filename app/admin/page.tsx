import Link from 'next/link';
import { q, one } from '@/lib/db';
import { addDays, fmtDate, fmtDateTime, nok, todayOslo } from '@/lib/format';
import { Flash, Status, Empty } from '@/components/ui';
import { approveAction, loyaltyDecisionAction } from '../actions/admin';
import { BarChart, Ring } from '@/components/charts';
const MN = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin' };

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const today = todayOslo(), in30 = addDays(today, 30);
  const [pending, cancels, loyalty, arrivals, kpi, occ, syncs, cleaning] = await Promise.all([
    q(`SELECT b.id, b.reference, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.adults+b.children AS guests, b.price_total_ore, b.requested_at, u.name AS member, p.name AS property, b.special_requests,
       EXISTS (SELECT 1 FROM availability_blocks ab WHERE ab.property_id=b.property_id AND ab.date_range && daterange(b.start_date,b.end_date)) AS conflict
       FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id WHERE b.status='pending_review' ORDER BY b.requested_at`),
    q(`SELECT b.id, b.reference, u.name AS member, p.name AS property, b.cancellation_requested_at FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id WHERE b.status='cancellation_requested' ORDER BY b.cancellation_requested_at`),
    q(`SELECT la.id, u.name, u.email, la.created_at, iu.name AS inviter FROM loyalty_applications la JOIN users u ON u.id=la.applicant_user_id LEFT JOIN users iu ON iu.id=u.invited_by_user_id WHERE la.status='pending' ORDER BY la.created_at`),
    q(`SELECT * FROM (
         SELECT 'booking' AS kind, b.id, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", p.name AS property, u.name AS who, b.status, 'mountainretreat.no' AS channel FROM bookings b JOIN properties p ON p.id=b.property_id JOIN users u ON u.id=b.member_id WHERE b.status IN ('confirmed','awaiting_payment') AND b.start_date BETWEEN $1 AND $2
         UNION ALL SELECT 'external', e.id, to_char(e.start_date,'YYYY-MM-DD'), to_char(e.end_date,'YYYY-MM-DD'), p.name, '–', e.sync_state, cc.display_name FROM external_calendar_events e JOIN properties p ON p.id=e.property_id JOIN channel_connections cc ON cc.id=e.connection_id WHERE e.sync_state IN ('active','conflict') AND e.block_kind <> 'owner_block' AND e.start_date BETWEEN $1 AND $2
       ) x ORDER BY start LIMIT 12`, [today, in30]),
    one(`SELECT (SELECT count(*) FROM bookings WHERE status='awaiting_payment')::int AS awaiting,
                (SELECT count(*) FROM bookings WHERE status='confirmed' AND start_date >= current_date)::int AS confirmed,
                (SELECT count(*) FROM users WHERE system_role='member' AND status='active')::int AS members,
                (SELECT COALESCE(sum(amount_ore - refunded_amount_ore),0) FROM payments WHERE status IN ('succeeded','partially_refunded') AND created_at >= date_trunc('year', now()))::bigint AS revenue`),
    q(`SELECT p.name, (SELECT COALESCE(sum(upper(ab.date_range * daterange($1::date,$2::date)) - lower(ab.date_range * daterange($1::date,$2::date))),0) FROM availability_blocks ab WHERE ab.property_id=p.id AND ab.date_range && daterange($1::date,$2::date) AND ab.block_type <> 'manual_admin')::int AS nights
       FROM properties p WHERE p.active ORDER BY p.name`, [today, in30]),
    q(`SELECT cc.id, cc.display_name, cc.integration_mode, cc.last_sync_status, cc.last_synced_at, cc.last_fetched_at, cc.consecutive_failures, p.name AS property,
        (SELECT count(*) FROM external_calendar_events e WHERE e.connection_id=cc.id AND e.sync_state='conflict')::int AS conflicts
       FROM channel_connections cc JOIN properties p ON p.id=cc.property_id WHERE cc.active ORDER BY p.name, cc.display_name`),
    q(`SELECT t.status, count(*)::int AS n FROM cleaning_tasks t WHERE t.checkout_date BETWEEN current_date AND current_date + 7 GROUP BY t.status`),
  ]);
  const months = await q(`SELECT to_char(m,'YYYY-MM') AS month,
      COALESCE(sum(CASE WHEN ab.block_type='platform_booking' THEN upper(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) - lower(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) END),0)::int AS own,
      COALESCE(sum(CASE WHEN ab.block_type='external_sync' THEN upper(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) - lower(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) END),0)::int AS ext
    FROM generate_series(date_trunc('month', now()), date_trunc('month', now()) + interval '5 months', interval '1 month') m
    LEFT JOIN availability_blocks ab ON ab.date_range && daterange(m::date,(m+interval '1 month')::date) GROUP BY m ORDER BY m`);
  const revenue = await q(`SELECT to_char(m,'YYYY-MM') AS month, COALESCE(sum(p.amount_ore - p.refunded_amount_ore),0)::bigint AS amount
    FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
    LEFT JOIN payments p ON date_trunc('month', p.created_at) = m AND p.status IN ('succeeded','partially_refunded','refunded') GROUP BY m ORDER BY m`);
  const queueEmpty = !pending.length && !cancels.length && !loyalty.length;
  return (
    <>
      <div className="page-head"><span className="eyebrow">{fmtDate(today, true)}</span><h1>Oversikt</h1></div>
      <Flash sp={sp} />
      <div className="grid g4" style={{ marginBottom: 24 }}>
        <div className="card kpi-card"><span className="kpi-label">Venter godkjenning</span><div className="kpi">{pending.length}</div><small>forespørsler i kø</small></div>
        <div className="card kpi-card"><span className="kpi-label">Venter betaling</span><div className="kpi">{kpi.awaiting}</div><small>datoer holdt av</small></div>
        <div className="card kpi-card"><span className="kpi-label">Kommende opphold</span><div className="kpi">{kpi.confirmed}</div><small>bekreftet</small></div>
        <div className="card kpi-card"><span className="kpi-label">Innbetalt i år</span><div className="kpi" style={{ color: 'var(--gold-2)' }}>{nok(Number(kpi.revenue))}</div><small>{kpi.members} aktive medlemmer</small></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', marginBottom: 24 }}>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Belegg neste 6 måneder</h3><div className="legend"><span><i style={{ background: 'var(--gold)' }} />Retreat Club</span><span><i style={{ background: '#6f8a9b' }} />Eksterne kanaler</span></div></div>
          <small className="muted">Netter, alle boliger</small>
          <BarChart data={months.map(m => ({ label: MN[Number(m.month.slice(5)) - 1], value: m.own, value2: m.ext }))} />
        </div>
        <div className="card">
          <h3 style={{ margin: 0 }}>Belegg neste 30 dager</h3><small className="muted">Per bolig, eksl. manuelle sperringer</small>
          <div className="row" style={{ justifyContent: 'space-around', marginTop: 14 }}>
            {occ.map(o => <div key={o.name} style={{ textAlign: 'center' }}><Ring value={o.nights / 30} label={`${Math.round(o.nights / 30 * 100)}%`} sub={`${o.nights} NETTER`} /><div style={{ fontSize: '.82rem', color: 'var(--ink-2)', maxWidth: 150 }}>{o.name}</div></div>)}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Godkjenningskø</h2>
        {queueEmpty ? <Empty>Ingenting venter. 🌿</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Type</th><th>Hvem</th><th>Detaljer</th><th>Mottatt</th><th></th></tr></thead><tbody>
            {pending.map(b => (
              <tr key={b.id}><td><span className="badge b-warn">Booking</span></td><td>{b.member}</td>
                <td><Link href={`/admin/bookinger/${b.id}`}>{b.property}</Link><br /><small>{fmtDate(b.start)} – {fmtDate(b.end)} · {b.guests} gjester · {nok(b.price_total_ore)}</small>
                  {b.conflict && <><br /><span className="badge b-danger">Datoene er opptatt</span></>}{b.special_requests && <><br /><small className="muted">«{b.special_requests}»</small></>}</td>
                <td><small>{fmtDateTime(b.requested_at)}</small></td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                  {!b.conflict && <form action={approveAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="back" value="/admin" /><button className="btn ok small">Godkjenn</button></form>}
                  <Link className="btn ghost small" href={`/admin/bookinger/${b.id}`}>Åpne</Link></div></td></tr>))}
            {cancels.map(b => (
              <tr key={b.id}><td><span className="badge b-clay">Kansellering</span></td><td>{b.member}</td><td>{b.property} <small>{b.reference}</small></td><td><small>{fmtDateTime(b.cancellation_requested_at)}</small></td>
                <td style={{ textAlign: 'right' }}><Link className="btn ghost small" href={`/admin/bookinger/${b.id}`}>Behandle</Link></td></tr>))}
            {loyalty.map(l => (
              <tr key={l.id}><td><span className="badge b-info">Invitasjonsrett</span></td><td>{l.name}</td><td><small>{l.email} · invitert av {l.inviter ?? '–'}</small></td><td><small>{fmtDateTime(l.created_at)}</small></td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                  <form action={loyaltyDecisionAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="decision" value="approve" /><button className="btn ok small">Godkjenn</button></form>
                  <form action={loyaltyDecisionAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="decision" value="reject" /><button className="btn ghost small">Avslå</button></form></div></td></tr>))}
          </tbody></table></div>
        )}
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row between"><h3>Ankomster neste 30 dager</h3><Link href="/admin/kalender" className="muted">Kalender →</Link></div>
          {arrivals.length === 0 ? <Empty>Ingen ankomster.</Empty> : <ul className="list">{arrivals.map(a => (
            <li key={a.kind + a.id} className="row between"><span>{fmtDate(a.start, true)} · {a.property}<br /><small>{a.channel} · {a.who} · {Math.round((Date.parse(a.end) - Date.parse(a.start)) / 864e5)} netter</small></span><Status s={a.status === 'active' ? 'confirmed' : a.status} /></li>))}</ul>}
        </div>
        <div className="stack">
          <div className="card">
            <h3 style={{ margin: 0 }}>Innbetalt siste 6 måneder</h3><small className="muted">Netto etter refusjoner</small>
            <BarChart money height={170} data={revenue.map(r => ({ label: MN[Number(r.month.slice(5)) - 1], value: Number(r.amount) }))} />
          </div>
          <div className="card">
            <div className="row between"><h3>Kalendersynk</h3><Link href="/admin/kanaler" className="muted">Detaljer →</Link></div>
            <ul className="list">{syncs.map(s => (
              <li key={s.id} className="row between"><span>{s.display_name} <small>· {s.property}</small><br /><small className="muted">{s.integration_mode === 'ical_export' ? `Hentet av kanalen: ${s.last_fetched_at ? fmtDateTime(s.last_fetched_at) : 'aldri'}` : `Sist synket: ${s.last_synced_at ? fmtDateTime(s.last_synced_at) : 'aldri'}`}</small></span>
                {s.conflicts ? <span className="badge b-danger">{s.conflicts} konflikt</span> : s.integration_mode === 'ical_export' ? <span className={`badge ${s.last_fetched_at ? 'b-ok' : 'b-warn'}`}>{s.last_fetched_at ? 'Hentes' : 'Ikke hentet'}</span> : <Status s={s.last_sync_status} />}</li>))}</ul>
          </div>
          <div className="card">
            <div className="row between"><h3>Renhold neste 7 dager</h3><Link href="/admin/renhold" className="muted">Renhold →</Link></div>
            <div className="row">{cleaning.length === 0 ? <Empty>Ingen oppgaver.</Empty> : cleaning.map(c => <span key={c.status} className="row" style={{ gap: 6 }}><Status s={c.status} /> {c.n}</span>)}</div>
          </div>
        </div>
      </div>
    </>
  );
}
