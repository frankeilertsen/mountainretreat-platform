import { describe, it, expect } from 'vitest';
import { getPool, one } from '../lib/db';
import { property } from './factory';
import { sleepingPlaces, setMaxGuests, syncMaxGuests } from '../lib/domain/capacity';

async function room(pid: string, name: string, cap: number, beds: [string, number][]) {
  const r = (await one<{ id: string }>(`INSERT INTO rooms (property_id, name, max_capacity) VALUES ($1,$2,$3) RETURNING id`, [pid, name, cap]))!.id;
  for (const [type, sleeps] of beds) await getPool().query(`INSERT INTO beds (property_id, room_id, label, bed_type, sleeps) VALUES ($1,$2,$3,$3,$4)`, [pid, r, type, sleeps]);
  return r;
}

describe('max persons follows sleeping places per room', () => {
  it('sums bed places per room, limited by room capacity, excluding cots', async () => {
    const pid = await property();
    await room(pid, 'Soverom 1', 2, [['double', 2]]);
    await room(pid, 'Soverom 2', 3, [['bunk_lower', 1], ['bunk_upper', 1], ['cot', 1]]);
    await room(pid, 'Stue', 1, [['sofa_bed', 2]]); // room limited to 1
    const s = await sleepingPlaces(pid);
    expect(s.total).toBe(5);
    expect(s.rooms.find(r => r.name === 'Stue')!.limitedByRoom).toBe(true);
    await getPool().query(`UPDATE properties SET max_guests_mode='auto' WHERE id=$1`, [pid]);
    expect((await syncMaxGuests(getPool(), pid)).maxGuests).toBe(5);
  });

  it('manual max persons cannot exceed the sleeping places and is reduced when beds are removed', async () => {
    const pid = await property();
    await room(pid, 'A', 2, [['double', 2]]);
    const r2 = await room(pid, 'B', 2, [['single', 1], ['single', 1]]);
    await expect(setMaxGuests(getPool(), pid, 'manual', 5)).rejects.toThrow(/sengeplasser \(4\)/);
    expect((await setMaxGuests(getPool(), pid, 'manual', 3)).maxGuests).toBe(3);
    await getPool().query(`UPDATE beds SET active=false WHERE room_id=$1`, [r2]);
    const r = await syncMaxGuests(getPool(), pid);
    expect(r).toMatchObject({ maxGuests: 2, places: 2, clamped: true });
  });
});
