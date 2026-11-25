import { Db, getPool, one, q, tx } from '../db';
import { audit, Actor } from '../audit';
import { DomainError, forbidden } from '../errors';
import { enqueue, notifyAdmins, appUrl } from '../notify';
import { todayOslo, addDays } from '../format';

/**
 * Reviews (omtaler). Two days after a Retreat Club stay the member is asked for a review (one reminder after a
 * week). The review is stored on the booking and the member card. Airbnb reviews are added by the administrator.
 * Only reviews with a public text – and, for members, consent to publish – can be chosen for the front page.
 */
export const CATEGORIES = ['cleanliness', 'accuracy', 'checkin', 'communication', 'location', 'value'] as const;
export type Category = typeof CATEGORIES[number];

const REQUEST_AFTER_DAYS = 2;
const REMIND_AFTER_DAYS = 7;
const ASK_WITHIN_DAYS = 30;

const star = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);

/** Can this member review this booking now? */
export async function reviewableBooking(bookingId: string, memberId: string, db: Db = getPool()) {
  const b = await one<{ id: string; member_id: string; status: string; end_date: string; property_id: string; reference: string; reviewed: boolean }>(
    `SELECT b.id, b.member_id, b.status, to_char(b.end_date,'YYYY-MM-DD') AS end_date, b.property_id, b.reference,
            EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id=b.id) AS reviewed
     FROM bookings b WHERE b.id=$1`, [bookingId], db);
  if (!b || b.member_id !== memberId) return null;
  const open = b.status === 'completed' && !b.reviewed && b.end_date >= addDays(todayOslo(), -365);
  return { ...b, open };
}

export async function submitReview(memberId: string, bookingId: string, input: Record<string, unknown>) {
  const b = await reviewableBooking(bookingId, memberId);
  if (!b) throw forbidden();
  if (b.reviewed) throw new DomainError('already', 'Du har allerede gitt en omtale for dette oppholdet. Takk!');
  if (b.status !== 'completed') throw new DomainError('not_yet', 'Du kan gi en omtale når oppholdet er gjennomført.');
  const rating = star(input.rating);
  if (!rating) throw new DomainError('bad', 'Velg en samlet vurdering (1–5 stjerner).');
  const cats = Object.fromEntries(CATEGORIES.map(c => [c, star(input[c])]));
  const publicText = clean(input.public_text, 2000);
  const privateText = clean(input.private_feedback, 2000);
  const consent = input.consent_publish === true || input.consent_publish === 'on' || input.consent_publish === '1';
  const lang = input.lang === 'en' ? 'en' : 'no';
  return tx(async c => {
    const m = (await one<{ name: string; email: string }>(`SELECT name, email FROM users WHERE id=$1`, [memberId], c))!;
    const first = m.name.trim().split(/\s+/)[0] || m.name;
    const r = await one<{ id: string }>(
      `INSERT INTO reviews (source, booking_id, member_id, property_id, author_name, stay_month, rating, rating_cleanliness, rating_accuracy, rating_checkin,
         rating_communication, rating_location, rating_value, public_text, private_feedback, consent_publish, lang, created_by_user_id)
       VALUES ('retreat_club',$1,$2,$3,$4, date_trunc('month', $5::date)::date, $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$2)
       ON CONFLICT (booking_id) DO NOTHING RETURNING id`,
      [bookingId, memberId, b.property_id, first, b.end_date, rating, cats.cleanliness, cats.accuracy, cats.checkin, cats.communication, cats.location, cats.value,
        publicText || null, privateText || null, consent, lang], c);
    if (!r) throw new DomainError('already', 'Du har allerede gitt en omtale for dette oppholdet. Takk!');
    await audit(c, { id: memberId, type: 'member' }, 'review.submitted', 'review', r.id, undefined, { rating, booking: b.reference });
    await notifyAdmins({ type: 'review_submitted', dedupeKey: `review_submitted:${r.id}`,
      subject: `${rating <= 3 ? '⚠ ' : ''}Ny omtale ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} fra ${m.name} (${b.reference})`,
      body: `${publicText ? `«${publicText.slice(0, 400)}»\n\n` : ''}${privateText ? `Til dere (ikke offentlig): «${privateText.slice(0, 400)}»\n\n` : ''}${consent ? 'Kan vises på nettsiden.' : 'Ikke samtykke til visning på nettsiden.'}\n${appUrl('/admin/omtaler')}` }, c);
    return r.id;
  });
}

/** Job: ask for a review two days after check-out, and remind once a week later. */
export async function sendReviewRequests(): Promise<number> {
  const today = todayOslo();
  const due = await q<{ id: string; reference: string; member_id: string; name: string; email: string; lang: string | null; reminded: boolean; property: string }>(
    `SELECT b.id, b.reference, b.member_id, u.name, u.email, u.preferred_lang AS lang, (b.review_requested_at IS NOT NULL) AS reminded, p.name AS property
     FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id
     WHERE b.status='completed' AND u.status='active' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id=b.id)
       AND b.end_date >= $1::date - $4::int
       AND ((b.review_requested_at IS NULL AND b.end_date <= $1::date - $2::int)
         OR (b.review_requested_at IS NOT NULL AND b.review_reminded_at IS NULL AND b.review_requested_at <= now() - make_interval(days => $3)))`,
    [today, REQUEST_AFTER_DAYS, REMIND_AFTER_DAYS, ASK_WITHIN_DAYS]);
  for (const b of due) {
    const en = b.lang === 'en';
    const link = appUrl(`/medlem/bookinger/${b.id}/omtale`);
    const first = b.name.split(' ')[0];
    await enqueue({ userId: b.member_id, to: b.email, type: 'review_request', dedupeKey: `review_${b.reminded ? 'reminder' : 'request'}:${b.id}`,
      subject: en ? (b.reminded ? `A quick reminder: how was your stay at ${b.property}?` : `How was your stay at ${b.property}?`)
                  : (b.reminded ? `En liten påminnelse: hvordan var oppholdet på ${b.property}?` : `Hvordan var oppholdet på ${b.property}?`),
      body: en
        ? `Hi ${first}!\n\nThank you for staying with us. We would love to hear how it went – it takes about a minute, and it helps us make the next stay even better.\n\nGive a review: ${link}\n\nWarm regards,\nMountain Retreat`
        : `Hei ${first}!\n\nTakk for at du bodde hos oss. Vi vil gjerne høre hvordan oppholdet var – det tar omtrent ett minutt, og hjelper oss å gjøre neste opphold enda bedre.\n\nGi en omtale: ${link}\n\nVarm hilsen\nMountain Retreat` });
    await getPool().query(b.reminded ? `UPDATE bookings SET review_reminded_at=now() WHERE id=$1` : `UPDATE bookings SET review_requested_at=now() WHERE id=$1`, [b.id]);
  }
  return due.length;
}

// ------------------------------------------------------------------ administrator

export async function addAirbnbReview(input: Record<string, unknown>, actor: Actor) {
  const rating = star(input.rating);
  const name = clean(input.author_name, 80);
  const text = clean(input.public_text, 3000);
  if (!rating || !name || !text) throw new DomainError('bad', 'Fyll inn navn, stjerner og teksten fra Airbnb.');
  const month = /^\d{4}-\d{2}$/.test(String(input.stay_month ?? '')) ? `${input.stay_month}-01` : null;
  const prop = clean(input.property_id, 40) || null;
  const r = await one<{ id: string }>(
    `INSERT INTO reviews (source, property_id, author_name, stay_month, rating, public_text, lang, created_by_user_id)
     VALUES ('airbnb', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [prop, name, month, rating, text, input.lang === 'en' ? 'en' : 'no', actor.id]);
  await audit(null, actor, 'review.airbnb_added', 'review', r!.id, undefined, { rating, name });
  return r!.id;
}

export async function updateReview(id: string, input: Record<string, unknown>, actor: Actor) {
  const r = await one<{ source: string; consent_publish: boolean; public_text: string | null; featured: boolean; status: string }>(
    `SELECT source, consent_publish, public_text, featured, status FROM reviews WHERE id=$1`, [id]);
  if (!r) throw new DomainError('not_found', 'Fant ikke omtalen.');
  const featured = input.featured === undefined ? r.featured : input.featured === '1' || input.featured === true;
  const status = input.status === 'hidden' || input.status === 'published' ? input.status : r.status;
  if (featured && (status !== 'published' || !r.public_text)) throw new DomainError('bad', 'Bare publiserte omtaler med tekst kan vises på forsiden.');
  if (featured && r.source === 'retreat_club' && !r.consent_publish) throw new DomainError('bad', 'Gjesten har ikke samtykket til at omtalen vises på nettsiden.');
  const author = input.author_name === undefined ? undefined : clean(input.author_name, 80);
  const reply = input.host_reply === undefined ? undefined : clean(input.host_reply, 2000);
  const order = input.featured_order === undefined ? undefined : Math.max(0, Math.min(999, Number(input.featured_order) || 100));
  await getPool().query(
    `UPDATE reviews SET featured=$2, status=$3, author_name=COALESCE($4, author_name), host_reply=COALESCE($5, host_reply), featured_order=COALESCE($6, featured_order), updated_at=now() WHERE id=$1`,
    [id, featured && status === 'published', status, author || null, reply === undefined ? null : reply, order ?? null]);
  await audit(null, actor, 'review.updated', 'review', id, { featured: r.featured, status: r.status }, { featured, status });
}

export async function reviewStats(db: Db = getPool()) {
  return one<{ n: number; avg: string | null; rc: number; airbnb: number; rc_avg: string | null; featured: number }>(
    `SELECT count(*)::int AS n, round(avg(rating)::numeric, 2)::text AS avg,
            count(*) FILTER (WHERE source='retreat_club')::int AS rc, count(*) FILTER (WHERE source='airbnb')::int AS airbnb,
            round(avg(rating) FILTER (WHERE source='retreat_club')::numeric, 2)::text AS rc_avg, count(*) FILTER (WHERE featured)::int AS featured
     FROM reviews WHERE status='published'`, [], db);
}

/** For the front page: the chosen reviews, best first. */
export async function featuredReviews(limit = 6) {
  return q<{ id: string; source: string; author_name: string; stay_month: string | null; rating: number; public_text: string; host_reply: string | null }>(
    `SELECT id, source, author_name, to_char(stay_month,'YYYY-MM') AS stay_month, rating, public_text, host_reply
     FROM reviews WHERE featured AND status='published' AND public_text IS NOT NULL ORDER BY featured_order, created_at DESC LIMIT $1`, [limit]);
}
