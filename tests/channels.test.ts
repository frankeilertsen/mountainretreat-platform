import { describe, it, expect } from 'vitest';
import { getPool, one } from '../lib/db';
import { user, property, d } from './factory';
import { parseIcal, buildIcal } from '../lib/channels/ical';
import { applySnapshot, createConnection, exportFeed, syncConnection } from '../lib/channels/sync';
import { approveBooking, requestBooking } from '../lib/domain/bookings';
import { adapterFor } from '../lib/channels/sync';

const ics = (events: [string, string, string][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Airbnb Inc//Hosting Calendar//EN',
  ...events.flatMap(([uid, s, e]) => ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.replace(/-/g, '')}`, `UID:${uid}`, 'SUMMARY:Reserved', 'END:VEVENT']),
  'END:VCALENDAR'].join('\r\n');

async function conn(pid: string, channel = 'airbnb', name = 'Airbnb') {
  const admin = await user('admin');
  const c = await createConnection({ propertyId: pid, channel, displayName: name, mode: 'ical_import', icalUrl: 'https://example.invalid/cal.ics' }, { id: admin.id, type: 'admin' });
  return { id: c.id, property_id: pid, channel, display_name: name, integration_mode: 'ical_import', ical_url: 'https://example.invalid/cal.ics', config: {} };
}

describe('iCal channel sync', () => {
  it('parses all-day events and rejects garbage', () => {
    const ev = parseIcal(ics([['a@airbnb', '2027-01-10', '2027-01-14']]));
    expect(ev).toEqual([{ uid: 'a@airbnb', start: '2027-01-10', end: '2027-01-14', summary: 'Reserved' }]);
    expect(() => parseIcal('<html>maintenance</html>')).toThrow();
  });

  it('import blocks dates; a disappearing event (channel cancellation) frees them', async () => {
    const pid = await property();
    const c = await conn(pid);
    await applySnapshot(c, parseIcal(ics([['r1', d(10), d(13)], ['r2', d(20), d(22)]])));
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM availability_blocks WHERE property_id=$1 AND block_type='external_sync'`, [pid]))!.n).toBe(2);
    expect(await one(`SELECT 1 FROM cleaning_tasks WHERE property_id=$1 AND channel_name='Airbnb' AND task_type='turnover'`, [pid])).toBeTruthy();
    await applySnapshot(c, parseIcal(ics([['r2', d(20), d(22)]])));
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM availability_blocks WHERE property_id=$1`, [pid]))!.n).toBe(1);
    expect((await one(`SELECT sync_state FROM external_calendar_events WHERE uid='r1' AND connection_id=$1`, [c.id])).sync_state).toBe('removed');
  });

  it('an external booking overlapping a platform booking is flagged as a conflict and alerts admins', async () => {
    const pid = await property();
    const admin = await user('admin');
    const m = await user('member', { invite_tier: 'admin_invited' });
    const b = await requestBooking(m, { propertyId: pid, startDate: d(30), endDate: d(33), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
    await approveBooking(b.id, { id: admin.id, type: 'admin' });
    const c = await conn(pid);
    const r = await applySnapshot(c, parseIcal(ics([['x', d(32), d(35)]])));
    expect(r.conflicts).toBe(1);
    expect(await one(`SELECT 1 FROM notifications WHERE type='channel_conflict'`)).toBeTruthy();
  });

  it('our own dates echoed back via another channel are recognised (no false alarm)', async () => {
    const pid = await property();
    const airbnb = await conn(pid, 'airbnb', 'Airbnb');
    const booking = await conn(pid, 'booking_com', 'Booking.com');
    await applySnapshot(airbnb, parseIcal(ics([['a1', d(40), d(44)]])));
    const r = await applySnapshot(booking, parseIcal(ics([['bk-echo', d(40), d(44)]])));
    expect(r.conflicts).toBe(0);
    expect((await one(`SELECT sync_state FROM external_calendar_events WHERE uid='bk-echo'`)).sync_state).toBe('echo');
  });

  it('a failing fetch keeps existing blocks and counts failures', async () => {
    const pid = await property();
    const c = await conn(pid);
    await applySnapshot(c, parseIcal(ics([['keep', d(50), d(52)]])));
    await expect(syncConnection(c.id)).rejects.toThrow(/Synk feilet/); // example.invalid can't resolve
    expect(await one(`SELECT 1 FROM availability_blocks WHERE property_id=$1`, [pid])).toBeTruthy();
    expect((await one('SELECT consecutive_failures, last_sync_status FROM channel_connections WHERE id=$1', [c.id]))).toMatchObject({ consecutive_failures: 1, last_sync_status: 'failure' });
  });

  it('export feed contains our blocks but never echoes a channel’s own bookings back to it', async () => {
    const pid = await property();
    const admin = await user('admin');
    const airbnb = await conn(pid, 'airbnb', 'Airbnb');
    const vrbo = await conn(pid, 'vrbo', 'Vrbo');
    await applySnapshot(airbnb, parseIcal(ics([['a', d(60), d(62)]])));
    await applySnapshot(vrbo, parseIcal(ics([['v', d(70), d(72)]])));
    await getPool().query(`INSERT INTO availability_blocks (property_id, date_range, block_type, reason) VALUES ($1, daterange($2::date,$3::date), 'manual_admin', 'x')`, [pid, d(80), d(81)]);
    const exp = await createConnection({ propertyId: pid, channel: 'airbnb', displayName: 'Airbnb export', mode: 'ical_export' }, { id: admin.id, type: 'admin' });
    const feed = (await exportFeed(exp.exportToken!))!;
    const events = parseIcal(feed);
    expect(events.map(e => e.start).sort()).toEqual([d(70), d(80)].sort()); // Vrbo + manual, not Airbnb's own
    expect(feed).not.toMatch(/Reserved|@test\.no/); // only "Blocked", no personal data
    expect(await exportFeed('wrong-token')).toBeNull();
    expect((await one('SELECT last_fetched_at FROM channel_connections WHERE id=$1', [exp.id])).last_fetched_at).not.toBeNull();
  });

  it('channel-manager adapters honestly report that they are not active', () => {
    const cap = adapterFor({ integration_mode: 'channel_manager', channel: 'guesty' }).capability();
    expect(cap.status).toBe('requires_credentials');
    expect(buildIcal('X', [])).toMatch(/BEGIN:VCALENDAR/);
  });
});
