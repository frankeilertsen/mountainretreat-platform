import { PoolClient } from 'pg';
import { Db, getPool, one, q } from '../db';
import { DomainError } from '../errors';

/**
 * Sleeping places for a property = Σ over active rooms of min(room max capacity, Σ places of the room's beds).
 * Baby cots are excluded (infants don't count as guests).
 */
export async function sleepingPlaces(propertyId: string, db: Db = getPool()) {
  const rooms = await q<{ id: string; name: string; max_capacity: number; bed_places: number; beds: number }>(
    `SELECT r.id, r.name, r.max_capacity,
            COALESCE(sum(b.sleeps) FILTER (WHERE b.active AND b.bed_type <> 'cot'), 0)::int AS bed_places,
            count(b.id) FILTER (WHERE b.active)::int AS beds
     FROM rooms r LEFT JOIN beds b ON b.room_id = r.id WHERE r.property_id=$1 AND r.active GROUP BY r.id ORDER BY r.sort_order, r.name`, [propertyId], db);
  const perRoom = rooms.map(r => ({ ...r, places: Math.min(r.max_capacity, r.bed_places), limitedByRoom: r.max_capacity < r.bed_places }));
  return { total: perRoom.reduce((s, r) => s + r.places, 0), rooms: perRoom };
}

/** Keeps properties.max_guests in line with the beds. Call after any room/bed change. */
export async function syncMaxGuests(c: PoolClient | Db, propertyId: string): Promise<{ maxGuests: number; places: number; clamped: boolean }> {
  const { total } = await sleepingPlaces(propertyId, c);
  const p = await one<{ max_guests: number; max_guests_mode: string }>('SELECT max_guests, max_guests_mode FROM properties WHERE id=$1', [propertyId], c);
  if (!p) throw new DomainError('not_found', 'Fant ikke boligen.');
  let next = p.max_guests, clamped = false;
  if (total > 0) {
    if (p.max_guests_mode === 'auto') next = total;
    else if (p.max_guests > total) { next = total; clamped = true; }
  }
  if (next !== p.max_guests) await c.query('UPDATE properties SET max_guests=$2, updated_at=now() WHERE id=$1', [propertyId, next]);
  return { maxGuests: next, places: total, clamped };
}

/** Admin sets max persons: 'auto' follows the sleeping places; 'manual' must be between 1 and the sleeping places. */
export async function setMaxGuests(c: PoolClient | Db, propertyId: string, mode: 'auto' | 'manual', value: number | null) {
  const { total } = await sleepingPlaces(propertyId, c);
  if (mode === 'manual') {
    const v = Math.floor(Number(value));
    if (!(v >= 1)) throw new DomainError('bad_max', 'Maks personer må være minst 1.');
    if (total > 0 && v > total) throw new DomainError('over_capacity', `Maks personer kan ikke være høyere enn antall sengeplasser (${total}).`);
    await c.query(`UPDATE properties SET max_guests_mode='manual', max_guests=$2, updated_at=now() WHERE id=$1`, [propertyId, v]);
  } else {
    await c.query(`UPDATE properties SET max_guests_mode='auto', updated_at=now() WHERE id=$1`, [propertyId]);
  }
  return syncMaxGuests(c, propertyId);
}

export const BED_SIZES: [string, string][] = [
  ['60x120', '60 × 120 (barneseng)'], ['75x190', '75 × 190'], ['80x200', '80 × 200'], ['90x200', '90 × 200'], ['105x200', '105 × 200'],
  ['120x200', '120 × 200'], ['140x200', '140 × 200'], ['150x200', '150 × 200'], ['160x200', '160 × 200'], ['180x200', '180 × 200'], ['200x200', '200 × 200'],
];
