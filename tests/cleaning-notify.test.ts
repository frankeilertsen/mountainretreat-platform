import { describe, it, expect } from 'vitest';
import { getPool, one, q } from '../lib/db';
import { user, property, d } from './factory';
import { createHelperInvitation, acceptInvitation } from '../lib/domain/invitations';
import { requestBooking, approveBooking, handlePaymentSucceeded } from '../lib/domain/bookings';
import { sameDayCleaningReminders } from '../lib/domain/cleaning';

describe('cleaner accounts and notifications', () => {
  it('admin invites a cleaner; she registers with name, phone and e-mail and is assigned to the property', async () => {
    const admin = await user('admin');
    const pid = await property();
    const { link } = await createHelperInvitation(admin, { email: 'Vera@Vask.no', name: 'Vera', propertyId: pid }, { id: admin.id, type: 'admin' });
    const token = link.split('/').pop()!;
    await expect(acceptInvitation(token, { name: 'Vera Vask' }, null, null)).rejects.toThrow(/Mobilnummer/);
    const r = await acceptInvitation(token, { name: 'Vera Vask', phone: '912 34 567' }, null, null);
    const u = await one('SELECT name, email, phone, system_role FROM users WHERE id=$1', [r.userId]);
    expect(u).toMatchObject({ name: 'Vera Vask', email: 'vera@vask.no', phone: '91234567', system_role: 'helper' });
    expect(await one('SELECT 1 FROM helper_property_assignments WHERE helper_user_id=$1 AND property_id=$2 AND active', [r.userId, pid])).toBeTruthy();
    expect(await one('SELECT 1 FROM referrals WHERE referred_user_id=$1', [r.userId])).toBeNull(); // cleaners are not part of the referral programme
  });

  it('a new confirmed booking notifies the property cleaners by e-mail and SMS; same-day reminder is sent once', async () => {
    const admin = await user('admin');
    const pid = await property();
    const h = await user('helper', { phone: '+4790000099' });
    const optedOut = await user('helper', { phone: '+4790000098', notify_sms: false });
    await getPool().query(`INSERT INTO helper_property_assignments (helper_user_id, property_id) VALUES ($1,$3),($2,$3)`, [h.id, optedOut.id, pid]);
    const m = await user('member', { invite_tier: 'admin_invited' });
    const b = await requestBooking(m, { propertyId: pid, startDate: d(3), endDate: d(5), adults: 2, children: 1, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
    await approveBooking(b.id, { id: admin.id, type: 'admin' });
    const p = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) VALUES ($1,'stripe_card','mock',1,'n1') RETURNING id`, [b.id]);
    await handlePaymentSucceeded(p!.id);
    const sent = await q<{ user_id: string; channel: string; subject: string; body: string }>(`SELECT user_id, channel, subject, body FROM notifications WHERE type='cleaning_task' AND user_id = ANY($1)`, [[h.id, optedOut.id]]);
    expect(sent.filter(n => n.user_id === h.id).map(n => n.channel).sort()).toEqual(['email', 'email', 'sms', 'sms']); // turnover + preparation task
    expect(sent.some(n => n.user_id === optedOut.id && n.channel === 'sms')).toBe(false);
    expect(sent.find(n => n.channel === 'sms')!.body).toMatch(/Ny booking/);
    expect(sent.map(n => n.body).join(' ')).not.toMatch(new RegExp(m.name)); // no guest names to cleaners

    // Move the turnover task to today and run the same-day reminder twice
    await getPool().query(`UPDATE cleaning_tasks SET checkout_date = current_date WHERE booking_id=$1 AND task_type='turnover'`, [b.id]);
    await sameDayCleaningReminders(0); await sameDayCleaningReminders(0);
    const reminders = await q(`SELECT channel FROM notifications WHERE user_id=$1 AND subject LIKE 'I dag:%'`, [h.id]);
    expect(reminders.map(r => r.channel).sort()).toEqual(['email', 'sms']);
  });
});
