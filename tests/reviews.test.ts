import { describe, it, expect } from 'vitest';
import { user, property, d } from './factory';
import { getPool, one, q } from '../lib/db';
import { approveBooking, requestBooking, handlePaymentSucceeded } from '../lib/domain/bookings';
import { submitReview, sendReviewRequests, addAirbnbReview, updateReview, featuredReviews } from '../lib/domain/reviews';

async function completedStay(endDaysAgo: number) {
  const admin = await user('admin');
  const pid = await property();
  const m = await user('member', { invite_tier: 'admin_invited', name: 'Kari Nordmann' });
  const b = await requestBooking(m, { propertyId: pid, startDate: d(100), endDate: d(103), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
  await approveBooking(b.id, { id: admin.id, type: 'admin' });
  const p = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) VALUES ($1,'stripe_card','mock',1,$2) RETURNING id`, [b.id, `rv_${b.id}`]);
  await handlePaymentSucceeded(p!.id);
  // move the stay into the past and mark it completed
  await getPool().query(`DELETE FROM availability_blocks WHERE reference_id=$1`, [b.id]);
  await getPool().query(`UPDATE bookings SET start_date=$2::date - 3, end_date=$2::date, status='completed', completed_at=now() WHERE id=$1`, [b.id, d(-endDaysAgo)]);
  return { b, m, admin, pid };
}

describe('reviews (omtaler)', () => {
  it('asks two days after check-out, reminds once a week later, never twice; stops when reviewed', async () => {
    const early = await completedStay(1);
    const { b, m } = await completedStay(2);
    await sendReviewRequests();
    const sentFor = async (id: string) => (await q(`SELECT 1 FROM notifications WHERE type='review_request' AND dedupe_key LIKE $1`, [`review_%:${id}%`])).length;
    expect(await sentFor(early.b.id)).toBe(0);
    expect(await sentFor(b.id)).toBe(1);
    const mail = (await one<{ body: string }>(`SELECT body FROM notifications WHERE type='review_request' AND dedupe_key LIKE $1`, [`review_request:${b.id}%`]))!;
    expect(mail.body).toContain(`/medlem/bookinger/${b.id}/omtale`);
    await sendReviewRequests();
    expect(await sentFor(b.id)).toBe(1);
    await getPool().query(`UPDATE bookings SET review_requested_at = now() - interval '8 days' WHERE id=$1`, [b.id]);
    await sendReviewRequests();
    expect(await sentFor(b.id)).toBe(2);
    await sendReviewRequests();
    expect(await sentFor(b.id)).toBe(2);

    await submitReview(m.id, b.id, { rating: '5', cleanliness: '5', value: '4', public_text: 'Fantastisk utsikt og varm hytte!', private_feedback: 'Litt lite ved', consent_publish: 'on' });
    const r = (await one<any>(`SELECT * FROM reviews WHERE booking_id=$1`, [b.id]))!;
    expect(r).toMatchObject({ source: 'retreat_club', rating: 5, rating_cleanliness: 5, rating_value: 4, rating_accuracy: null, author_name: 'Kari', consent_publish: true, member_id: m.id });
    expect((await q(`SELECT 1 FROM notifications WHERE type='review_submitted' AND body LIKE '%Litt lite ved%'`)).length).toBeGreaterThan(0);
    await expect(submitReview(m.id, b.id, { rating: '4' })).rejects.toThrow(/allerede/);
  });

  it('only the guest can review, only after the stay, and a rating is required', async () => {
    const { b, m } = await completedStay(3);
    const other = await user('member', { invite_tier: 'admin_invited' });
    await expect(submitReview(other.id, b.id, { rating: '5' })).rejects.toThrow();
    await expect(submitReview(m.id, b.id, { rating: '0' })).rejects.toThrow(/samlet vurdering/);
    await getPool().query(`UPDATE bookings SET status='confirmed' WHERE id=$1`, [b.id]);
    await expect(submitReview(m.id, b.id, { rating: '5' })).rejects.toThrow(/gjennomført/);
  });

  it('front page shows only chosen reviews; members without consent cannot be shown; Airbnb reviews can be added', async () => {
    const { b, m, admin, pid } = await completedStay(4);
    const id = await submitReview(m.id, b.id, { rating: '4', public_text: 'Fint, men ikke på nettsiden', consent_publish: '' });
    await expect(updateReview(id, { featured: '1' }, { id: admin.id, type: 'admin' })).rejects.toThrow(/samtykket/);

    const air = await addAirbnbReview({ author_name: 'Sophie', rating: '5', stay_month: '2026-02', property_id: pid, public_text: 'Perfect ski-in/ski-out location!', lang: 'en' }, { id: admin.id, type: 'admin' });
    expect((await featuredReviews()).some(r => r.id === air)).toBe(false);
    await updateReview(air, { featured: '1', featured_order: '1' }, { id: admin.id, type: 'admin' });
    const shown = await featuredReviews();
    expect(shown.find(r => r.id === air)).toMatchObject({ source: 'airbnb', author_name: 'Sophie', stay_month: '2026-02', rating: 5 });
    await updateReview(air, { status: 'hidden', featured: '0' }, { id: admin.id, type: 'admin' });
    expect((await featuredReviews()).some(r => r.id === air)).toBe(false);
  });
});
