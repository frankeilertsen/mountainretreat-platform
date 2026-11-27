/**
 * Bed allocation (master prompt §10). Uses the configured room layout and individual bed capacities —
 * never just "guests ÷ beds". Pure function: easy to test and to show as a proposal the admin can override.
 *
 * Strategy:
 *  1. Infants → cots (one each). Missing cots are reported as a warning.
 *  2. Adults → pairs into multi-sleeper beds (doubles first by priority), singles into single beds
 *     that are not children-only. Sofa beds / extra mattresses have high priority numbers and are used last.
 *  3. Children → children-only beds (e.g. upper bunk) and single beds first, then share remaining capacity.
 *  4. Room max_capacity is respected throughout.
 */
export type BedInput = { id: string; room_id: string; bed_type: string; sleeps: number; allocation_priority: number; children_only: boolean; label?: string };
export type RoomInput = { id: string; max_capacity: number; sort_order: number };
export type Allocation = { bed_id: string; persons: number; guest_type: 'adult' | 'child' | 'infant' | 'mixed'; linen?: boolean };
export type AllocationResult = { allocations: Allocation[]; unplaced: { adults: number; children: number; infants: number }; warnings: string[] };

export function allocateBeds(rooms: RoomInput[], beds: BedInput[], guests: { adults: number; children: number; infants: number }): AllocationResult {
  const roomOrder = new Map(rooms.map(r => [r.id, r.sort_order]));
  const roomLeft = new Map(rooms.map(r => [r.id, r.max_capacity]));
  const sorted = [...beds].filter(b => roomLeft.has(b.room_id))
    .sort((a, b) => a.allocation_priority - b.allocation_priority || (roomOrder.get(a.room_id)! - roomOrder.get(b.room_id)!));
  const used = new Map<string, { persons: number; types: Set<string> }>();
  const free = (b: BedInput) => b.sleeps - (used.get(b.id)?.persons ?? 0);
  const place = (b: BedInput, n: number, type: string) => {
    const u = used.get(b.id) ?? { persons: 0, types: new Set<string>() };
    u.persons += n; u.types.add(type); used.set(b.id, u);
    if (type !== 'infant') roomLeft.set(b.room_id, roomLeft.get(b.room_id)! - n);
  };
  const roomFree = (b: BedInput) => roomLeft.get(b.room_id)!;

  let { adults, children, infants } = guests;
  const warnings: string[] = [];

  // 1. Infants in cots
  for (const b of sorted.filter(b => b.bed_type === 'cot')) {
    if (infants <= 0) break;
    place(b, 1, 'infant'); infants--;
  }
  if (infants > 0) warnings.push(`${infants} spedbarn mangler barneseng – sover hos voksne eller ta med reiseseng.`);

  const regular = sorted.filter(b => b.bed_type !== 'cot');
  const empty = (b: BedInput) => !used.has(b.id);

  // 2a. Adult pairs into empty multi-sleeper beds
  for (const b of regular) {
    if (adults < 2) break;
    if (b.children_only || !empty(b) || b.sleeps < 2 || roomFree(b) < 2) continue;
    place(b, 2, 'adult'); adults -= 2;
  }
  // 2b. Remaining adults into empty single-capacity beds, then any empty bed, then free space
  for (const pass of [(b: BedInput) => empty(b) && b.sleeps === 1, (b: BedInput) => empty(b), (b: BedInput) => free(b) > 0]) {
    for (const b of regular) {
      if (adults <= 0) break;
      if (b.children_only || !pass(b) || roomFree(b) < 1) continue;
      const n = Math.min(adults, free(b), roomFree(b));
      if (n > 0) { place(b, n, 'adult'); adults -= n; }
    }
  }

  // 3. Children: children-only beds, then empty singles, then empty beds, then any free capacity not shared with adults, then anything
  const childPasses = [
    (b: BedInput) => b.children_only && free(b) > 0,
    (b: BedInput) => empty(b) && b.sleeps === 1,
    (b: BedInput) => empty(b),
    (b: BedInput) => free(b) > 0 && !used.get(b.id)?.types.has('adult'),
    (b: BedInput) => free(b) > 0,
  ];
  for (const pass of childPasses) {
    for (const b of regular) {
      if (children <= 0) break;
      if (!pass(b) || roomFree(b) < 1) continue;
      const n = Math.min(children, free(b), roomFree(b));
      if (n > 0) { place(b, n, 'child'); children -= n; }
    }
  }

  if (adults + children > 0) warnings.push(`${adults + children} gjest(er) får ikke plass i konfigurerte senger.`);
  const allocations: Allocation[] = [...used.entries()].map(([bed_id, u]) => ({
    bed_id, persons: u.persons, guest_type: u.types.size > 1 ? 'mixed' : (u.types.values().next().value as Allocation['guest_type']),
  }));
  return { allocations, unplaced: { adults, children, infants }, warnings };
}

/** Linen/towel needs for one room given its allocations. */
export function roomSupplies(beds: BedInput[], alloc: Map<string, Allocation>) {
  let sheets = 0, duvets = 0, pillows = 0, towelsLarge = 0, towelsSmall = 0, cotSets = 0;
  for (const b of beds) {
    const a = alloc.get(b.id);
    if (!a || a.linen === false) continue;   // guest brings own linen for this bed
    if (b.bed_type === 'cot') { cotSets++; continue; }
    sheets++;
    duvets += a.persons; pillows += a.persons;
    towelsLarge += a.persons; towelsSmall += a.persons;
  }
  return { sheets, duvets, pillows, towelsLarge, towelsSmall, cotSets };
}

export const BED_LABELS: Record<string, string> = {
  double: 'Dobbeltseng', single: 'Enkeltseng', bunk_lower: 'Køyeseng (nedre)', bunk_upper: 'Køyeseng (øvre)',
  sofa_bed: 'Sovesofa', extra_mattress: 'Ekstra madrass', cot: 'Barneseng',
};
