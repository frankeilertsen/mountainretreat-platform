'use server';
import { run, str, int, kr, date } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor, audit } from '@/lib/audit';
import { getPool, one, tx } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { savePhoto } from '@/lib/domain/cleaning';
import { setMaxGuests, syncMaxGuests } from '@/lib/domain/capacity';

async function admin() { const u = await assertUser('admin'); return { u, actor: actorFor(u, await clientIp()) }; }
const capacityMsg = (msg: string, c: { maxGuests: number; places: number; clamped: boolean }) =>
  `${msg} ${c.places} sengeplasser – maks ${c.maxGuests} personer.${c.clamped ? ' Maks personer ble redusert fordi det er færre sengeplasser.' : ''}`;
const airbnbUrl = (v: string) => {
  if (!v) return null;
  if (!/^https:\/\/([a-z0-9-]+\.)*airbnb\.[a-z.]+\//i.test(v)) throw new DomainError('url', 'Lim inn en gyldig Airbnb-lenke (https://www.airbnb.no/rooms/…).');
  return v;
};
const back = (id: string, tab = '') => `/admin/boliger/${id}${tab ? '?fane=' + tab : ''}`;
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function createPropertyAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/boliger', async () => {
    const name = str(f, 'name');
    if (name.length < 2) throw new DomainError('name', 'Gi boligen et navn.');
    const id = await tx(async c => {
      const p = await one<{ id: string }>(`INSERT INTO properties (slug, name, address, max_guests, max_guests_mode, owner_user_id) VALUES ($1,$2,$3,$4,'manual',$5) RETURNING id`,
        [slugify(name) + '-' + Math.random().toString(36).slice(2, 6), name, str(f, 'address') || null, Math.max(1, int(f, 'max_guests', 4)), u.id], c);
      // Every property gets the three season groups so pricing can be set right away
      await c.query(`INSERT INTO season_categories (property_id, kind, name, price_per_night_ore, min_nights, color) VALUES ($1,'low_season','Lavsesong',100000,2,'#A8B5A2'),($1,'high_season','Høysesong',150000,3,'#C9A66B'),($1,'holiday','Ferie',200000,3,'#B5735A')`, [p!.id]);
      await audit(c, actor, 'property.created', 'property', p!.id, undefined, { name });
      return p!.id;
    });
    return { redirect: back(id), ok: 'Boligen er opprettet. Fyll inn detaljer, rom og priser.' };
  });
}

export async function updatePropertyAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(back(id), async () => {
    const before = await one('SELECT name, max_guests, cleaning_fee_ore, check_in_time, check_out_time, active FROM properties WHERE id=$1', [id]);
    const amenities = str(f, 'amenities').split(',').map(s => s.trim()).filter(Boolean);
    await getPool().query(`UPDATE properties SET name=$2, address=$3, short_description=$4, description=$5, amenities=$6, house_rules=$7, max_guests=max_guests, max_guests_mode=max_guests_mode, default_min_nights=GREATEST(default_min_nights,$8),
        check_in_time=$9, check_out_time=$10, cleaning_fee_ore=$11, active=$12, included_guests=$13, extra_guest_fee_ore=$14, extra_guest_fee_basis=$15, extra_guest_fee_includes=$16, airbnb_listing_url=$17, updated_at=now() WHERE id=$1`,
      [id, str(f, 'name'), str(f, 'address') || null, str(f, 'short_description') || null, str(f, 'description') || null, amenities, str(f, 'house_rules') || null,
       1, str(f, 'check_in_time') || '15:00', str(f, 'check_out_time') || '11:00', kr(f, 'cleaning_fee') ?? 0, !!f.get('active'), Math.max(1, int(f, 'included_guests', 4)), kr(f, 'extra_guest_fee') ?? 0,
       str(f, 'extra_guest_fee_basis') === 'per_night' ? 'per_night' : 'per_stay', str(f, 'extra_guest_fee_includes') || null, airbnbUrl(str(f, 'airbnb_listing_url'))]);
    const cap = await setMaxGuests(getPool(), id, str(f, 'max_guests_mode') === 'manual' ? 'manual' : 'auto', int(f, 'max_guests', 1));
    await audit(null, actor, 'property.updated', 'property', id, before, Object.fromEntries(f.entries()));
    return `Lagret. Maks ${cap.maxGuests} personer (${cap.places} sengeplasser).`;
  });
}

export async function uploadPhotoAction(f: FormData) {
  const { u, actor } = await admin();
  const entity = str(f, 'entity') as 'property' | 'room'; const id = str(f, 'entityId'); const pid = str(f, 'propertyId');
  await run(back(pid, entity === 'room' ? 'rom' : ''), async () => {
    const file = f.get('photo');
    if (!(file instanceof File) || file.size === 0) throw new DomainError('nofile', 'Velg et bilde.');
    await savePhoto(entity, id, file, u, actor); return 'Bildet er lastet opp.';
  });
}
export async function deletePhotoAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, str(f, 'tab')), async () => {
    await getPool().query(`DELETE FROM photos WHERE id=$1 AND entity_type IN ('property','room')`, [str(f, 'id')]);
    await audit(null, actor, 'photo.deleted', 'photo', str(f, 'id')); return 'Bildet er fjernet.';
  });
}

// ---------------- rooms & beds
export async function saveRoomAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId'); const id = str(f, 'id');
  await run(back(pid, 'rom'), async () => {
    const vals = [str(f, 'name'), str(f, 'floor') || null, str(f, 'description') || null, Math.max(0, int(f, 'max_capacity', 2)), str(f, 'bedding_instructions') || null, int(f, 'sort_order', 0)];
    if (!vals[0]) throw new DomainError('name', 'Romnavn mangler.');
    if (id) await getPool().query(`UPDATE rooms SET name=$2, floor=$3, description=$4, max_capacity=$5, bedding_instructions=$6, sort_order=$7 WHERE id=$1 AND property_id=$8`, [id, ...vals, pid]);
    else await getPool().query(`INSERT INTO rooms (property_id, name, floor, description, max_capacity, bedding_instructions, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, ...vals]);
    await audit(null, actor, id ? 'room.updated' : 'room.created', 'property', pid, undefined, { name: vals[0] });
    return capacityMsg('Rommet er lagret.', await syncMaxGuests(getPool(), pid));
  });
}
export async function deactivateRoomAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'rom'), async () => {
    await getPool().query(`UPDATE rooms SET active=false WHERE id=$1 AND property_id=$2`, [str(f, 'id'), pid]);
    await getPool().query(`UPDATE beds SET active=false WHERE room_id=$1`, [str(f, 'id')]);
    await audit(null, actor, 'room.deactivated', 'property', pid); return capacityMsg('Rommet er fjernet.', await syncMaxGuests(getPool(), pid));
  });
}
export async function saveBedAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId'); const id = str(f, 'id');
  await run(back(pid, 'rom'), async () => {
    const type = str(f, 'bed_type');
    const defaults: Record<string, [number, number]> = { double: [2, 10], single: [1, 20], bunk_lower: [1, 30], bunk_upper: [1, 40], sofa_bed: [2, 90], extra_mattress: [1, 95], cot: [1, 50] };
    if (!defaults[type]) throw new DomainError('type', 'Ugyldig sengetype.');
    const sleeps = int(f, 'sleeps', defaults[type][0]);
    const size = str(f, 'size').match(/^(\d{2,3})x(\d{2,3})$/);
    const vals = [str(f, 'label') || type, type, sleeps, int(f, 'allocation_priority', defaults[type][1]), size ? Number(size[1]) : (int(f, 'width_cm') || null), size ? Number(size[2]) : (int(f, 'length_cm') || null), !!f.get('children_only') || type === 'bunk_upper' || type === 'cot'];
    if (id) await getPool().query(`UPDATE beds SET label=$2, bed_type=$3, sleeps=$4, allocation_priority=$5, width_cm=$6, length_cm=$7, children_only=$8 WHERE id=$1 AND property_id=$9`, [id, ...vals, pid]);
    else await getPool().query(`INSERT INTO beds (property_id, room_id, label, bed_type, sleeps, allocation_priority, width_cm, length_cm, children_only) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [pid, str(f, 'roomId'), ...vals]);
    await audit(null, actor, id ? 'bed.updated' : 'bed.created', 'property', pid, undefined, { type, sleeps });
    return capacityMsg('Sengen er lagret.', await syncMaxGuests(getPool(), pid));
  });
}
export async function deactivateBedAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'rom'), async () => { await getPool().query(`UPDATE beds SET active=false WHERE id=$1 AND property_id=$2`, [str(f, 'id'), pid]); await audit(null, actor, 'bed.deactivated', 'property', pid); return capacityMsg('Sengen er fjernet.', await syncMaxGuests(getPool(), pid)); });
}

// ---------------- pricing
export async function saveCategoryAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId'); const id = str(f, 'id');
  await run(back(pid, 'priser'), async () => {
    const before = await one('SELECT * FROM season_categories WHERE id=$1', [id]);
    const max = int(f, 'max_nights') || null;
    await getPool().query(`UPDATE season_categories SET name=$2, price_per_night_ore=$3, min_nights=$4, max_nights=$5, color=$6, weekend_price_per_night_ore=$8, updated_at=now() WHERE id=$1 AND property_id=$7`,
      [id, str(f, 'name'), kr(f, 'price') ?? 0, Math.max(1, int(f, 'min_nights', 1)), max, str(f, 'color') || null, pid, kr(f, 'weekend_price') ?? null]);
    await audit(null, actor, 'pricing.category_updated', 'season_category', id, before, Object.fromEntries(f.entries()));
    return 'Sesongpris lagret.';
  });
}
export async function savePeriodAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId'); const id = str(f, 'id');
  await run(back(pid, 'priser'), async () => {
    const mode = str(f, 'booking_mode') || 'flexible';
    const wd = mode === 'fixed_changeover_day' ? int(f, 'changeover_weekday', 6) : null;
    const start = date(f, 'start_date'), end = date(f, 'end_date');
    const prio = int(f, 'priority', 0);
    const overlap = await one(`SELECT name FROM pricing_periods WHERE property_id=$1 AND active AND priority=$2 AND id <> COALESCE(NULLIF($3,'')::uuid,'00000000-0000-0000-0000-000000000000') AND daterange(start_date,end_date,'[]') && daterange($4::date,$5::date,'[]')`, [pid, prio, id, start, end]);
    if (overlap) throw new DomainError('overlap', `Overlapper «${overlap.name}» med samme prioritet. Gi perioden høyere prioritet hvis den skal overstyre.`);
    const vals = [str(f, 'season_category_id'), str(f, 'name'), start, end, kr(f, 'price'), int(f, 'min_nights') || null, int(f, 'max_nights') || null, mode, wd, prio, kr(f, 'weekend_price') ?? null];
    if (id) await getPool().query(`UPDATE pricing_periods SET season_category_id=$2, name=$3, start_date=$4, end_date=$5, price_per_night_ore=$6, min_nights=$7, max_nights=$8, booking_mode=$9, changeover_weekday=$10, priority=$11, weekend_price_per_night_ore=$12, updated_at=now() WHERE id=$1 AND property_id=$13`, [id, ...vals, pid]);
    else await getPool().query(`INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date, price_per_night_ore, min_nights, max_nights, booking_mode, changeover_weekday, priority, weekend_price_per_night_ore) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [pid, ...vals]);
    await audit(null, actor, id ? 'pricing.period_updated' : 'pricing.period_created', 'property', pid, undefined, Object.fromEntries(f.entries()));
    return 'Perioden er lagret.';
  });
}
/** Paint a date range in the season calendar: the range becomes the chosen season (or no season), overlapping periods are trimmed. */
export async function paintSeasonAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => {
    const { paintSeason } = await import('@/lib/domain/seasons');
    let start = date(f, 'start'), end = date(f, 'end');
    if (end < start) [start, end] = [end, start];
    const cat = str(f, 'season_category_id') || null;
    const name = await paintSeason(pid, start, end, cat);
    await audit(null, actor, 'pricing.season_painted', 'property', pid, undefined, { start, end, cat });
    return name ? `${name} satt for ${start} – ${end}.` : `Sesong fjernet for ${start} – ${end} (kan ikke bookes).`;
  });
}
export async function deletePeriodAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => { await getPool().query(`UPDATE pricing_periods SET active=false WHERE id=$1 AND property_id=$2`, [str(f, 'id'), pid]); await audit(null, actor, 'pricing.period_deactivated', 'pricing_period', str(f, 'id')); return 'Perioden er fjernet.'; });
}
export async function saveLosAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => {
    if (str(f, 'delete')) { await getPool().query(`UPDATE length_of_stay_discounts SET active=false WHERE id=$1 AND property_id=$2`, [str(f, 'delete'), pid]); }
    else {
      const n = int(f, 'min_nights'), pct = Number(str(f, 'pct'));
      if (n < 2 || !(pct > 0 && pct <= 100)) throw new DomainError('bad', 'Min. 2 netter og rabatt mellom 0 og 100 %.');
      await getPool().query(`INSERT INTO length_of_stay_discounts (property_id, season_category_id, min_nights, discount_percentage) VALUES ($1,$2,$3,$4)`, [pid, str(f, 'season_category_id') || null, n, pct]);
    }
    await audit(null, actor, 'pricing.los_changed', 'property', pid, undefined, Object.fromEntries(f.entries()));
    return 'Lagret.';
  });
}
export async function saveAddOnAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => {
    if (str(f, 'deactivate')) { await getPool().query(`UPDATE add_on_items SET active=false WHERE id=$1`, [str(f, 'deactivate')]); }
    else if (str(f, 'id')) {
      await getPool().query(`UPDATE add_on_items SET name=$2, description=$3, price_type=$4, unit_price_ore=$5, mandatory=$6 WHERE id=$1`,
        [str(f, 'id'), str(f, 'name'), str(f, 'description') || null, str(f, 'price_type'), kr(f, 'price') ?? 0, !!f.get('mandatory')]);
    }
    else await getPool().query(`INSERT INTO add_on_items (property_id, name, description, price_type, unit_price_ore, mandatory) VALUES ($1,$2,$3,$4,$5,$6)`,
      [f.get('global') ? null : pid, str(f, 'name'), str(f, 'description') || null, str(f, 'price_type'), kr(f, 'price') ?? 0, !!f.get('mandatory')]);
    await audit(null, actor, 'pricing.add_on_changed', 'property', pid, undefined, Object.fromEntries(f.entries()));
    return 'Lagret.';
  });
}
export async function saveCancellationTierAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/innstillinger', async () => {
    if (str(f, 'deactivate')) await getPool().query(`UPDATE cancellation_policy_tiers SET active=false WHERE id=$1`, [str(f, 'deactivate')]);
    else await getPool().query(`INSERT INTO cancellation_policy_tiers (property_id, days_before_checkin_min, days_before_checkin_max, refund_percentage, requires_admin_approval) VALUES (NULL,$1,$2,$3,$4)`,
      [int(f, 'min'), str(f, 'max') ? int(f, 'max') : null, Number(str(f, 'pct')), !!f.get('approval')]);
    await audit(null, actor, 'policy.cancellation_tier_changed', 'cancellation_policy_tier', null, undefined, Object.fromEntries(f.entries()));
    return 'Kanselleringsvilkår oppdatert.';
  });
}

// ---------------- Airbnb-linked pricing
export async function pricingModeAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => {
    const mode = str(f, 'mode') === 'manual' ? 'manual' : 'airbnb';
    await getPool().query(`UPDATE properties SET pricing_mode=$2, default_min_nights=$3, updated_at=now() WHERE id=$1`, [pid, mode, Math.max(1, int(f, 'default_min_nights', 2))]);
    await audit(null, actor, 'pricing.mode_changed', 'property', pid, undefined, { mode });
    return mode === 'airbnb' ? 'Prisene følger nå Airbnb-prisene.' : 'Prisene settes nå individuelt (sesongpriser).';
  });
}

async function upsertRates(pid: string, rows: [string, number][], source: 'manual_entry' | 'paste', userId: string | null) {
  await tx(async c => {
    for (const [d, ore] of rows) {
      await c.query(`INSERT INTO external_nightly_rates (property_id, date, price_ore, source, updated_by_user_id) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (property_id, date) DO UPDATE SET price_ore=EXCLUDED.price_ore, source=EXCLUDED.source, updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`, [pid, d, ore, source, userId]);
    }
  });
}

/** Set the Airbnb price for a date range, with optional separate weekend (Fri/Sat night) price. */
export async function airbnbRangeAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => {
    const start = date(f, 'start'), end = date(f, 'end');
    if (end < start) throw new DomainError('dates', 'Sluttdato må være etter startdato.');
    const weekday = kr(f, 'weekday'); const weekend = kr(f, 'weekend') ?? weekday;
    if (!weekday) throw new DomainError('price', 'Oppgi pris per natt.');
    const rows: [string, number][] = [];
    for (let d = start; d <= end; d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)) {
      const wd = new Date(d + 'T12:00:00Z').getUTCDay(); // 5 = Fri, 6 = Sat
      rows.push([d, wd === 5 || wd === 6 ? weekend! : weekday]);
      if (rows.length > 731) throw new DomainError('range', 'Maks to år om gangen.');
    }
    await upsertRates(pid, rows, 'manual_entry', actor.id);
    await audit(null, actor, 'pricing.airbnb_rates_set', 'property', pid, undefined, { start, end, weekday, weekend, nights: rows.length });
    return `Airbnb-pris lagret for ${rows.length} netter.`;
  });
}

/** Paste lines like "2027-01-10;1890" or "10.01.2027 1 890" (copied from Airbnb's calendar or a spreadsheet). */
export async function airbnbPasteAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'priser'), async () => {
    const rows: [string, number][] = []; const bad: string[] = [];
    for (const line of str(f, 'rates').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      const m = line.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})[\s;,\t]+(?:kr\s*)?([\d\s.,]+)\s*(?:kr)?$/i);
      if (!m) { bad.push(line); continue; }
      let d = m[1];
      if (d.includes('.')) { const [dd, mm, yy] = d.split('.'); d = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; }
      const n = Number(m[2].replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || isNaN(Date.parse(d))) { bad.push(line); continue; }
      rows.push([d, Math.round(n * 100)]);
    }
    if (!rows.length) throw new DomainError('empty', 'Fant ingen gyldige linjer. Format: 2027-01-10;1890');
    await upsertRates(pid, rows, 'paste', actor.id);
    await audit(null, actor, 'pricing.airbnb_rates_pasted', 'property', pid, undefined, { rows: rows.length, rejected: bad.length });
    return `Importerte ${rows.length} priser${bad.length ? ` (${bad.length} linjer kunne ikke leses: ${bad.slice(0, 3).join(' | ')})` : ''}.`;
  });
}
