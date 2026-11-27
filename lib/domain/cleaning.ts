import { PoolClient } from 'pg';
import crypto from 'crypto';
import { Db, getPool, one, q, tx } from '../db';
import { DomainError, forbidden } from '../errors';
import { audit, Actor } from '../audit';
import { appUrl, enqueue, notifyAdmins } from '../notify';
import { addDays, fmtDate, todayOslo } from '../format';
import { allocateBeds, Allocation, BedInput, roomSupplies } from './beds';
import { isAdmin, UserLike } from '../auth/rbac';
import { putObject } from '../storage';
import { helperMsg, helperEmailBody, HelperMessage } from '../i18n/cleaning';

// ------------------------------------------------------------------ stay preparation
export async function upsertBookingPreparation(c: PoolClient, bookingId: string, propertyId: string, g: { adults: number; children: number; infants: number; ownLinen?: boolean; ownLinenPersons?: number }) {
  await c.query(
    `INSERT INTO stay_preparations (property_id, booking_id, adults, children, infants, own_linen, own_linen_persons) VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),COALESCE($7,0))
     ON CONFLICT (booking_id) DO UPDATE SET adults=EXCLUDED.adults, children=EXCLUDED.children, infants=EXCLUDED.infants, own_linen=COALESCE($6, stay_preparations.own_linen),
       own_linen_persons=COALESCE($7, stay_preparations.own_linen_persons), updated_at=now()`,
    [propertyId, bookingId, g.adults, g.children, g.infants, g.ownLinen ?? null, g.ownLinenPersons ?? null]);
}

async function ensureExternalPreparation(c: PoolClient, eventId: string, propertyId: string): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO stay_preparations (property_id, external_event_id) VALUES ($1,$2)
     ON CONFLICT (external_event_id) DO UPDATE SET updated_at = stay_preparations.updated_at RETURNING id`, [propertyId, eventId], c);
  return row!.id;
}

// ------------------------------------------------------------------ task generation
type Stay = { key: string; source: 'platform_booking' | 'external_event'; refId: string; start: string; end: string; guests: number | null;
  channel: string; prepId: string; exempt: boolean; blocked?: boolean };

/**
 * Idempotent reconciliation of cleaning tasks for one property from every channel.
 * Called after any booking confirmation/cancellation and after every calendar sync.
 */
export async function reconcileCleaningTasks(c: PoolClient, propertyId: string): Promise<{ created: number; updated: number; cancelled: number }> {
  // Serialize reconciliation per property
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cleaning:' + propertyId]);
  const horizonStart = addDays(todayOslo(), -7);
  const prop = await one<{ check_in_time: string; name: string }>('SELECT check_in_time, name FROM properties WHERE id=$1', [propertyId], c);

  const bookingStays = await q<{ id: string; start: string; end: string; guests: number; prep_id: string; exempt: boolean }>(
    `SELECT b.id, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.adults + b.children AS guests, sp.id AS prep_id,
            (b.cleaning_self OR EXISTS (SELECT 1 FROM member_cleaning_exemptions e WHERE e.user_id=b.member_id AND e.active AND (e.property_id IS NULL OR e.property_id=b.property_id))) AS exempt
     FROM bookings b JOIN stay_preparations sp ON sp.booking_id=b.id
     WHERE b.property_id=$1 AND b.status IN ('confirmed','completed','cancellation_requested') AND b.end_date >= $2`, [propertyId, horizonStart], c);
  // Blocked dates ("Not available") also get cleaning jobs – they are often own stays or bookings from elsewhere.
  // Airbnb's own 1-night blocks (advance notice, preparation time) and the long "outside booking window" block are skipped.
  // Jobs from blocks are not sent to a cleaner automatically: the administrator assigns or switches them off.
  const extStays = await q<{ id: string; start: string; end: string; channel: string; blocked: boolean }>(
    `SELECT e.id, to_char(e.start_date,'YYYY-MM-DD') AS start, to_char(e.end_date,'YYYY-MM-DD') AS "end", cc.display_name AS channel, e.block_kind = 'owner_block' AS blocked
     FROM external_calendar_events e JOIN channel_connections cc ON cc.id=e.connection_id
     WHERE e.property_id=$1 AND e.sync_state IN ('active','conflict') AND e.end_date >= $2
       AND (e.block_kind <> 'owner_block' OR (e.end_date - e.start_date) BETWEEN 2 AND 60)`, [propertyId, horizonStart], c);

  const stays: Stay[] = [];
  for (const b of bookingStays) stays.push({ key: 'b:' + b.id, source: 'platform_booking', refId: b.id, start: b.start, end: b.end, guests: b.guests, channel: 'mountainretreat.no', prepId: b.prep_id, exempt: b.exempt });
  for (const e of extStays) stays.push({ key: 'e:' + e.id, source: 'external_event', refId: e.id, start: e.start, end: e.end, guests: null,
    channel: e.blocked ? `${e.channel} – blokkert` : e.channel, prepId: await ensureExternalPreparation(c, e.id, propertyId), exempt: false, blocked: e.blocked });
  stays.sort((a, b) => a.start.localeCompare(b.start));

  type Desired = { task_type: 'turnover' | 'preparation'; stay: Stay; date: string; nextCheckin: string | null; nextPrep: string | null };
  const desired: Desired[] = [];
  stays.forEach((s, i) => {
    const next = stays.slice(i + 1).find(n => n.start >= s.end);
    desired.push({ task_type: 'turnover', stay: s, date: s.end, nextCheckin: next?.start ?? null, nextPrep: next?.prepId ?? null });
    const prev = stays.slice(0, i).reverse().find(p => p.end <= s.start);
    if (!prev || prev.end < addDays(s.start, -3)) {
      desired.push({ task_type: 'preparation', stay: s, date: s.start, nextCheckin: s.start, nextPrep: s.prepId });
    }
  });

  const existing = await q<{ id: string; task_type: string; booking_id: string | null; external_event_id: string | null; checkout_date: string;
    next_checkin_date: string | null; next_preparation_id: string | null; status: string; assigned_to_user_id: string | null; source_type: string }>(
    `SELECT id, task_type, booking_id, external_event_id, to_char(checkout_date,'YYYY-MM-DD') AS checkout_date, to_char(next_checkin_date,'YYYY-MM-DD') AS next_checkin_date,
            next_preparation_id, status, assigned_to_user_id, source_type
     FROM cleaning_tasks WHERE property_id=$1 AND status NOT IN ('cancelled') AND checkout_date >= $2`, [propertyId, horizonStart], c);
  const keyOf = (t: { task_type: string; booking_id: string | null; external_event_id: string | null }) =>
    (t.booking_id ? 'b:' + t.booking_id : 'e:' + t.external_event_id) + ':' + t.task_type;
  const existingByKey = new Map(existing.filter(t => t.source_type !== 'manual').map(t => [keyOf(t), t]));
  const helpers = await q<{ helper_user_id: string }>(`SELECT helper_user_id FROM helper_property_assignments WHERE property_id=$1 AND active`, [propertyId], c);
  const autoAssignee = helpers.length === 1 ? helpers[0].helper_user_id : null;

  let created = 0, updated = 0, cancelled = 0;
  const seen = new Set<string>();
  for (const d of desired) {
    const key = d.stay.key + ':' + d.task_type;
    seen.add(key);
    const ex = existingByKey.get(key);
    const deadlineSql = `CASE WHEN $3::date IS NULL THEN NULL ELSE ($3::date + $4::time) AT TIME ZONE 'Europe/Oslo' END`;
    if (!ex) {
      if (d.date < todayOslo()) continue; // don't create tasks in the past
      const assignee = d.stay.blocked ? null : autoAssignee;
      const status = d.stay.exempt && d.task_type === 'turnover' ? 'not_needed' : assignee ? 'assigned' : 'open';
      const t = await one<{ id: string }>(
        `INSERT INTO cleaning_tasks (property_id, task_type, source_type, booking_id, external_event_id, channel_name, checkout_date, next_checkin_date,
           deadline_at, next_preparation_id, checkout_guests, status, not_needed_reason, assigned_to_user_id)
         VALUES ($1,$5,$6,$7,$8,$9,$2,$3, ${deadlineSql}, $10,$11,$12,$13,$14) RETURNING id`,
        [propertyId, d.date, d.nextCheckin, prop!.check_in_time, d.task_type, d.stay.source,
         d.stay.source === 'platform_booking' ? d.stay.refId : null, d.stay.source === 'external_event' ? d.stay.refId : null,
         d.stay.channel, d.nextPrep, d.task_type === 'turnover' ? d.stay.guests : null, status,
         status === 'not_needed' ? 'Gjesten vasker selv' : null, status === 'assigned' ? assignee : null], c);
      created++;
      if (status !== 'not_needed' && !d.stay.blocked) {
        for (const h of helpers.map(x => x.helper_user_id)) {
          await notifyHelper(c, h, helperMsg.newBooking(d.stay.channel, prop!.name, d.task_type, d.date, d.stay.guests, h === autoAssignee, !!d.nextCheckin && d.nextCheckin === d.date), t!.id,
            { dedupe: `cleaning_new:${t!.id}` });
        }
      }
    } else {
      const changed = ex.checkout_date !== d.date || ex.next_checkin_date !== d.nextCheckin || ex.next_preparation_id !== d.nextPrep;
      if (changed && ex.status !== 'done') {
        await c.query(`UPDATE cleaning_tasks SET checkout_date=$2, next_checkin_date=$3, deadline_at=${deadlineSql}, next_preparation_id=$5, updated_at=now() WHERE id=$1`,
          [ex.id, d.date, d.nextCheckin, prop!.check_in_time, d.nextPrep]);
        updated++;
        if (ex.assigned_to_user_id && ex.checkout_date !== d.date) await notifyHelper(c, ex.assigned_to_user_id, helperMsg.moved(prop!.name, ex.checkout_date, d.date), ex.id);
      }
    }
  }
  for (const [key, ex] of existingByKey) {
    if (seen.has(key) || ex.status === 'done') continue;
    await c.query(`UPDATE cleaning_tasks SET status='cancelled', updated_at=now() WHERE id=$1`, [ex.id]);
    cancelled++;
    if (ex.assigned_to_user_id) await notifyHelper(c, ex.assigned_to_user_id, helperMsg.cancelled(prop!.name, ex.checkout_date), ex.id);
  }
  return { created, updated, cancelled };
}

/** E-mail + SMS (per the cleaner's own preferences) to one cleaner. */
export async function notifyHelper(c: Db, helperId: string, msg: HelperMessage, taskId: string, opts: { dedupe?: string } = {}) {
  const h = await one<{ email: string; name: string; phone: string | null; notify_email: boolean; notify_sms: boolean; status: string; preferred_lang: string | null }>(
    'SELECT email, name, phone, notify_email, notify_sms, status, preferred_lang FROM users WHERE id=$1', [helperId], c);
  if (!h || h.status !== 'active') return;
  const lang = h.preferred_lang === 'en' ? 'en' : 'no';
  const m = msg[lang];
  const link = appUrl('/renhold/oppgaver/' + taskId);
  if (h.notify_email) await enqueue({ userId: helperId, to: h.email, type: 'cleaning_task', subject: m.subject, dedupeKey: opts.dedupe ? `${opts.dedupe}:email:${helperId}` : undefined,
    body: helperEmailBody(lang, h.name, m.subject, link) }, c);
  if (h.notify_sms && h.phone) await enqueue({ userId: helperId, to: h.phone, channel: 'sms', type: 'cleaning_task', subject: m.subject, dedupeKey: opts.dedupe ? `${opts.dedupe}:sms:${helperId}` : undefined,
    body: `${m.sms ?? m.subject} ${link}` }, c);
}

/** Every active cleaner assigned to the property (used for "new booking" alerts and unassigned reminders). */
async function propertyHelpers(c: Db, propertyId: string) {
  return (await q<{ id: string }>(`SELECT h.helper_user_id AS id FROM helper_property_assignments h JOIN users u ON u.id=h.helper_user_id
    WHERE h.property_id=$1 AND h.active AND u.status='active'`, [propertyId], c)).map(r => r.id);
}

/** Same-day reminder: runs every minute, sends once per task from the configured hour (Oslo time). */
export async function sameDayCleaningReminders(hour: number): Promise<number> {
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hour12: false }).format(new Date()));
  if (nowHour < hour) return 0;
  const today = todayOslo();
  const tasks = await q<{ id: string; property_id: string; property: string; assigned_to_user_id: string | null; task_type: string; cout: string; cin: string; same_day: boolean; guests: number | null }>(
    `SELECT t.id, t.property_id, p.name AS property, t.assigned_to_user_id, t.task_type, to_char(p.check_out_time,'HH24:MI') AS cout, to_char(p.check_in_time,'HH24:MI') AS cin,
            (t.next_checkin_date = t.checkout_date) AS same_day, sp.adults + sp.children AS guests
     FROM cleaning_tasks t JOIN properties p ON p.id=t.property_id LEFT JOIN stay_preparations sp ON sp.id=t.next_preparation_id
     WHERE t.checkout_date=$1 AND t.status IN ('open','assigned')`, [today]);
  for (const t of tasks) {
    const who = t.assigned_to_user_id ? [t.assigned_to_user_id] : await propertyHelpers(getPool(), t.property_id);
    for (const h of who) {
      await notifyHelper(getPool(), h, helperMsg.reminderToday(t.property, t.task_type, t.cout, t.cin, t.same_day, t.guests, !!t.assigned_to_user_id), t.id,
        { dedupe: `cleaning_today:${t.id}:${today}` });
    }
  }
  return tasks.length;
}

// ------------------------------------------------------------------ access
export async function helperCanSeeTask(user: UserLike & { cleaning_scope?: string }, taskId: string, db: Db = getPool()) {
  if (isAdmin(user)) return true;
  if (user.system_role !== 'helper') return false;
  const t = await one<{ property_id: string; assigned_to_user_id: string | null }>('SELECT property_id, assigned_to_user_id FROM cleaning_tasks WHERE id=$1', [taskId], db);
  if (!t) return false;
  if (t.assigned_to_user_id === user.id) return true;
  if (user.cleaning_scope === 'all') return true;
  return false;
}

/** Tasks visible to a helper: assigned to them (or everything on their properties if granted broader access). No prices/names. */
export async function tasksForHelper(user: UserLike & { cleaning_scope?: string }, from: string, to: string, db: Db = getPool()) {
  const scopeAll = isAdmin(user) || user.cleaning_scope === 'all';
  return q(
    `SELECT t.id, t.task_type, t.status, t.channel_name, to_char(t.checkout_date,'YYYY-MM-DD') AS date, to_char(t.next_checkin_date,'YYYY-MM-DD') AS next_checkin,
            t.deadline_at, t.checkout_guests, t.notes, t.assigned_to_user_id, p.name AS property_name, p.address, p.id AS property_id,
            to_char(p.check_out_time,'HH24:MI') AS check_out_time, to_char(p.check_in_time,'HH24:MI') AS check_in_time,
            sp.adults AS next_adults, sp.children AS next_children, sp.infants AS next_infants, sp.comment_for_cleaner, sp.own_linen, sp.own_linen_persons, (SELECT string_agg(a.name || ' × ' || ba.quantity, ', ' ORDER BY a.name) FROM booking_add_ons ba JOIN add_on_items a ON a.id=ba.add_on_item_id WHERE ba.booking_id = sp.booking_id) AS next_add_ons, to_char(sp.expected_arrival_time,'HH24:MI') AS expected_arrival,
            hu.name AS assignee_name,
            (t.next_checkin_date IS NOT NULL AND t.next_checkin_date = t.checkout_date) AS same_day
     FROM cleaning_tasks t JOIN properties p ON p.id=t.property_id
     LEFT JOIN stay_preparations sp ON sp.id = t.next_preparation_id
     LEFT JOIN users hu ON hu.id = t.assigned_to_user_id
     WHERE t.checkout_date BETWEEN $1 AND $2 AND t.status <> 'cancelled'
       AND ($3::boolean OR t.assigned_to_user_id = $4)
     ORDER BY t.checkout_date, p.name`, [from, to, scopeAll, user.id], db);
}

// ------------------------------------------------------------------ room-by-room overview
export async function roomPlanForPreparation(prepId: string | null, propertyId: string, db: Db = getPool()) {
  const rooms = await q<{ id: string; name: string; floor: string | null; description: string | null; photo_id: string | null; max_capacity: number; bedding_instructions: string | null; sort_order: number }>(
    `SELECT r.id, r.name, r.floor, r.description, (SELECT ph.id FROM photos ph WHERE ph.entity_type='room' AND ph.entity_id=r.id ORDER BY ph.created_at DESC LIMIT 1) AS photo_id, r.max_capacity, r.bedding_instructions, r.sort_order FROM rooms r WHERE r.property_id=$1 AND r.active ORDER BY r.sort_order, r.name`, [propertyId], db);
  const beds = await q<BedInput & { label: string; width_cm: number | null; length_cm: number | null }>(
    `SELECT id, room_id, label, bed_type, sleeps, allocation_priority, children_only, width_cm, length_cm FROM beds WHERE property_id=$1 AND active ORDER BY allocation_priority`, [propertyId], db);
  const prep = prepId ? await one<{ id: string; adults: number; children: number; infants: number; plan_source: string; comment_for_cleaner: string | null; own_linen_persons: number }>(
    'SELECT id, adults, children, infants, plan_source, comment_for_cleaner, own_linen_persons FROM stay_preparations WHERE id=$1', [prepId], db) : null;
  const guests = prep ? { adults: prep.adults, children: prep.children, infants: prep.infants } : null;
  let allocations: Allocation[] = [];
  let warnings: string[] = [];
  let source: 'none' | 'auto' | 'admin_override' | 'member' = 'none';
  if (prep && (prep.plan_source === 'admin_override' || prep.plan_source === 'member')) {
    allocations = await q<Allocation>('SELECT bed_id, persons, guest_type, linen FROM stay_sleeping_plan WHERE stay_preparation_id=$1', [prep.id], db);
    source = prep.plan_source as 'admin_override' | 'member';
  } else if (guests && guests.adults + guests.children + guests.infants > 0) {
    const r = allocateBeds(rooms, beds, guests);
    allocations = r.allocations; warnings = r.warnings; source = 'auto';
  }
  const byBed = new Map(allocations.map(a => [a.bed_id, a]));
  const roomViews = rooms.map(r => {
    const rb = beds.filter(b => b.room_id === r.id);
    const guestsInRoom = rb.reduce((s, b) => s + (byBed.get(b.id)?.persons ?? 0), 0);
    return {
      ...r,
      guestsInRoom,
      beds: rb.map(b => ({ ...b, allocation: byBed.get(b.id) ?? null })),
      supplies: roomSupplies(rb, byBed),
    };
  });
  return { prep, guests, source, warnings, rooms: roomViews };
}

// ------------------------------------------------------------------ helper actions
async function lockTaskFor(c: PoolClient, taskId: string, user: UserLike & { cleaning_scope?: string }) {
  if (!(await helperCanSeeTask(user, taskId, c))) throw forbidden();
  const t = await one<{ id: string; status: string; property_id: string; checkout_date: string }>('SELECT id, status, property_id, to_char(checkout_date,\'YYYY-MM-DD\') AS checkout_date FROM cleaning_tasks WHERE id=$1 FOR UPDATE', [taskId], c);
  if (!t) throw new DomainError('not_found', 'Fant ikke oppgaven.');
  return t;
}

export async function startTask(taskId: string, user: UserLike, actor: Actor) {
  await tx(async c => {
    const t = await lockTaskFor(c, taskId, user);
    if (!['open', 'assigned'].includes(t.status)) throw new DomainError('bad_state', 'Oppgaven kan ikke startes.');
    await c.query(`UPDATE cleaning_tasks SET status='in_progress', started_at=now(), assigned_to_user_id=COALESCE(assigned_to_user_id,$2), updated_at=now() WHERE id=$1`, [taskId, user.id]);
    await audit(c, actor, 'cleaning.started', 'cleaning_task', taskId);
  });
}

export async function completeTask(taskId: string, user: UserLike & { name?: string }, notes: string, actor: Actor) {
  await tx(async c => {
    const t = await lockTaskFor(c, taskId, user);
    if (!['open', 'assigned', 'in_progress'].includes(t.status)) throw new DomainError('bad_state', 'Oppgaven er allerede avsluttet.');
    await c.query(`UPDATE cleaning_tasks SET status='done', completed_at=now(), completed_by_user_id=$2, completion_notes=$3, started_at=COALESCE(started_at, now()), updated_at=now() WHERE id=$1`,
      [taskId, user.id, notes.trim() || null]);
    await audit(c, actor, 'cleaning.completed', 'cleaning_task', taskId, { status: t.status }, { status: 'done', notes });
    const p = await one<{ name: string }>('SELECT name FROM properties WHERE id=$1', [t.property_id], c);
    await notifyAdmins({ type: 'cleaning_completed', dedupeKey: `cleaning_completed:${taskId}`, subject: `Renhold ferdig: ${p!.name} ${fmtDate(t.checkout_date)}`,
      body: `${user.name ?? 'Renholder'} har markert renholdet som ferdig.${notes.trim() ? `\nNotat: ${notes.trim()}` : ''}` }, c);
  });
}

export async function setRoomDone(taskId: string, roomId: string, done: boolean, user: UserLike, actor: Actor) {
  await tx(async c => {
    await lockTaskFor(c, taskId, user);
    await c.query(
      `INSERT INTO room_preparation_status (cleaning_task_id, room_id, completed_at, completed_by_user_id) VALUES ($1,$2, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN $4::uuid END)
       ON CONFLICT (cleaning_task_id, room_id) DO UPDATE SET completed_at = EXCLUDED.completed_at, completed_by_user_id = EXCLUDED.completed_by_user_id`,
      [taskId, roomId, done, user.id]);
    await c.query(`UPDATE cleaning_tasks SET status = CASE WHEN status IN ('open','assigned') THEN 'in_progress' ELSE status END, started_at = COALESCE(started_at, now()) WHERE id=$1`, [taskId]);
    await audit(c, actor, done ? 'cleaning.room_done' : 'cleaning.room_undone', 'cleaning_task', taskId, undefined, { roomId });
  });
}

export async function reportIssue(taskId: string, kind: 'damage' | 'missing_item' | 'issue' | 'comment', description: string, user: UserLike & { name?: string }, actor: Actor) {
  if (!description.trim()) throw new DomainError('empty', 'Skriv en beskrivelse.');
  return tx(async c => {
    const t = await lockTaskFor(c, taskId, user);
    const r = await one<{ id: string }>(`INSERT INTO cleaning_reports (cleaning_task_id, property_id, kind, description, created_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [taskId, t.property_id, kind, description.trim().slice(0, 4000), user.id], c);
    await audit(c, actor, 'cleaning.report_' + kind, 'cleaning_report', r!.id);
    if (kind !== 'comment') {
      const p = await one<{ name: string }>('SELECT name FROM properties WHERE id=$1', [t.property_id], c);
      const label = { damage: 'Skade', missing_item: 'Mangler', issue: 'Avvik', comment: 'Kommentar' }[kind];
      await notifyAdmins({ type: 'cleaning_report', subject: `${label} rapportert: ${p!.name}`, body: `${user.name ?? 'Renholder'} rapporterte:\n${description.trim()}\n\n${appUrl('/admin/renhold')}` }, c);
    }
    return r!.id;
  });
}

// ------------------------------------------------------------------ photo upload (validated by magic bytes, stored outside web root)
const MAGIC: [string, number[]][] = [['image/jpeg', [0xff, 0xd8, 0xff]], ['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];
export function sniffImage(buf: Buffer): string | null {
  for (const [mime, sig] of MAGIC) if (sig.every((b, i) => buf[i] === b)) {
    if (mime === 'image/webp' && buf.subarray(8, 12).toString() !== 'WEBP') continue;
    return mime;
  }
  return null;
}

export async function savePhoto(entityType: 'cleaning_task' | 'cleaning_report' | 'room' | 'property', entityId: string, file: File, user: UserLike, actor: Actor) {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new DomainError('bad_file', 'Bildet må være under 10 MB.');
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImage(buf);
  if (!mime) throw new DomainError('bad_file', 'Kun JPEG, PNG eller WebP er tillatt.');
  const key = `${entityType}/${crypto.randomUUID()}.${mime.split('/')[1]}`;
  await putObject(key, buf, mime);
  const row = await one<{ id: string }>(`INSERT INTO photos (entity_type, entity_id, storage_key, mime_type, size_bytes, uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [entityType, entityId, key, mime, buf.length, user.id]);
  await audit(null, actor, 'photo.uploaded', entityType, entityId, undefined, { photo: row!.id });
  return row!.id;
}

// ------------------------------------------------------------------ admin
export async function assignTask(taskId: string, helperId: string | null, actor: Actor) {
  await tx(async c => {
    const t = await one<{ status: string; property_id: string; checkout_date: string }>(`SELECT status, property_id, to_char(checkout_date,'YYYY-MM-DD') AS checkout_date FROM cleaning_tasks WHERE id=$1 FOR UPDATE`, [taskId], c);
    if (!t) throw new DomainError('not_found', 'Fant ikke oppgaven.');
    if (helperId) {
      const h = await one(`SELECT 1 FROM users WHERE id=$1 AND system_role='helper' AND status='active'`, [helperId], c);
      if (!h) throw new DomainError('bad_helper', 'Ugyldig renholder.');
    }
    await c.query(`UPDATE cleaning_tasks SET assigned_to_user_id=$2, status = CASE WHEN status IN ('open','assigned') THEN (CASE WHEN $2::uuid IS NULL THEN 'open' ELSE 'assigned' END) ELSE status END, updated_at=now() WHERE id=$1`, [taskId, helperId]);
    await audit(c, actor, 'cleaning.assigned', 'cleaning_task', taskId, undefined, { helperId });
    const p = await one<{ name: string }>('SELECT name FROM properties WHERE id=$1', [t.property_id], c);
    if (helperId) await notifyHelper(c, helperId, helperMsg.assigned(p!.name, t.checkout_date), taskId);
  });
}

/**
 * "Vasker selv": the administrator turns off one cleaning job (e.g. own stay, or a guest who cleans themselves).
 * The job is kept in the history as "Ikke nødvendig"; the assigned cleaner is told it is not needed.
 */
export async function skipTask(taskId: string, reason: string, actor: Actor) {
  await tx(async c => {
    const t = await one<{ status: string; property_id: string; checkout_date: string; assigned_to_user_id: string | null }>(
      `SELECT status, property_id, to_char(checkout_date,'YYYY-MM-DD') AS checkout_date, assigned_to_user_id FROM cleaning_tasks WHERE id=$1 FOR UPDATE`, [taskId], c);
    if (!t) throw new DomainError('not_found', 'Fant ikke oppgaven.');
    if (!['open', 'assigned'].includes(t.status)) throw new DomainError('bad_state', 'Bare oppgaver som ikke er startet kan slås av.');
    await c.query(`UPDATE cleaning_tasks SET status='not_needed', not_needed_reason=$2, updated_at=now() WHERE id=$1`, [taskId, reason.trim().slice(0, 200) || 'Vasker selv']);
    await audit(c, actor, 'cleaning.skipped', 'cleaning_task', taskId, { status: t.status }, { status: 'not_needed', reason });
    if (t.assigned_to_user_id) {
      const p = await one<{ name: string }>('SELECT name FROM properties WHERE id=$1', [t.property_id], c);
      await notifyHelper(c, t.assigned_to_user_id, helperMsg.notNeeded(p!.name, t.checkout_date), taskId);
    }
  });
}

/** Turn a job that was switched off back on (assigned again if it had a cleaner). */
export async function reactivateTask(taskId: string, actor: Actor) {
  await tx(async c => {
    const t = await one<{ status: string; property_id: string; checkout_date: string; assigned_to_user_id: string | null }>(
      `SELECT status, property_id, to_char(checkout_date,'YYYY-MM-DD') AS checkout_date, assigned_to_user_id FROM cleaning_tasks WHERE id=$1 FOR UPDATE`, [taskId], c);
    if (!t) throw new DomainError('not_found', 'Fant ikke oppgaven.');
    if (t.status !== 'not_needed') throw new DomainError('bad_state', 'Oppgaven er ikke slått av.');
    await c.query(`UPDATE cleaning_tasks SET status=$2, not_needed_reason=NULL, updated_at=now() WHERE id=$1`, [taskId, t.assigned_to_user_id ? 'assigned' : 'open']);
    await audit(c, actor, 'cleaning.reactivated', 'cleaning_task', taskId, { status: 'not_needed' }, { status: t.assigned_to_user_id ? 'assigned' : 'open' });
    if (t.assigned_to_user_id) {
      const p = await one<{ name: string }>('SELECT name FROM properties WHERE id=$1', [t.property_id], c);
      await notifyHelper(c, t.assigned_to_user_id, helperMsg.assigned(p!.name, t.checkout_date), taskId);
    }
  });
}

/**
 * "Gjesten vasker selv" on one booking. Before approval the cleaning fee is dropped when the price is locked.
 * The cleaning job after the stay is switched off (or back on).
 */
export async function setBookingCleaningSelf(bookingId: string, on: boolean, actor: Actor): Promise<{ priceLocked: boolean }> {
  const b = await one<{ status: string; property_id: string; cleaning_self: boolean }>(`SELECT status, property_id, cleaning_self FROM bookings WHERE id=$1`, [bookingId]);
  if (!b) throw new DomainError('not_found', 'Fant ikke bookingen.');
  await tx(async c => {
    await c.query(`UPDATE bookings SET cleaning_self=$2, updated_at=now() WHERE id=$1`, [bookingId, on]);
    await audit(c, actor, on ? 'booking.cleaning_self_on' : 'booking.cleaning_self_off', 'booking', bookingId, { cleaning_self: b.cleaning_self }, { cleaning_self: on });
  });
  const task = await one<{ id: string; status: string }>(`SELECT id, status FROM cleaning_tasks WHERE booking_id=$1 AND task_type='turnover' AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1`, [bookingId]);
  if (task && on && ['open', 'assigned'].includes(task.status)) await skipTask(task.id, 'Gjesten vasker selv', actor);
  if (task && !on && task.status === 'not_needed') await reactivateTask(task.id, actor);
  return { priceLocked: b.status !== 'pending_review' };
}

export async function overrideSleepingPlan(prepId: string, plan: { bed_id: string; persons: number; guest_type: string; linen?: boolean }[] | null, actor: Actor) {
  await tx(async c => {
    const prep = await one<{ property_id: string }>('SELECT property_id FROM stay_preparations WHERE id=$1 FOR UPDATE', [prepId], c);
    if (!prep) throw new DomainError('not_found', 'Fant ikke oppholdet.');
    await c.query('DELETE FROM stay_sleeping_plan WHERE stay_preparation_id=$1', [prepId]);
    if (plan === null) {
      await c.query(`UPDATE stay_preparations SET plan_source='auto', updated_by_user_id=$2, updated_at=now() WHERE id=$1`, [prepId, actor.id]);
    } else {
      for (const p of plan.filter(p => p.persons > 0)) {
        const bed = await one<{ sleeps: number }>('SELECT sleeps FROM beds WHERE id=$1 AND property_id=$2', [p.bed_id, prep.property_id], c);
        if (!bed) throw new DomainError('bad_bed', 'Ugyldig seng.');
        if (p.persons > bed.sleeps) throw new DomainError('over_capacity', 'For mange personer i én seng.');
        await c.query('INSERT INTO stay_sleeping_plan (stay_preparation_id, bed_id, persons, guest_type, linen) VALUES ($1,$2,$3,$4,$5)', [prepId, p.bed_id, p.persons, p.guest_type, p.linen !== false]);
      }
      await c.query(`UPDATE stay_preparations SET plan_source='admin_override', updated_by_user_id=$2, updated_at=now() WHERE id=$1`, [prepId, actor.id]);
    }
    await audit(c, actor, 'stay.sleeping_plan_override', 'stay_preparation', prepId, undefined, { plan });
  });
}

export async function updatePreparation(prepId: string, data: { adults: number; children: number; infants: number; comment: string; arrival: string | null }, actor: Actor) {
  await tx(async c => {
    const before = await one('SELECT adults, children, infants, comment_for_cleaner FROM stay_preparations WHERE id=$1 FOR UPDATE', [prepId], c);
    if (!before) throw new DomainError('not_found', 'Fant ikke oppholdet.');
    await c.query(`UPDATE stay_preparations SET adults=$2, children=$3, infants=$4, comment_for_cleaner=$5, expected_arrival_time=$6, updated_by_user_id=$7, updated_at=now() WHERE id=$1`,
      [prepId, data.adults, data.children, data.infants, data.comment.trim() || null, data.arrival || null, actor.id]);
    await audit(c, actor, 'stay.preparation_updated', 'stay_preparation', prepId, before, data);
    const assigned = await q<{ id: string; assigned_to_user_id: string }>(`SELECT id, assigned_to_user_id FROM cleaning_tasks WHERE next_preparation_id=$1 AND assigned_to_user_id IS NOT NULL AND status IN ('assigned','in_progress')`, [prepId], c);
    for (const t of assigned) await notifyHelper(c, t.assigned_to_user_id, helperMsg.guestInfoChanged(), t.id);
  });
}

/** Admin instructions for one cleaning job (shown to the cleaner); the assigned cleaner is told when it changes. */
export async function setTaskNotes(taskId: string, notes: string, actor: Actor) {
  await tx(async c => {
    const t = await one<{ notes: string | null; assigned_to_user_id: string | null; status: string }>(`SELECT notes, assigned_to_user_id, status FROM cleaning_tasks WHERE id=$1 FOR UPDATE`, [taskId], c);
    if (!t) throw new DomainError('not_found', 'Fant ikke vaskejobben.');
    const v = notes.trim().slice(0, 1000) || null;
    if (v === t.notes) return;
    await c.query(`UPDATE cleaning_tasks SET notes=$2, updated_at=now() WHERE id=$1`, [taskId, v]);
    await audit(c, actor, 'cleaning.notes_updated', 'cleaning_task', taskId, { notes: t.notes }, { notes: v });
    if (t.assigned_to_user_id && ['assigned', 'in_progress'].includes(t.status)) await notifyHelper(c, t.assigned_to_user_id, helperMsg.guestInfoChanged(), taskId);
  });
}
