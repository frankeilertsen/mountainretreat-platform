import { q } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { adapterFor } from '@/lib/channels/sync';
import { guestyAdapter, hostawayAdapter, directApiAdapter } from '@/lib/channels/managers';
import { icalExportAdapter, icalImportAdapter } from '@/lib/channels/ical';
import { Flash, Status } from '@/components/ui';
import { createConnectionAction, syncNowAction, rotateTokenAction, toggleConnectionAction, classifyEventAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kanaler og synk' };
const MODE: Record<string, string> = { ical_import: 'iCal import', ical_export: 'iCal eksport', api: 'Full API', channel_manager: 'Channel manager' };
const STATUS_LABEL: Record<string, [string, string]> = { implemented: ['Implementert og testet', 'b-ok'], requires_credentials: ['Krever konto/nøkler', 'b-warn'], not_implemented: ['Ikke implementert', 'b-danger'] };

export default async function Channels({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  const conns = await q(`SELECT cc.*, p.name AS property,
      (SELECT count(*) FROM external_calendar_events e WHERE e.connection_id=cc.id AND e.sync_state IN ('active','conflict') AND e.end_date >= current_date)::int AS upcoming,
      (SELECT count(*) FROM external_calendar_events e WHERE e.connection_id=cc.id AND e.sync_state='conflict')::int AS conflicts
    FROM channel_connections cc JOIN properties p ON p.id=cc.property_id ${sp.bolig ? 'WHERE cc.property_id=$1' : ''} ORDER BY p.name, cc.integration_mode, cc.display_name`, sp.bolig ? [sp.bolig] : []);
  const runs = await q(`SELECT r.*, cc.display_name, p.name AS property FROM channel_sync_runs r JOIN channel_connections cc ON cc.id=r.connection_id JOIN properties p ON p.id=cc.property_id ORDER BY r.started_at DESC LIMIT 15`);
  const events = await q(`SELECT e.id, e.sync_state, e.block_kind, e.raw_summary, to_char(e.start_date,'YYYY-MM-DD') AS start, to_char(e.end_date,'YYYY-MM-DD') AS "end", cc.display_name, p.name AS property
    FROM external_calendar_events e JOIN channel_connections cc ON cc.id=e.connection_id JOIN properties p ON p.id=e.property_id WHERE e.sync_state IN ('active','conflict','echo') AND e.end_date >= current_date ORDER BY (e.sync_state='conflict') DESC, e.start_date LIMIT 50`);
  const capabilities = [['iCal import', icalImportAdapter], ['iCal eksport', icalExportAdapter], ['Guesty', guestyAdapter], ['Hostaway', hostawayAdapter], ['Direkte API (Airbnb/Booking.com)', directApiAdapter]] as const;
  return (
    <>
      <div className="page-head"><span className="eyebrow">Airbnb · Booking.com · Vrbo · Expedia · egne kanaler</span><h1>Kanaler og synkronisering</h1></div>
      <Flash sp={sp} />
      {sp.ny_eksport && <div className="card" style={{ borderColor: 'var(--gold-line)', marginBottom: 20 }}><h3>Ny eksportlenke</h3><p>Lim denne inn i kanalens kalenderinnstillinger («Importer kalender»). Den vises bare nå.</p><code style={{ wordBreak: 'break-all', display: 'block', background: 'var(--bg)', padding: 12, borderRadius: 8 }}>{sp.ny_eksport}</code></div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Koblinger</h3>
        <div className="table-wrap"><table><thead><tr><th>Bolig</th><th>Kanal</th><th>Type</th><th>Status</th><th>Siste aktivitet</th><th></th></tr></thead><tbody>
          {conns.map(c => {
            const cap = adapterFor(c).capability();
            return (
              <tr key={c.id} style={{ opacity: c.active ? 1 : .5 }}>
                <td>{c.property}</td>
                <td>{c.display_name}{c.upcoming > 0 && <><br /><small>{c.upcoming} kommende</small></>}</td>
                <td><span className="badge">{MODE[c.integration_mode]}</span></td>
                <td>{!c.active ? <span className="badge">Deaktivert</span> : c.conflicts ? <span className="badge b-danger">{c.conflicts} konflikt</span> : c.integration_mode === 'ical_export' ? <span className={`badge ${c.last_fetched_at ? 'b-ok' : 'b-warn'}`}>{c.last_fetched_at ? 'Hentes av kanalen' : 'Ikke hentet ennå'}</span> : cap.status !== 'implemented' ? <span className="badge b-warn">Ikke aktiv</span> : <Status s={c.last_sync_status} />}
                  {c.last_error && <><br /><small style={{ color: 'var(--danger)' }}>{c.last_error} ({c.consecutive_failures}×)</small></>}</td>
                <td><small>{c.integration_mode === 'ical_export' ? (c.last_fetched_at ? `Hentet ${fmtDateTime(c.last_fetched_at)}` : 'Aldri hentet') : (c.last_synced_at ? `Synket ${fmtDateTime(c.last_synced_at)}` : 'Aldri synket')}</small></td>
                <td><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  {c.active && c.integration_mode === 'ical_import' && <form action={syncNowAction}><input type="hidden" name="id" value={c.id} /><button className="btn ghost small">Synk nå</button></form>}
                  {c.integration_mode === 'ical_export' && <form action={rotateTokenAction}><input type="hidden" name="id" value={c.id} /><button className="btn ghost small">Ny lenke</button></form>}
                  <form action={toggleConnectionAction}><input type="hidden" name="id" value={c.id} /><button className="btn ghost small">{c.active ? 'Deaktiver' : 'Aktiver'}</button></form>
                </div></td>
              </tr>);
          })}
        </tbody></table></div>
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>Legg til kobling</h3>
          <form action={createConnectionAction}>
            <div className="field"><label>Bolig</label><select name="propertyId" defaultValue={sp.bolig}>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="fields">
              <div><label>Kanal</label><select name="channel"><option value="airbnb">Airbnb</option><option value="booking_com">Booking.com</option><option value="vrbo">Vrbo</option><option value="expedia">Expedia</option><option value="other">Annen</option></select></div>
              <div><label>Visningsnavn</label><input name="displayName" placeholder="Airbnb" required /></div>
            </div>
            <div className="field" style={{ marginTop: 12 }}><label>Type</label><select name="mode"><option value="ical_import">iCal import – hent kanalens bookinger hit</option><option value="ical_export">iCal eksport – la kanalen hente våre sperringer</option></select></div>
            <div className="field"><label>iCal-lenke fra kanalen (kun import)</label><input name="icalUrl" placeholder="https://www.airbnb.no/calendar/ical/….ics" /></div>
            <button className="btn">Legg til</button>
          </form>
          <p className="muted" style={{ fontSize: '.85rem', marginTop: 14 }}>For toveis synk mot én kanal trengs både en import (deres bookinger → oss) og en eksport (våre bookinger → dem).</p>
        </div>
        <div className="card">
          <h3>Hva hver integrasjon faktisk kan</h3>
          <table><thead><tr><th>Integrasjon</th><th>Status</th><th>Sanntid</th><th>Gjestedata</th></tr></thead><tbody>
            {capabilities.map(([name, a]) => { const c = a.capability(); const [l, cls] = STATUS_LABEL[c.status]; return (
              <tr key={name}><td>{name}<br /><small className="muted">{c.notes}</small></td><td><span className={`badge ${cls}`}>{l}</span></td><td>{c.realTime ? 'Ja' : 'Nei'}</td><td>{c.guestDetails ? 'Ja' : 'Nei'}</td></tr>); })}
          </tbody></table>
          <p className="muted" style={{ fontSize: '.82rem', marginTop: 10 }}><strong>Viktig:</strong> iCal er ikke sanntid. Vi henter kanalenes kalendere med fast intervall (se innstillinger), og kanalene henter vår kalender på egen timeplan – ofte 30 min til flere timer. Admin-godkjenning er derfor siste kontroll før bekreftelse. For sanntid: koble til en channel manager (Guesty/Hostaway).</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>Importerte opphold</h3>
        <div className="table-wrap"><table><thead><tr><th>Kanal</th><th>Bolig</th><th>Datoer</th><th>Status</th><th>Klassifisering</th></tr></thead><tbody>
          {events.map(e => (
            <tr key={e.id}><td>{e.display_name}<br /><small className="muted">{e.raw_summary}</small></td><td>{e.property}</td><td>{fmtDate(e.start)} – {fmtDate(e.end)}</td><td><Status s={e.sync_state === 'active' ? 'success' : e.sync_state} /></td>
              <td><form action={classifyEventAction} className="row" style={{ flexWrap: 'nowrap' }}><input type="hidden" name="id" value={e.id} />
                <select name="kind" defaultValue={e.block_kind} style={{ width: 170 }}><option value="reservation">Reservasjon (vask)</option><option value="owner_block">Stengt/eier (ingen vask)</option><option value="unknown">Ukjent (vask)</option></select><button className="btn ghost small">Lagre</button></form></td></tr>))}
        </tbody></table></div>
      </div>

      <div className="card flat" style={{ marginTop: 20 }}>
        <h3>Siste synkroniseringer</h3>
        <ul className="list">{runs.map(r => <li key={r.id} className="row between"><span><small>{fmtDateTime(r.started_at)}</small> · {r.display_name} <small>({r.property})</small>{r.error && <><br /><small style={{ color: 'var(--danger)' }}>{r.error}</small></>}</span>
          <span><small>+{r.events_added} −{r.events_removed}{r.conflicts ? ` · ${r.conflicts} konflikt` : ''}</small> <Status s={r.status} /></span></li>)}</ul>
      </div>
    </>
  );
}
