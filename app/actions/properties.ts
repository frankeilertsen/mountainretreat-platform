'use server';
import { run, str, int, kr, date } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor, audit } from '@/lib/audit';
import { getPool, one, tx } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { savePhoto } from '@/lib/domain/cleaning';

async function admin() { const u = await assertUser('admin'); return { u, actor: actorFor(u, await clientIp()) }; }
const back = (id: string, tab = '') => `/admin/boliger/${id}${tab ? '?fane=' + tab : ''}`;
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function createPropertyAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/boliger', async () => {
    const name = str(f, 'name');
    if (name.length < 2) throw new DomainError('name', 'Gi boligen et navn.');
    const id = await tx(async c => {
      const p = await one<{ id: string }>(`INSERT INTO properties (slug, name, address, max_guests, owner_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
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
    await getPool().query(`UPDATE properties SET name=$2, address=$3, short_description=$4, description=$5, amenities=$6, house_rules=$7, max_guests=$8,
        check_in_time=$9, check_out_time=$10, cleaning_fee_ore=$11, active=$12, updated_at=now() WHERE id=$1`,
      [id, str(f, 'name'), str(f, 'address') || null, str(f, 'short_description') || null, str(f, 'description') || null, amenities, str(f, 'house_rules') || null,
       Math.max(1, int(f, 'max_guests', 1)), str(f, 'check_in_time') || '15:00', str(f, 'check_out_time') || '11:00', kr(f, 'cleaning_fee') ?? 0, !!f.get('active')]);
    await audit(null, actor, 'property.updated', 'property', id, before, Object.fromEntries(f.entries()));
    return 'Lagret.';
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
    return 'Rommet er lagret.';
  });
}
export async function deactivateRoomAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'rom'), async () => {
    await getPool().query(`UPDATE rooms SET active=false WHERE id=$1 AND property_id=$2`, [str(f, 'id'), pid]);
    await getPool().query(`UPDATE beds SET active=false WHERE room_id=$1`, [str(f, 'id')]);
    await audit(null, actor, 'room.deactivated', 'property', pid); return 'Rommet er fjernet.';
  });
}
export async function saveBedAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId'); const id = str(f, 'id');
  await run(back(pid, 'rom'), async () => {
    const type = str(f, 'bed_type');
    const defaults: Record<string, [number, number]> = { double: [2, 10], single: [1, 20], bunk_lower: [1, 30], bunk_upper: [1, 40], sofa_bed: [2, 90], extra_mattress: [1, 95], cot: [1, 50] };
    if (!defaults[type]) throw new DomainError('type', 'Ugyldig sengetype.');
    const sleeps = int(f, 'sleeps', defaults[type][0]);
    const vals = [str(f, 'label') || type, type, sleeps, int(f, 'allocation_priority', defaults[type][1]), int(f, 'width_cm') || null, int(f, 'length_cm') || null, !!f.get('children_only') || type === 'bunk_upper' || type === 'cot'];
    if (id) await getPool().query(`UPDATE beds SET label=$2, bed_type=$3, sleeps=$4, allocation_priority=$5, width_cm=$6, length_cm=$7, children_only=$8 WHERE id=$1 AND property_id=$9`, [id, ...vals, pid]);
    else await getPool().query(`INSERT INTO beds (property_id, room_id, label, bed_type, sleeps, allocation_priority, width_cm, length_cm, children_only) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [pid, str(f, 'roomId'), ...vals]);
    await audit(null, actor, id ? 'bed.updated' : 'bed.created', 'property', pid, undefined, { type, sleeps });
    return 'Sengen er lagret.';
  });
}
export async function deactivateBedAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(back(pid, 'rom'), async () => { await getPool().query(`UPDATE beds SET active=false WHERE id=$1 AND property_id=$2`, [str(f, 'id'), pid]); await audit(null, actor, 'bed.deactivated', 'property', pid); return 'Sengen er fjernet.'; });
}

// ---------------- pricing
export async function saveCategoryAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId'); const id = str(f, 'id');
  await run(back(pid, 'priser'), async () => {
    const before = await one('SELECT * FROM season_categories WHERE id=$1', [id]);
    const max = int(f, 'max_nights') || null;
    await getPool().query(`UPDATE season_categories SET name=$2, price_per_night_ore=$3, min_nights=$4, max_nights=$5, color=$6, updated_at=now() WHERE id=$1 AND property_id=$7`,
      [id, str(f, 'name'), kr(f, 'price') ?? 0, Math.max(1, int(f, 'min_nights', 1)), max, str(f, 'color') || null, pid]);
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
    const vals = [str(f, 'season_category_id'), str(f, 'name'), start, end, kr(f, 'price'), int(f, 'min_nights') || null, int(f, 'max_nights') || null, mode, wd, prio];
    if (id) await getPool().query(`UPDATE pricing_periods SET season_category_id=$2, name=$3, start_date=$4, end_date=$5, price_per_night_ore=$6, min_nights=$7, max_nights=$8, booking_mode=$9, changeover_weekday=$10, priority=$11, updated_at=now() WHERE id=$1 AND property_id=$12`, [id, ...vals, pid]);
    else await getPool().query(`INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date, price_per_night_ore, min_nights, max_nights, booking_mode, changeover_weekday, priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [pid, ...vals]);
    await audit(null, actor, id ? 'pricing.period_updated' : 'pricing.period_created', 'property', pid, undefined, Object.fromEntries(f.entries()));
    return 'Perioden er lagret.';
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
