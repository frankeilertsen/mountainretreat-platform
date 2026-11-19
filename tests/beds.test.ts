import { describe, it, expect } from 'vitest';
import { allocateBeds } from '../lib/domain/beds';

const rooms = [{ id: 'b1', max_capacity: 2, sort_order: 1 }, { id: 'b2', max_capacity: 2, sort_order: 2 }, { id: 'lr', max_capacity: 2, sort_order: 3 }];
const beds = [
  { id: 'double', room_id: 'b1', bed_type: 'double', sleeps: 2, allocation_priority: 10, children_only: false },
  { id: 'lower', room_id: 'b2', bed_type: 'bunk_lower', sleeps: 1, allocation_priority: 20, children_only: false },
  { id: 'upper', room_id: 'b2', bed_type: 'bunk_upper', sleeps: 1, allocation_priority: 30, children_only: true },
  { id: 'sofa', room_id: 'lr', bed_type: 'sofa_bed', sleeps: 2, allocation_priority: 90, children_only: false },
];
const get = (r: ReturnType<typeof allocateBeds>, id: string) => r.allocations.find(a => a.bed_id === id)?.persons ?? 0;

describe('bed allocation uses the configured layout, not guests ÷ beds', () => {
  it('Apartment A, 3 adults: double for two, lower bunk for one, upper bunk and sofa bed unused', () => {
    const r = allocateBeds(rooms, beds, { adults: 3, children: 0, infants: 0 });
    expect(get(r, 'double')).toBe(2);
    expect(get(r, 'lower')).toBe(1);
    expect(get(r, 'upper')).toBe(0);
    expect(get(r, 'sofa')).toBe(0);
    expect(r.warnings).toEqual([]);
  });
  it('children go to children-only beds first and adults never to the upper bunk', () => {
    const r = allocateBeds(rooms, beds, { adults: 2, children: 1, infants: 0 });
    expect(get(r, 'double')).toBe(2);
    expect(get(r, 'upper')).toBe(1);
    expect(get(r, 'sofa')).toBe(0);
  });
  it('sofa bed is only used when the regular beds are full', () => {
    const r = allocateBeds(rooms, beds, { adults: 5, children: 0, infants: 0 });
    expect(get(r, 'double')).toBe(2);
    expect(get(r, 'lower')).toBe(1);
    expect(get(r, 'sofa')).toBe(2);
    expect(get(r, 'upper')).toBe(0);
    expect(r.unplaced.adults).toBe(0);
  });
  it('infants get a cot when configured, otherwise a warning', () => {
    const withCot = allocateBeds([...rooms, { id: 'k', max_capacity: 1, sort_order: 4 }], [...beds, { id: 'cot', room_id: 'k', bed_type: 'cot', sleeps: 1, allocation_priority: 50, children_only: true }], { adults: 2, children: 0, infants: 1 });
    expect(get(withCot, 'cot')).toBe(1);
    const noCot = allocateBeds(rooms, beds, { adults: 2, children: 0, infants: 1 });
    expect(noCot.warnings[0]).toMatch(/barneseng/);
  });
  it('respects room max capacity and reports guests that do not fit', () => {
    const r = allocateBeds([{ id: 'b1', max_capacity: 1, sort_order: 1 }], [beds[0]], { adults: 2, children: 0, infants: 0 });
    expect(get(r, 'double')).toBe(1);
    expect(r.unplaced.adults).toBe(1);
    expect(r.warnings.length).toBe(1);
  });
});
