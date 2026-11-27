import { getPool, one, q, tx } from '../db';
import { DomainError, forbidden } from '../errors';
import { audit, type Actor } from '../audit';
import { addDays, fmtDate, todayOslo } from '../format';
import { appUrl, enqueue } from '../notify';
import { notifyHelper, roomPlanForPreparation } from './cleaning';
import { helperMsg } from '../i18n/cleaning';

/**
 * The member chooses who sleeps where (optional). Open from approval until LOCK_DAYS before arrival.
 * An e-mail asks for it 7 days before arrival, with one reminder 4 days later (3 days before), unless every guest brings
 * their own bed linen or a plan is already set. With partial own linen, the member marks which beds they bring linen for.
 */
export const LOCK_DAYS = 2;
const REQUEST_DAYS = 7;
const REMINDER_AFTER_DAYS = 4;

type Booking = { id: string; member_id: string; status: string; start_date: string; end_date: string; reference: string; adults: number; children: number; infants: number; property_id: string; prep_id: string | null };

export async function memberPlanContext(bookingId: string, memberId: string) {
  const b = await one<Booking>(`SELECT b.id, b.member_id, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start_date, to_char(b.end_date,'YYYY-MM-DD') AS end_date, b.reference,
      b.adults, b.children, b.infants, b.property_id, sp.id AS prep_id
    FROM bookings b LEFT JOIN stay_preparations sp ON sp.booking_id=b.id WHERE b.id=$1`, [bookingId]);
  if (!b || b.member_id !== memberId) throw forbidden();
  const plan = await roomPlanForPreparation(b.prep_id, b.property_id);
  const lockDate = addDays(b.start_date, -LOCK_DAYS);
  const open = ['awaiting_payment', 'confirmed'].includes(b.status) && todayOslo() <= lockDate && plan.source !== 'admin_override' && !!b.prep_id;
  const ownLinen = plan.prep?.own_linen_persons ?? 0;
  return { booking: b, plan, open, lockDate, ownLinen, guests: b.adults + b.children };
}

export async function saveMemberPlan(bookingId: string, memberId: string, entries: { bed_id: string; persons: number; ownLinen: boolean }[], actor: Actor) {
  const ctx = await memberPlanContext(bookingId, memberId);
  if (!ctx.open) throw new DomainError('locked', `Soveplanen kan ikke endres lenger. Ta kontakt hvis noe må endres.`);
  const beds = new Map(ctx.plan.rooms.flatMap(r => r.beds.map(b => [b.id, b] as const)));
  const used = entries.filter(e => e.persons > 0);
  let total = 0, inOwn = 0;
  for (const e of used) {
    const bed = beds.get(e.bed_id);
    if (!bed) throw new DomainError('bad_bed', 'Ukjent seng.');
    if (e.persons > bed.sleeps) throw new DomainError('over', `For mange i «${bed.label}» (maks ${bed.sleeps}).`);
    total += bed.bed_type === 'cot' ? 0 : e.persons;
    if (e.ownLinen) inOwn += e.persons;
  }
  const { adults, children, infants } = ctx.booking;
  if (total < adults + children) throw new DomainError('missing', `Alle ${adults + children} gjestene må ha en seng (${total} plassert).`);
  if (total > adults + children + infants) throw new DomainError('too_many', `Det er plassert flere personer (${total}) enn det er gjester på bookingen.`);
  const partial = ctx.ownLinen > 0 && ctx.ownLinen < adults + children;
  if (partial && inOwn !== ctx.ownLinen) throw new DomainError('linen', `Merk sengene til de ${ctx.ownLinen} som tar med eget sengetøy (nå ${inOwn}).`);
  await tx(async c => {
    const prepId = ctx.booking.prep_id!;
    await c.query('DELETE FROM stay_sleeping_plan WHERE stay_preparation_id=$1', [prepId]);
    for (const e of used) {
      const bed = beds.get(e.bed_id)!;
      const type = bed.bed_type === 'cot' ? 'infant' : bed.children_only ? 'child' : 'adult';
      const linen = ctx.ownLinen >= adults + children ? false : partial ? !e.ownLinen : true;
      await c.query('INSERT INTO stay_sleeping_plan (stay_preparation_id, bed_id, persons, guest_type, linen) VALUES ($1,$2,$3,$4,$5)', [prepId, e.bed_id, e.persons, type, linen]);
    }
    await c.query(`UPDATE stay_preparations SET plan_source='member', updated_by_user_id=$2, updated_at=now() WHERE id=$1`, [prepId, actor.id]);
    await audit(c, actor, 'stay.sleeping_plan_member', 'stay_preparation', prepId, undefined, { entries: used });
    const assigned = await q<{ id: string; assigned_to_user_id: string }>(`SELECT id, assigned_to_user_id FROM cleaning_tasks WHERE next_preparation_id=$1 AND assigned_to_user_id IS NOT NULL AND status IN ('assigned','in_progress')`, [prepId], c);
    for (const t of assigned) await notifyHelper(c, t.assigned_to_user_id, helperMsg.guestInfoChanged(), t.id);
  });
}

export async function resetMemberPlan(bookingId: string, memberId: string, actor: Actor) {
  const ctx = await memberPlanContext(bookingId, memberId);
  if (!ctx.open) throw new DomainError('locked', 'Soveplanen kan ikke endres lenger.');
  await tx(async c => {
    await c.query('DELETE FROM stay_sleeping_plan WHERE stay_preparation_id=$1', [ctx.booking.prep_id]);
    await c.query(`UPDATE stay_preparations SET plan_source='auto', updated_at=now() WHERE id=$1`, [ctx.booking.prep_id]);
    await audit(c, actor, 'stay.sleeping_plan_member_reset', 'stay_preparation', ctx.booking.prep_id!);
  });
}

/** Daily job: ask for the sleeping plan 7 days before arrival, remind 4 days later. */
export async function sendSleepPlanRequests() {
  const today = todayOslo();
  const rows = await q<{ id: string; uid: string; reference: string; start: string; email: string; name: string; lang: string; requested: Date | null; property: string }>(
    `SELECT b.id, u.id AS uid, b.reference, to_char(b.start_date,'YYYY-MM-DD') AS start, u.email, u.name, u.preferred_lang AS lang, b.sleep_plan_requested_at AS requested, p.name AS property
     FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id JOIN stay_preparations sp ON sp.booking_id=b.id
     WHERE b.status='confirmed' AND sp.plan_source='auto' AND sp.own_linen_persons < (b.adults + b.children)
       AND b.start_date - $1::date BETWEEN ${LOCK_DAYS} AND ${REQUEST_DAYS}
       AND (b.sleep_plan_requested_at IS NULL OR (b.sleep_plan_reminded_at IS NULL AND b.sleep_plan_requested_at <= now() - interval '${REMINDER_AFTER_DAYS} days'))
       AND EXISTS (SELECT 1 FROM beds bd WHERE bd.property_id=b.property_id AND bd.active)`, [today]);
  let sent = 0;
  for (const r of rows) {
    const reminder = !!r.requested, en = r.lang === 'en';
    const link = appUrl(`/medlem/bookinger/${r.id}/soveplan`);
    const lock = fmtDate(addDays(r.start, -LOCK_DAYS));
    await enqueue({ userId: r.uid, to: r.email, type: 'sleep_plan_request', dedupeKey: `sleep_plan_${reminder ? 'reminder' : 'request'}:${r.id}`,
      subject: en ? `${reminder ? 'Reminder: ' : ''}Who sleeps where? (${r.property}, ${fmtDate(r.start)})` : `${reminder ? 'Påminnelse: ' : ''}Hvem sover hvor? (${r.property}, ${fmtDate(r.start)})`,
      body: en
        ? `Hi ${r.name.split(' ')[0]}!\n\nYour stay starts on ${fmtDate(r.start)}. So our cleaner can make up the beds the way you want, please tell us who sleeps where – it only takes a minute:\n${link}\n\nPlease do this by ${lock}. If you don't, we make up the beds based on the number of guests.`
        : `Hei ${r.name.split(' ')[0]}!\n\nOppholdet ditt starter ${fmtDate(r.start)}. For at renholderen skal kunne re opp sengene slik dere ønsker, vil vi gjerne vite hvem som sover hvor – det tar bare et minutt:\n${link}\n\nGjør det gjerne innen ${lock}. Hvis ikke, reer vi opp etter antall gjester.` });
    await getPool().query(`UPDATE bookings SET ${reminder ? 'sleep_plan_reminded_at' : 'sleep_plan_requested_at'}=now() WHERE id=$1`, [r.id]);
    sent++;
  }
  return { sent };
}
