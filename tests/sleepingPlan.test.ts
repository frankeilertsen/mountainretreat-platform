import { describe, it, expect } from 'vitest';
import { getPool, one, q } from '../lib/db';
import { user, property, d } from './factory';
import { requestBooking, approveBooking, handlePaymentSucceeded } from '../lib/domain/bookings';
import { saveMemberPlan, sendSleepPlanRequests, memberPlanContext } from '../lib/domain/sleepingPlan';
import { roomPlanForPreparation } from '../lib/domain/cleaning';

async function setup(start: number, ownLinen: number) {
  const pid = await property();
  await getPool().query(`UPDATE properties SET own_linen_discount_ore=7500 WHERE id=$1`, [pid]);
  const r1 = (await one<{ id: string }>(`INSERT INTO rooms (property_id, name, max_capacity, sort_order) VALUES ($1,'Hovedsoverom',2,1) RETURNING id`, [pid]))!.id;
  const r2 = (await one<{ id: string }>(`INSERT INTO rooms (property_id, name, max_capacity, sort_order) VALUES ($1,'Lite soverom',2,2) RETURNING id`, [pid]))!.id;
  const beds = await q<{ id: string; label: string }>(`INSERT INTO beds (property_id, room_id, label, bed_type, sleeps, allocation_priority, children_only) VALUES
     ($1,$2,'Dobbel','double',2,10,false),($1,$3,'Nedre','bunk_lower',1,20,false),($1,$3,'Øvre','bunk_upper',1,30,true) RETURNING id, label`, [pid, r1, r2]);
  const admin = await user('admin');
  const m = await user('member', { invite_tier: 'admin_invited' });
  const b = await requestBooking(m, { propertyId: pid, startDate: d(start), endDate: d(start + 3), adults: 2, children: 2, infants: 0, addOns: [], ownLinen }, { id: m.id, type: 'member' });
  await approveBooking(b.id, { id: admin.id, type: 'admin' });
  const p = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) VALUES ($1,'stripe_card','mock',1,$2) RETURNING id`, [b.id, `sp_${b.id}`]);
  await handlePaymentSucceeded(p!.id);
  const bed = (l: string) => beds.find(x => x.label === l)!.id;
  return { b, m, bed };
}

describe('member sleeping plan and partial own linen', () => {
  it('partial own linen: 2 of 4 guests save 2 × 75 kr; member marks which beds; cleaner sees it', async () => {
    const { b, m, bed } = await setup(40, 2);
    const row = (await one<any>(`SELECT own_linen_persons, price_breakdown FROM bookings WHERE id=$1`, [b.id]))!;
    expect(row.own_linen_persons).toBe(2);
    expect(row.price_breakdown.quote.own_linen_discount_ore).toBe(15000);
    const actor = { id: m.id, type: 'member' as const };
    // 1 child placed in the upper bunk is fine; too few people is not
    await expect(saveMemberPlan(b.id, m.id, [{ bed_id: bed('Dobbel'), persons: 2, ownLinen: true }], actor)).rejects.toThrow(/Alle 4/);
    // own linen must match the 2 who bring it
    await expect(saveMemberPlan(b.id, m.id, [{ bed_id: bed('Dobbel'), persons: 2, ownLinen: false }, { bed_id: bed('Nedre'), persons: 1, ownLinen: false }, { bed_id: bed('Øvre'), persons: 1, ownLinen: false }], actor)).rejects.toThrow(/eget sengetøy/);
    await saveMemberPlan(b.id, m.id, [{ bed_id: bed('Dobbel'), persons: 2, ownLinen: true }, { bed_id: bed('Nedre'), persons: 1, ownLinen: false }, { bed_id: bed('Øvre'), persons: 1, ownLinen: false }], actor);
    const ctx = await memberPlanContext(b.id, m.id);
    expect(ctx.plan.source).toBe('member');
    const prep = (await one<{ id: string; property_id: string }>(`SELECT id, property_id FROM stay_preparations WHERE booking_id=$1`, [b.id]))!;
    const plan = await roomPlanForPreparation(prep.id, prep.property_id);
    const main = plan.rooms.find(r => r.name === 'Hovedsoverom')!;
    expect(main.beds[0].allocation).toMatchObject({ persons: 2, linen: false });
    expect(main.supplies.sheets).toBe(0);
    expect(plan.rooms.find(r => r.name === 'Lite soverom')!.supplies.sheets).toBe(2);
  });

  it('asks 7 days before arrival, reminds 4 days later, not when everyone brings linen or a plan is set', async () => {
    const a = await setup(6, 0);
    const all = await setup(6, 4);
    await sendSleepPlanRequests();
    const sent = async (id: string) => (await q(`SELECT 1 FROM notifications WHERE type='sleep_plan_request' AND dedupe_key LIKE $1`, [`sleep_plan_%:${id}`])).length;
    expect(await sent(a.b.id)).toBe(1);
    expect(await sent(all.b.id)).toBe(0);
    const body = (await one<{ body: string }>(`SELECT body FROM notifications WHERE dedupe_key=$1`, [`sleep_plan_request:${a.b.id}`]))!.body;
    expect(body).toContain(`/medlem/bookinger/${a.b.id}/soveplan`);
    await sendSleepPlanRequests();
    expect(await sent(a.b.id)).toBe(1);
    await getPool().query(`UPDATE bookings SET sleep_plan_requested_at = now() - interval '5 days' WHERE id=$1`, [a.b.id]);
    await sendSleepPlanRequests();
    expect(await sent(a.b.id)).toBe(2);
    await sendSleepPlanRequests();
    expect(await sent(a.b.id)).toBe(2);
  });
});
