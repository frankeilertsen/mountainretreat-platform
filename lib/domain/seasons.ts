import { tx } from '../db';
import { addDays } from '../format';
import { DomainError } from '../errors';

/**
 * Sets nights start..end (inclusive) to one season, like painting in the season calendar.
 * Overlapping active periods are trimmed or split so the new choice wins; touching plain periods
 * of the same season are merged so the period list stays short. catId null = remove (not bookable).
 */
export async function paintSeason(propertyId: string, start: string, end: string, catId: string | null): Promise<string | null> {
  if (end < start) throw new DomainError('dates', 'Sluttdato må være etter startdato.');
  if (Date.parse(end) - Date.parse(start) > 800 * 864e5) throw new DomainError('range', 'Maks to år om gangen.');
  return tx(async c => {
    let catName: string | null = null;
    if (catId) {
      const cat = (await c.query(`SELECT name FROM season_categories WHERE id=$1 AND property_id=$2`, [catId, propertyId])).rows[0];
      if (!cat) throw new DomainError('not_found', 'Ukjent sesong.');
      catName = cat.name;
    }
    const overlapping = (await c.query(`SELECT *, to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e FROM pricing_periods
      WHERE property_id=$1 AND active AND start_date <= $3 AND end_date >= $2 FOR UPDATE`, [propertyId, start, end])).rows;
    for (const p of overlapping) {
      const keepBefore = p.s < start, keepAfter = p.e > end;
      if (!keepBefore && !keepAfter) { await c.query(`UPDATE pricing_periods SET active=false, updated_at=now() WHERE id=$1`, [p.id]); continue; }
      if (keepBefore) await c.query(`UPDATE pricing_periods SET end_date=$2, updated_at=now() WHERE id=$1`, [p.id, addDays(start, -1)]);
      else await c.query(`UPDATE pricing_periods SET start_date=$2, updated_at=now() WHERE id=$1`, [p.id, addDays(end, 1)]);
      if (keepBefore && keepAfter) {
        await c.query(`INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date, price_per_night_ore, weekend_price_per_night_ore, min_nights, max_nights, booking_mode, changeover_weekday, priority)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [propertyId, p.season_category_id, p.name, addDays(end, 1), p.e, p.price_per_night_ore, p.weekend_price_per_night_ore, p.min_nights, p.max_nights, p.booking_mode, p.changeover_weekday, p.priority]);
      }
    }
    if (!catId) return null;
    // Merge with plain neighbours of the same season (no own prices or rules)
    const plain = `season_category_id=$2 AND active AND price_per_night_ore IS NULL AND weekend_price_per_night_ore IS NULL AND min_nights IS NULL AND max_nights IS NULL AND booking_mode='flexible' AND priority=0`;
    const before = (await c.query(`SELECT id, name, to_char(start_date,'YYYY-MM-DD') AS s FROM pricing_periods WHERE property_id=$1 AND ${plain} AND end_date=$3::date - 1`, [propertyId, catId, start])).rows[0];
    const after = (await c.query(`SELECT id, name, to_char(end_date,'YYYY-MM-DD') AS e FROM pricing_periods WHERE property_id=$1 AND ${plain} AND start_date=$3::date + 1`, [propertyId, catId, end])).rows[0];
    const s = before?.s ?? start, e = after?.e ?? end;
    if (before) await c.query(`UPDATE pricing_periods SET active=false, updated_at=now() WHERE id=$1`, [before.id]);
    if (after) await c.query(`UPDATE pricing_periods SET active=false, updated_at=now() WHERE id=$1`, [after.id]);
    await c.query(`INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date) VALUES ($1,$2,$3,$4,$5)`,
      [propertyId, catId, before?.name ?? after?.name ?? catName, s, e]);
    return catName;
  });
}
