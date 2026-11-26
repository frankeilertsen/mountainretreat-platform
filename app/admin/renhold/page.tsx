import Link from 'next/link';
import { q } from '@/lib/db';
import { addDays, fmtDate, fmtDateTime, todayOslo } from '@/lib/format';
import { Flash, Status, Empty } from '@/components/ui';
import { assignTaskAction, resolveReportAction, manualTaskAction , skipTaskAction, reactivateTaskAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Renhold' };

export default async function CleaningAdmin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const today = todayOslo();
  const range = sp.vis === '60' ? '60' : 'alle';
  const tasks = await q(`SELECT t.id, t.task_type, t.status, t.channel_name, to_char(t.checkout_date,'YYYY-MM-DD') AS date, to_char(t.next_checkin_date,'YYYY-MM-DD') AS next_checkin, t.assigned_to_user_id,
      t.completion_notes, t.completed_at, t.not_needed_reason, p.name AS property, p.id AS pid, u.name AS helper, sp.adults + sp.children AS next_guests,
      (SELECT count(*) FROM cleaning_reports r WHERE r.cleaning_task_id=t.id AND r.kind<>'comment')::int AS reports
    FROM cleaning_tasks t JOIN properties p ON p.id=t.property_id LEFT JOIN users u ON u.id=t.assigned_to_user_id LEFT JOIN stay_preparations sp ON sp.id=t.next_preparation_id
    WHERE t.checkout_date BETWEEN $1 AND $2 AND t.status <> 'cancelled' ORDER BY t.checkout_date, p.name`, [addDays(today, -7), addDays(today, range === '60' ? 60 : 550)]);
  const helpers = await q(`SELECT u.id, u.name, array_agg(h.property_id) FILTER (WHERE h.active) AS props FROM users u LEFT JOIN helper_property_assignments h ON h.helper_user_id=u.id WHERE u.system_role='helper' AND u.status='active' GROUP BY u.id ORDER BY u.name`);
  const reports = await q(`SELECT r.*, p.name AS property, u.name AS by, (SELECT array_agg(ph.id) FROM photos ph WHERE ph.entity_type='cleaning_report' AND ph.entity_id=r.id) AS photos
    FROM cleaning_reports r JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=r.created_by_user_id WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC`);
  const props = await q(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  const KIND: Record<string, string> = { damage: 'Skade', missing_item: 'Mangler', issue: 'Avvik', comment: 'Kommentar' };
  return (
    <>
      <div className="page-head row between"><h1>Renhold</h1><Link href="/renhold/kalender" className="btn ghost small">Renholdskalender →</Link></div>
      <Flash sp={sp} />
      {reports.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--clay)', marginBottom: 20 }}>
          <h3>Åpne rapporter</h3>
          <ul className="list">{reports.map(r => (
            <li key={r.id}><div className="row between"><span><span className={`badge ${r.kind === 'damage' ? 'b-danger' : r.kind === 'comment' ? '' : 'b-warn'}`}>{KIND[r.kind]}</span> {r.property} · <small>{r.by}, {fmtDateTime(r.created_at)}</small></span>
              <form action={resolveReportAction}><input type="hidden" name="id" value={r.id} /><button className="btn ghost small">Løst</button></form></div>
              <p style={{ margin: '6px 0' }}>{r.description}</p>
              {r.photos && <div className="row">{r.photos.map((ph: string) => <a key={ph} href={`/api/photos/${ph}`} target="_blank"><img src={`/api/photos/${ph}`} alt="" style={{ width: 90, height: 70, objectFit: 'cover', borderRadius: 6 }} /></a>)}</div>}</li>))}</ul>
        </div>
      )}
      {(() => { const n = tasks.filter(t => t.status === 'open' && !t.assigned_to_user_id && String(t.channel_name ?? '').endsWith('– blokkert')).length;
        return n > 0 ? <div className="card" style={{ borderColor: 'var(--gold-line)', marginBottom: 20 }}><strong>{n} vaskejobb{n > 1 ? 'er' : ''} fra blokkerte dager på Airbnb venter på deg.</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>Blokkerte dager kan være eget opphold eller en booking fra et annet sted, så de sendes ikke automatisk. Tildel en renholder (hun eller han får beskjed med en gang) eller slett jobben.</p></div> : null; })()}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}><h3 style={{ margin: 0 }}>Oppgaver ({range === '60' ? 'siste 7 og neste 60 dager' : 'siste 7 dager og alle kommende'})</h3>
          <span className="row" style={{ gap: 6 }}><Link href="/admin/renhold" className={`btn small ${range === 'alle' ? '' : 'ghost'}`}>Alle kommende</Link><Link href="/admin/renhold?vis=60" className={`btn small ${range === '60' ? '' : 'ghost'}`}>Neste 60 dager</Link></span></div>
        {tasks.length === 0 ? <Empty>Ingen oppgaver.</Empty> : <div className="table-wrap scroll-y"><table><thead><tr><th>Dato</th><th>Bolig</th><th>Type</th><th>Neste ankomst</th><th>Renholder</th><th>Status</th><th></th></tr></thead><tbody>
          {tasks.map(t => {
            const same = t.next_checkin === t.date;
            return (
              <tr key={t.id} style={{ opacity: ['done', 'not_needed'].includes(t.status) ? .6 : 1 }}>
                <td><Link href={`/renhold/oppgaver/${t.id}`}>{fmtDate(t.date, true)}</Link>{same && <><br /><span className="badge b-danger">Samme dag</span></>}</td>
                <td>{t.property}<br /><small className="muted">{t.channel_name}</small></td>
                <td><small>{t.task_type === 'turnover' ? 'Utvask' : 'Klargjøring'}</small>{t.reports > 0 && <> <span className="badge b-warn">{t.reports} rapp.</span></>}</td>
                <td><small>{t.next_checkin ? `${fmtDate(t.next_checkin)}${t.next_guests ? ` · ${t.next_guests} gjester` : ''}` : '–'}</small></td>
                <td>{['done', 'not_needed'].includes(t.status) ? <small>{t.helper ?? '–'}</small> : (
                  <form action={assignTaskAction} className="row" style={{ flexWrap: 'nowrap' }}><input type="hidden" name="id" value={t.id} />
                    <select name="helperId" defaultValue={t.assigned_to_user_id ?? ''} style={{ width: 150 }}><option value="">Ikke tildelt</option>{helpers.map(h => <option key={h.id} value={h.id}>{h.name}{h.props?.includes(t.pid) ? '' : ' (annen bolig)'}</option>)}</select>
                    <button className="btn ghost small">Tildel</button></form>)}
                  {t.completion_notes && <small className="muted">«{t.completion_notes}»</small>}</td>
                <td><Status s={t.status} />{t.status === 'not_needed' && t.not_needed_reason && <><br /><small className="muted">{t.not_needed_reason}</small></>}</td>
                <td>{['open', 'assigned'].includes(t.status) ? (
                  <form action={skipTaskAction} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}><input type="hidden" name="id" value={t.id} />
                    <input name="reason" placeholder="Vasker selv" style={{ width: 120 }} aria-label="Grunn" />
                    <button className="btn ghost small" title="Slett denne vaskejobben – renholderen får beskjed">Slett</button></form>
                ) : t.status === 'not_needed' ? (
                  <form action={reactivateTaskAction}><input type="hidden" name="id" value={t.id} /><button className="btn ghost small">Slå på igjen</button></form>
                ) : null}</td>
              </tr>);
          })}
        </tbody></table></div>}
      </div>
      <form action={manualTaskAction} className="card flat" style={{ marginTop: 20 }}>
        <h3>Ekstra oppgave</h3>
        <div className="fields"><div><label>Bolig</label><select name="propertyId">{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div><label>Dato</label><input type="date" name="date" required /></div>
          <div><label>Renholder</label><select name="helperId"><option value="">–</option>{helpers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div></div>
        <div className="field" style={{ marginTop: 12 }}><label>Instruks</label><input name="notes" placeholder="Hovedrengjøring, vindusvask …" /></div><button className="btn small">Opprett</button>
      </form>
    </>
  );
}
