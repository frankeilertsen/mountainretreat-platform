import './load-env';
import { getPool, one, q, tx } from '../lib/db';
import { humanCode, hashToken, randomToken } from '../lib/crypto';
import { addDays, todayOslo } from '../lib/format';
import { SYSTEM } from '../lib/audit';
import { approveBooking, handlePaymentSucceeded, requestBooking } from '../lib/domain/bookings';
import { qualifyReferralForBooking } from '../lib/domain/rewards';
import { reconcileCleaningTasks, upsertBookingPreparation } from '../lib/domain/cleaning';
import { applySnapshot } from '../lib/channels/sync';

/**
 * Test data for every role and workflow. Log in via /login → "Utviklerinnlogging" (DEV_LOGIN=1),
 * or with a magic link (printed in the server log when no email provider is configured).
 */
export async function seed() {
  const db = getPool();
  const exists = await one(`SELECT 1 FROM users LIMIT 1`);
  if (exists) { console.log('Database already has users – skipping seed. Use `npm run db:reset` for a fresh start.'); return; }
  const today = todayOslo();

  const mkUser = async (email: string, name: string, role: string, extra: Record<string, unknown> = {}) => {
    const cols = ['email', 'name', 'system_role', 'status', 'referral_code', ...Object.keys(extra)];
    const vals = [email, name, role, 'active', humanCode(8), ...Object.values(extra)];
    return (await one<{ id: string }>(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, vals))!.id;
  };
  const superAdmin = await mkUser('admin@fkeproperty.test', 'Frank (Super Admin)', 'super_admin', { phone: '+47 900 00 001' });
  const propAdmin = await mkUser('eiendom@fkeproperty.test', 'Eva Eiendomsadmin', 'admin');
  const kari = await mkUser('kari@example.test', 'Kari Nordmann', 'member', { invite_tier: 'admin_invited', invited_by_user_id: superAdmin, phone: '+47 900 00 002' });
  const ola = await mkUser('ola@example.test', 'Ola Hansen', 'member', { invite_tier: 'member_invited', loyalty_status: 'can_apply', invited_by_user_id: kari });
  const lise = await mkUser('lise@example.test', 'Lise Berg', 'member', { invite_tier: 'member_invited', loyalty_status: 'applied', invited_by_user_id: kari });
  const helper = await mkUser('renhold@fkeproperty.test', 'Rita Renhold', 'helper', { phone: '+47 900 00 010' });
  const helper2 = await mkUser('renhold2@fkeproperty.test', 'Rune Renhold', 'helper', { cleaning_scope: 'all', phone: '+47 900 00 011' });

  // Invitations + referral relations for the seeded members
  for (const [inviter, invitee, email] of [[superAdmin, kari, 'kari@example.test'], [kari, ola, 'ola@example.test'], [kari, lise, 'lise@example.test']] as const) {
    const inv = await one<{ id: string }>(`INSERT INTO invitations (inviter_user_id, invitee_email, token_hash, status, expires_at, accepted_at, accepted_user_id)
      VALUES ($1,$2,$3,'accepted', now(), now(), $4) RETURNING id`, [inviter, email, hashToken(randomToken()), invitee]);
    await db.query(`INSERT INTO referrals (referrer_user_id, referred_user_id, invitation_id) VALUES ($1,$2,$3)`, [inviter, invitee, inv!.id]);
  }
  await db.query(`INSERT INTO loyalty_applications (applicant_user_id) VALUES ($1)`, [lise]);
  // A pending cleaner invitation (cleaner registers herself with name, phone, e-mail)
  await db.query(`INSERT INTO invitations (inviter_user_id, invitee_email, invitee_name, role, token_hash, expires_at) VALUES ($1,'vaskehjelp@example.test','Vera','helper',$2, now() + interval '10 days')`, [superAdmin, hashToken('dev-helper-invite')]);
  // A pending invitation from Kari
  await db.query(`INSERT INTO invitations (inviter_user_id, invitee_email, invitee_name, token_hash, expires_at) VALUES ($1,'per@example.test','Per',$2, now() + interval '10 days')`, [kari, hashToken('dev-invite-token-per')]);

  // ---------------- Property 1: the cabin (from the floor plans: 2 floors)
  const cabin = (await one<{ id: string }>(`INSERT INTO properties (slug, name, address, short_description, description, amenities, house_rules, max_guests, check_in_time, check_out_time, cleaning_fee_ore, owner_user_id)
    VALUES ('hytta', 'Mountain Retreat – Hytta', 'Fjellvegen 12, 6200 Stranda', 'Romslig familiehytte med loftstue og stor veranda.',
    'Lys og luftig hytte over to plan med åpen stue/kjøkken, peis og en 8,6 meter lang veranda med utsikt. Fire soverom og loftstue med sovesofa – plass til åtte.',
    ARRAY['Peis','Veranda','Fullt utstyrt kjøkken','Vaskemaskin','Wi-Fi','Parkering','Barneseng','Skiboks'],
    'Ingen røyking innendørs. Dyr etter avtale. Ro etter kl. 23.', 8, '15:00', '11:00', 120000, $1) RETURNING id`, [superAdmin]))!.id;
  // The cabin follows its Airbnb prices (default). Demo rates: 1 800 kr weekdays, 2 300 kr Fri/Sat, 3 200 kr Christmas.
  for (let i = -2; i < 400; i++) {
    const d = addDays(today, i); const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    const price = d >= '2026-12-21' && d <= '2027-01-01' ? 320000 : wd === 5 || wd === 6 ? 230000 : 180000;
    await db.query(`INSERT INTO external_nightly_rates (property_id, date, price_ore, source) VALUES ($1,$2,$3,'manual_entry')`, [cabin, d, price]);
  }
  const room = async (pid: string, name: string, floor: string, desc: string, cap: number, instr: string, order: number) =>
    (await one<{ id: string }>(`INSERT INTO rooms (property_id, name, floor, description, max_capacity, bedding_instructions, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [pid, name, floor, desc, cap, instr, order]))!.id;
  const bed = async (pid: string, roomId: string, label: string, type: string, sleeps: number, prio: number, w?: number, l?: number, kidsOnly = false) =>
    db.query(`INSERT INTO beds (property_id, room_id, label, bed_type, sleeps, allocation_priority, width_cm, length_cm, children_only) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [pid, roomId, label, type, sleeps, prio, w ?? null, l ?? null, kidsOnly]);
  const r1 = await room(cabin, 'Hovedsoverom', '1. etasje', '2,73 × 3,22 m. Ved gangen, ved siden av badet.', 3, 'Dobbeltdyne-trekk 220×220 eller to enkle. Pynteputer i kurven.', 1);
  const r2 = await room(cabin, 'Lite soverom', '1. etasje', '1,76 × 2,17 m. Køyeseng.', 2, 'Øvre køye kun for barn over 6 år.', 2);
  const r3 = await room(cabin, 'Loftsoverom 1', 'Loft', '2,33 × 2,34 m.', 2, 'Sjekk at vinduet er lukket.', 3);
  const r4 = await room(cabin, 'Loftsoverom 2', 'Loft', '2,15 × 2,34 m.', 3, 'Barneseng settes her ved behov.', 4);
  const r5 = await room(cabin, 'Loftstue', 'Loft', '4,59 × 3,43 m. Sovesofa.', 2, 'Sovesofa redes kun når hytta er full.', 5);
  await bed(cabin, r1, 'Dobbeltseng', 'double', 2, 10, 180, 200);
  await bed(cabin, r2, 'Køye nedre', 'bunk_lower', 1, 30, 90, 200);
  await bed(cabin, r2, 'Køye øvre', 'bunk_upper', 1, 40, 90, 200, true);
  await bed(cabin, r3, 'Dobbeltseng', 'double', 2, 20, 150, 200);
  await bed(cabin, r5, 'Sovesofa', 'sofa_bed', 2, 90, 140, 200);
  await bed(cabin, r4, 'Barneseng', 'cot', 1, 50, 60, 120);
  await bed(cabin, r4, 'Ekstra madrass', 'extra_mattress', 1, 95, 80, 190);

  // ---------------- Property 2: example apartment from the brief
  const apt = (await one<{ id: string }>(`INSERT INTO properties (slug, name, address, short_description, description, amenities, max_guests, check_in_time, check_out_time, cleaning_fee_ore, owner_user_id, pricing_mode)
    VALUES ('leilighet-a', 'Leilighet A – Ålesund sentrum', 'Kongens gate 5, 6002 Ålesund', 'Moderne byleilighet med utsikt over Brosundet.',
    'To soverom, åpen stue med sovesofa og balkong. Gangavstand til alt.', ARRAY['Balkong','Wi-Fi','Heis','Oppvaskmaskin'], 5, '16:00', '11:00', 80000, $1, 'manual') RETURNING id`, [superAdmin]))!.id;
  const a1 = await room(apt, 'Soverom 1', '', 'Dobbeltseng.', 2, 'Standard dobbeltseng.', 1);
  const a2 = await room(apt, 'Soverom 2', '', 'Køyeseng.', 2, '', 2);
  const a3 = await room(apt, 'Stue', '', 'Sovesofa.', 2, 'Kun ved behov.', 3);
  await bed(apt, a1, 'Dobbeltseng', 'double', 2, 10, 160, 200);
  await bed(apt, a2, 'Køye nedre', 'bunk_lower', 1, 20);
  await bed(apt, a2, 'Køye øvre', 'bunk_upper', 1, 30, undefined, undefined, true);
  await bed(apt, a3, 'Sovesofa', 'sofa_bed', 2, 90);

  // ---------------- Season pricing
  for (const [pid, low, high, hol] of [[cabin, 180000, 250000, 320000], [apt, 120000, 160000, 200000]] as const) {
    const cat = async (kind: string, name: string, price: number, min: number, color: string) =>
      (await one<{ id: string }>(`INSERT INTO season_categories (property_id, kind, name, price_per_night_ore, min_nights, color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [pid, kind, name, price, min, color]))!.id;
    const lowId = await cat('low_season', 'Lavsesong', low, 2, '#A8B5A2');
    const highId = await cat('high_season', 'Høysesong', high, 4, '#C9A66B');
    const holId = await cat('holiday', 'Ferie', hol, 3, '#B5735A');
    const period = (catId: string, name: string, s: string, e: string, prio: number, mode = 'flexible', wd: number | null = null) =>
      db.query(`INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date, priority, booking_mode, changeover_weekday) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, catId, name, s, e, prio, mode, wd]);
    await period(lowId, 'Grunnsesong 2026–2027', addDays(today, -60), '2027-12-31', 0);
    await period(highId, 'Vintersesong 2027', '2027-02-01', '2027-04-15', 10);
    await period(highId, 'Sommer 2027', '2027-06-15', '2027-08-15', 10, 'fixed_changeover_day', 6);
    await period(holId, 'Jul og nyttår 2026', '2026-12-21', '2027-01-01', 20, 'whole_period');
    await period(holId, 'Påske 2027', '2027-03-20', '2027-03-28', 20, 'whole_period');
    await db.query(`INSERT INTO length_of_stay_discounts (property_id, min_nights, discount_percentage) VALUES ($1,7,10),($1,14,15)`, [pid]);
  }
  await db.query(`INSERT INTO add_on_items (property_id, name, description, price_type, unit_price_ore) VALUES
    (NULL,'Sengetøy og håndklær','Ferdig oppredde senger og håndklær per gjest.','per_guest',15000),
    ($1,'Ved (sekk)','40 liter bjørkeved.','per_unit',12000),
    ($1,'Tidlig innsjekk kl. 12','Etter avtale.','flat',30000)`, [cabin]);

  // ---------------- Channels (iCal). Import URLs are placeholders – replace with the real feed links.
  const conn = async (pid: string, channel: string, name: string, mode: string, url: string | null) =>
    (await one<{ id: string }>(`INSERT INTO channel_connections (property_id, channel, display_name, integration_mode, ical_url, export_token_hash, last_sync_status)
      VALUES ($1,$2,$3,$4,$5,$6,'never') RETURNING id`, [pid, channel, name, mode, url, mode === 'ical_export' ? hashToken(`dev-export-${channel}-${pid.slice(0, 4)}`) : null]))!.id;
  const airbnbImport = await conn(cabin, 'airbnb', 'Airbnb', 'ical_import', 'https://www.airbnb.no/calendar/ical/00000000.ics?s=REPLACE_ME');
  await conn(cabin, 'airbnb', 'Airbnb (eksport)', 'ical_export', null);
  await conn(cabin, 'booking_com', 'Booking.com', 'ical_import', 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=REPLACE_ME');
  await conn(cabin, 'booking_com', 'Booking.com (eksport)', 'ical_export', null);
  await db.query(`UPDATE channel_connections SET active=false WHERE display_name='Booking.com' AND integration_mode='ical_import'`); // placeholder, not active
  await conn(apt, 'airbnb', 'Airbnb', 'ical_import', 'https://www.airbnb.no/calendar/ical/11111111.ics?s=REPLACE_ME');

  // Simulated Airbnb snapshot so the calendar and cleaning portal have external stays
  await applySnapshot({ id: airbnbImport, property_id: cabin, channel: 'airbnb', display_name: 'Airbnb', integration_mode: 'ical_import', ical_url: null, config: {} }, [
    { uid: 'airbnb-demo-1@airbnb.com', start: addDays(today, 12), end: addDays(today, 15), summary: 'Reserved' },
    { uid: 'airbnb-demo-2@airbnb.com', start: addDays(today, 30), end: addDays(today, 34), summary: 'Reserved' },
  ]);

  await db.query(`INSERT INTO helper_property_assignments (helper_user_id, property_id, assigned_by_user_id) VALUES ($1,$2,$3),($4,$5,$3)`, [helper, cabin, superAdmin, helper2, apt]);

  // ---------------- Bookings through the real domain flow
  const asMember = async (id: string) => (await one<any>('SELECT id, email, name, system_role, status, invite_tier, loyalty_status FROM users WHERE id=$1', [id]))!;
  const adminActor = { id: propAdmin, type: 'admin' as const };
  // 1. Kari: confirmed stay in 5 days (3 nights) – paid via mock provider
  const kariM = await asMember(kari);
  const b1 = await requestBooking(kariM, { propertyId: cabin, startDate: addDays(today, 5), endDate: addDays(today, 8), adults: 2, children: 1, infants: 1, addOns: [], specialRequests: 'Vi kommer sent, ca. kl. 21.' }, { id: kari, type: 'member' });
  await approveBooking(b1.id, adminActor);
  const pay = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key, provider_reference) SELECT id, 'stripe_card', 'mock', price_total_ore, 'seed_'||id, 'mock_seed_'||id FROM bookings WHERE id=$1 RETURNING id`, [b1.id]);
  await handlePaymentSucceeded(pay!.id);
  await db.query(`UPDATE stay_preparations SET comment_for_cleaner='Gjestene ønsker ekstra pledd i stua.', expected_arrival_time='21:00' WHERE booking_id=$1`, [b1.id]);
  // 2. Ola: pending request (5 adults → uses sofa bed)
  const olaM = await asMember(ola);
  await requestBooking(olaM, { propertyId: cabin, startDate: addDays(today, 20), endDate: addDays(today, 23), adults: 5, children: 0, infants: 0, addOns: [], specialRequests: 'Bursdagsfeiring!' }, { id: ola, type: 'member' });
  // 3. Lise: approved, awaiting payment
  const liseM = await asMember(lise);
  const b3 = await requestBooking(liseM, { propertyId: apt, startDate: addDays(today, 9), endDate: addDays(today, 12), adults: 2, children: 0, infants: 0, addOns: [] }, { id: lise, type: 'member' });
  await approveBooking(b3.id, adminActor);

  // 4. Ola: completed stay last month → qualifies the referral (Kari + Ola get rewards)
  await tx(async c => {
    const b = await one<{ id: string }>(`INSERT INTO bookings (reference, property_id, member_id, start_date, end_date, adults, status, stay_price_ore, cleaning_fee_ore, price_total_ore, price_locked_at, approved_at, confirmed_at, completed_at)
      VALUES ($1,$2,$3,$4,$5,2,'completed',486000,120000,606000, now(), now(), now(), now()) RETURNING id`, ['MR-' + humanCode(6), cabin, ola, addDays(today, -30), addDays(today, -27)], c);
    await upsertBookingPreparation(c, b!.id, cabin, { adults: 2, children: 0, infants: 0 });
    await c.query(`INSERT INTO payments (booking_id, method, provider, amount_ore, status, idempotency_key) VALUES ($1,'stripe_card','mock',606000,'succeeded','seed_hist')`, [b!.id]);
    await qualifyReferralForBooking(c, b!.id);
    await c.query(`UPDATE reward_credits SET vests_at = now() - interval '1 day', status='available'`);
  });

  // Manual block (owner use)
  await db.query(`INSERT INTO availability_blocks (property_id, date_range, block_type, reason, created_by_user_id) VALUES ($1, daterange($2::date,$3::date,'[)'), 'manual_admin', 'Eiers bruk / vedlikehold', $4)`, [cabin, addDays(today, 40), addDays(today, 44), superAdmin]);
  await tx(async c => { await reconcileCleaningTasks(c, cabin); await reconcileCleaningTasks(c, apt); });
  await db.query(`UPDATE notifications SET status='sent', sent_at=now()`); // don't spam on first start

  console.log(`Seed complete.
  Super admin:     admin@fkeproperty.test
  Property admin:  eiendom@fkeproperty.test
  Members:         kari@example.test (can invite), ola@example.test (invited by Kari), lise@example.test (loyalty pending)
  Cleaning:        renhold@fkeproperty.test (assigned tasks), renhold2@fkeproperty.test (broad access)
  Pending invite:  /invitasjon/dev-invite-token-per (member), /invitasjon/dev-helper-invite (cleaner)
  Export feeds:    /api/ical/dev-export-airbnb-${cabin.slice(0, 4)}.ics`);
}

if (require.main === module) {
  seed().then(() => getPool().end()).catch(e => { console.error(e); process.exit(1); });
}
