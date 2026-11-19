import { Db, getPool, isPgError, one, PG_EXCLUSION_VIOLATION, q, tx } from '../db';
import { audit, Actor, SYSTEM } from '../audit';
import { notifyAdmins } from '../notify';
import { getNum } from '../settings';
import { hashToken, randomToken } from '../crypto';
import { DomainError } from '../errors';
import { ChannelAdapter, ExternalEvent } from './types';
import { buildIcal, icalExportAdapter, icalImportAdapter } from './ical';
import { directApiAdapter, guestyAdapter, hostawayAdapter } from './managers';
import { reconcileCleaningTasks } from '../domain/cleaning';
import { todayOslo, fmtDate } from '../format';

export function adapterFor(conn: { integration_mode: string; channel: string }): ChannelAdapter {
  if (conn.integration_mode === 'ical_import') return icalImportAdapter;
  if (conn.integration_mode === 'ical_export') return icalExportAdapter;
  if (conn.integration_mode === 'channel_manager') return conn.channel === 'hostaway' ? hostawayAdapter : guestyAdapter;
  return directApiAdapter;
}

type Conn = { id: string; property_id: string; channel: string; display_name: string; integration_mode: string; ical_url: string | null; config: any };

/**
 * Applies a full snapshot of a channel's events. Never called with partial data: a fetch/parse error aborts before this.
 * - new/changed events → external_calendar_events + availability block
 * - events missing from the snapshot → removed (block deleted) = cancellation on the channel
 * - overlap with an identical existing block = echo of our own export via another channel → kept as 'echo', no block
 * - overlap with a different block = REAL double booking risk → 'conflict' + admin alert
 */
export async function applySnapshot(conn: Conn, events: ExternalEvent[], db?: Db) {
  return tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['avail:' + conn.property_id]);
    const today = todayOslo();
    const relevant = events.filter(e => e.end > today);
    const existing = await q<{ id: string; uid: string; start: string; end: string; sync_state: string }>(
      `SELECT id, uid, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", sync_state
       FROM external_calendar_events WHERE connection_id=$1 AND sync_state <> 'removed'`, [conn.id], c);
    const byUid = new Map(existing.map(e => [e.uid, e]));
    let added = 0, removed = 0, conflicts = 0;
    const conflictMsgs: string[] = [];

    const removeEvent = async (id: string) => {
      await c.query(`DELETE FROM availability_blocks WHERE block_type='external_sync' AND reference_id=$1`, [id]);
      await c.query(`UPDATE external_calendar_events SET sync_state='removed', removed_at=now() WHERE id=$1`, [id]);
    };

    for (const ev of relevant) {
      const ex = byUid.get(ev.uid);
      byUid.delete(ev.uid);
      if (ex && ex.start === ev.start && ex.end === ev.end) {
        await c.query('UPDATE external_calendar_events SET last_seen_at=now() WHERE id=$1', [ex.id]);
        if (ex.sync_state === 'active') continue; // unchanged; echo/conflict get re-evaluated below
      }
      let eventId: string;
      if (ex) {
        await c.query(`DELETE FROM availability_blocks WHERE block_type='external_sync' AND reference_id=$1`, [ex.id]);
        await c.query(`UPDATE external_calendar_events SET start_date=$2, end_date=$3, raw_summary=$4, last_seen_at=now(), sync_state='active' WHERE id=$1`, [ex.id, ev.start, ev.end, ev.summary]);
        eventId = ex.id;
      } else {
        const kind = /not available|blocked|closed/i.test(ev.summary ?? '') ? 'unknown' : /reserved|reservation|booking|airbnb/i.test(ev.summary ?? '') ? 'reservation' : 'unknown';
        const r = await one<{ id: string }>(
          `INSERT INTO external_calendar_events (property_id, connection_id, uid, start_date, end_date, raw_summary, block_kind) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (connection_id, uid) DO UPDATE SET start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, sync_state='active', removed_at=NULL, last_seen_at=now() RETURNING id`,
          [conn.property_id, conn.id, ev.uid, ev.start, ev.end, ev.summary, kind], c);
        eventId = r!.id;
        added++;
      }
      await c.query('SAVEPOINT ext_block');
      try {
        await c.query(`INSERT INTO availability_blocks (property_id, date_range, block_type, reference_id, source_connection_id, reason)
                       VALUES ($1, daterange($2::date,$3::date,'[)'), 'external_sync', $4, $5, $6)`, [conn.property_id, ev.start, ev.end, eventId, conn.id, conn.display_name]);
        await c.query('RELEASE SAVEPOINT ext_block');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT ext_block');
        if (!isPgError(e, PG_EXCLUSION_VIOLATION)) throw e;
        const same = await one(`SELECT 1 FROM availability_blocks WHERE property_id=$1 AND date_range = daterange($2::date,$3::date,'[)')`, [conn.property_id, ev.start, ev.end], c);
        const containedInOurs = await one(`SELECT 1 FROM availability_blocks WHERE property_id=$1 AND date_range @> daterange($2::date,$3::date,'[)') AND block_type IN ('platform_booking','manual_admin','external_sync')`, [conn.property_id, ev.start, ev.end], c);
        if (same || containedInOurs) {
          await c.query(`UPDATE external_calendar_events SET sync_state='echo' WHERE id=$1`, [eventId]);
        } else {
          await c.query(`UPDATE external_calendar_events SET sync_state='conflict' WHERE id=$1`, [eventId]);
          conflicts++;
          conflictMsgs.push(`${fmtDate(ev.start)} – ${fmtDate(ev.end)}`);
        }
      }
    }
    for (const gone of byUid.values()) { await removeEvent(gone.id); removed++; }

    await c.query(`UPDATE channel_connections SET last_synced_at=now(), last_sync_status='success', last_error=NULL, consecutive_failures=0 WHERE id=$1`, [conn.id]);
    await reconcileCleaningTasks(c, conn.property_id);
    if (conflicts) {
      await audit(c, SYSTEM, 'channel.conflict_detected', 'channel_connection', conn.id, undefined, { conflicts: conflictMsgs });
      await notifyAdmins({ type: 'channel_conflict', dedupeKey: `channel_conflict:${conn.id}:${conflictMsgs.join('|')}`, subject: `MULIG DOBBELTBOOKING via ${conn.display_name}`,
        body: `${conn.display_name} har en reservasjon som overlapper en eksisterende booking:\n${conflictMsgs.join('\n')}\n\nSjekk kalenderen og kontakt kanalen umiddelbart.` }, c);
    }
    return { added, removed, conflicts };
  });
}

export async function syncConnection(connectionId: string, actor: Actor = SYSTEM) {
  const conn = await one<Conn>(`SELECT id, property_id, channel, display_name, integration_mode, ical_url, config FROM channel_connections WHERE id=$1 AND active`, [connectionId]);
  if (!conn) throw new DomainError('not_found', 'Fant ikke kanalkoblingen.');
  const adapter = adapterFor(conn);
  if (!adapter.fetchEvents) return { skipped: true };
  const run = await one<{ id: string }>(`INSERT INTO channel_sync_runs (connection_id) VALUES ($1) RETURNING id`, [conn.id]);
  try {
    const events = await adapter.fetchEvents(conn);
    const r = await applySnapshot(conn, events);
    await getPool().query(`UPDATE channel_sync_runs SET finished_at=now(), status='success', events_added=$2, events_removed=$3, conflicts=$4 WHERE id=$1`, [run!.id, r.added, r.removed, r.conflicts]);
    return r;
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    const row = await one<{ consecutive_failures: number }>(
      `UPDATE channel_connections SET last_sync_status='failure', last_error=$2, consecutive_failures=consecutive_failures+1 WHERE id=$1 RETURNING consecutive_failures`, [conn.id, msg]);
    await getPool().query(`UPDATE channel_sync_runs SET finished_at=now(), status='failure', error=$2 WHERE id=$1`, [run!.id, msg]);
    await audit(null, actor, 'channel.sync_failed', 'channel_connection', conn.id, undefined, { error: msg });
    const threshold = await getNum('ical_failure_alert_threshold', 3);
    if (row && row.consecutive_failures === threshold) {
      await notifyAdmins({ type: 'sync_failure', subject: `Kalendersynk feiler: ${conn.display_name}`,
        body: `Synk mot ${conn.display_name} har feilet ${threshold} ganger på rad. Siste feil: ${msg}\nEksisterende sperringer beholdes til synk virker igjen.` });
    }
    throw new DomainError('sync_failed', `Synk feilet: ${msg}`);
  }
}

export async function syncAllDue(): Promise<{ ok: number; failed: number }> {
  const minutes = await getNum('ical_poll_interval_minutes', 30);
  const due = await q<{ id: string }>(`SELECT id FROM channel_connections WHERE active AND integration_mode IN ('ical_import','channel_manager')
    AND (last_synced_at IS NULL OR last_synced_at < now() - make_interval(mins => $1) OR last_sync_status='failure')`, [minutes]);
  let ok = 0, failed = 0;
  for (const d of due) { try { await syncConnection(d.id); ok++; } catch { failed++; } }
  return { ok, failed };
}

/** Export feed content for the channel owning `token`. Returns null for unknown tokens (→ 404, nothing leaked). */
export async function exportFeed(token: string) {
  const conn = await one<{ id: string; property_id: string; channel: string; name: string }>(
    `UPDATE channel_connections cc SET last_fetched_at=now() FROM properties p
     WHERE cc.export_token_hash=$1 AND cc.active AND cc.integration_mode='ical_export' AND p.id=cc.property_id
     RETURNING cc.id, cc.property_id, cc.channel, p.name`, [hashToken(token)]);
  if (!conn) return null;
  // Exclude blocks imported from the SAME channel (no echo back to e.g. Airbnb of Airbnb's own bookings)
  const blocks = await q<{ id: string; start: string; end: string }>(
    `SELECT ab.id, to_char(lower(ab.date_range),'YYYY-MM-DD') AS start, to_char(upper(ab.date_range),'YYYY-MM-DD') AS "end"
     FROM availability_blocks ab LEFT JOIN channel_connections src ON src.id = ab.source_connection_id
     WHERE ab.property_id=$1 AND upper(ab.date_range) >= current_date AND (src.id IS NULL OR src.channel <> $2)
     ORDER BY lower(ab.date_range)`, [conn.property_id, conn.channel]);
  return buildIcal(conn.name, blocks);
}

export async function createConnection(input: { propertyId: string; channel: string; displayName: string; mode: string; icalUrl?: string }, actor: Actor) {
  let token: string | null = null;
  if (input.mode === 'ical_import' && !/^https:\/\//.test(input.icalUrl ?? '')) throw new DomainError('bad_url', 'Lim inn en gyldig https iCal-lenke fra kanalen.');
  if (input.mode === 'ical_export') token = randomToken();
  const row = await one<{ id: string }>(
    `INSERT INTO channel_connections (property_id, channel, display_name, integration_mode, ical_url, export_token_hash, last_sync_status)
     VALUES ($1,$2,$3,$4,$5,$6,'never') RETURNING id`,
    [input.propertyId, input.channel, input.displayName.trim() || input.channel, input.mode, input.mode === 'ical_import' ? input.icalUrl : null, token ? hashToken(token) : null]);
  await audit(null, actor, 'channel.connection_created', 'channel_connection', row!.id, undefined, { ...input, icalUrl: input.icalUrl ? '[set]' : undefined });
  return { id: row!.id, exportToken: token };
}

export async function rotateExportToken(connectionId: string, actor: Actor) {
  const token = randomToken();
  const r = await one(`UPDATE channel_connections SET export_token_hash=$2, last_fetched_at=NULL WHERE id=$1 AND integration_mode='ical_export' RETURNING id`, [connectionId, hashToken(token)]);
  if (!r) throw new DomainError('not_found', 'Fant ikke eksportfeeden.');
  await audit(null, actor, 'channel.export_token_rotated', 'channel_connection', connectionId);
  return token;
}

export async function staleExportFeeds(db: Db = getPool()) {
  return q(`SELECT cc.id, cc.display_name, p.name AS property, cc.last_fetched_at, cc.created_at FROM channel_connections cc JOIN properties p ON p.id=cc.property_id
            WHERE cc.active AND cc.integration_mode='ical_export' AND COALESCE(cc.last_fetched_at, cc.created_at) < now() - interval '24 hours'`, [], db);
}
