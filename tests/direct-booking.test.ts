import { describe, it, expect, afterEach } from 'vitest';
import { getPool, one, q } from '../lib/db';
import { user, property, d } from './factory';
import { requestBooking, sendHoldReminders } from '../lib/domain/bookings';
import { createManualBlock } from '../lib/domain/availability';

const setAuto = (v: '0' | '1') => getPool().query(`INSERT INTO platform_settings (key, value) VALUES ('booking_auto_approve',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [v]);
const req = (m: any, pid: string, s: number, e: number) =>
  requestBooking(m, { propertyId: pid, startDate: d(s), endDate: d(e), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });

describe('direct booking (booking_auto_approve)', () => {
  afterEach(() => setAuto('0'));

  it('on: booking goes straight to awaiting payment with dates held and price locked', async () => {
    await setAuto('1');
    await user('admin');
    const m = await user('member', { invite_tier: 'admin_invited' });
    const pid = await property();
    const b = await req(m, pid, 30, 33);
    expect(b.status).toBe('awaiting_payment');
    const row = await one<any>('SELECT status, price_locked_at, approved_at FROM bookings WHERE id=$1', [b.id]);
    expect(row.status).toBe('awaiting_payment');
    expect(row.price_locked_at).not.toBeNull();
    expect(await one(`SELECT 1 FROM availability_blocks WHERE reference_id=$1`, [b.id])).not.toBeNull();
    expect(await one(`SELECT 1 FROM booking_holds WHERE booking_id=$1 AND released_at IS NULL`, [b.id])).not.toBeNull();
    const mails = await q<{ type: string; subject: string }>(`SELECT type, subject FROM notifications WHERE dedupe_key LIKE '%' || $1 || '%'`, [b.id]);
    expect(mails.map(x => x.type)).toContain('booking_approved');
    expect(mails.map(x => x.type)).not.toContain('booking_request_received');
    expect(mails.find(x => x.type === 'booking_requested')?.subject).toMatch(/Ny booking/);
  });

  it('on: the same dates cannot be booked twice', async () => {
    await setAuto('1');
    const m1 = await user('member', { invite_tier: 'admin_invited' }), m2 = await user('member', { invite_tier: 'admin_invited' });
    const pid = await property();
    await req(m1, pid, 40, 43);
    await expect(req(m2, pid, 41, 44)).rejects.toThrow(/ikke ledige/);
  });

  it('off: booking waits for approval as before', async () => {
    await setAuto('0');
    const m = await user('member', { invite_tier: 'admin_invited' });
    const pid = await property();
    const b = await req(m, pid, 50, 52);
    expect(b.status).toBe('pending_review');
    expect(await one(`SELECT 1 FROM availability_blocks WHERE reference_id=$1`, [b.id])).toBeNull();
  });

  it('1-hour deadline: no reminder right away, one reminder when ~20 minutes are left', async () => {
    await setAuto('1');
    const m = await user('member', { invite_tier: 'admin_invited' });
    const pid = await property();
    const b = await req(m, pid, 60, 62);
    const h = await one<any>(`SELECT hold_duration_hours_at_creation AS hh, expires_at - created_at AS len FROM booking_holds WHERE booking_id=$1`, [b.id]);
    expect(h.hh).toBe(1);
    const count = async () => (await q(`SELECT 1 FROM notifications WHERE type='payment_reminder' AND dedupe_key LIKE '%' || $1 || '%'`, [b.id])).length;
    await sendHoldReminders();
    expect(await count()).toBe(0);
    await getPool().query(`UPDATE booking_holds SET expires_at = now() + interval '15 minutes' WHERE booking_id=$1`, [b.id]);
    await sendHoldReminders(); await sendHoldReminders();
    expect(await count()).toBe(1);
  });
});
