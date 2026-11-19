import { PoolClient } from 'pg';
import { Db, getPool, isPgError, one, PG_EXCLUSION_VIOLATION, q, tx } from '../db';
import { DomainError } from '../errors';
import { audit, Actor } from '../audit';

export type BlockType = 'external_sync' | 'manual_admin' | 'platform_booking';

/** Fast, non-authoritative check used at request time. The exclusion constraint is the real guarantee. */
export async function isRangeFree(propertyId: string, start: string, end: string, db: Db = getPool()): Promise<boolean> {
  const r = await one(`SELECT 1 FROM availability_blocks WHERE property_id=$1 AND date_range && daterange($2::date,$3::date,'[)') LIMIT 1`,
    [propertyId, start, end], db);
  return !r;
}

/**
 * Inserts a block. Uses a savepoint so a conflict can be translated into a friendly error without
 * aborting the caller's whole transaction. Returns the block id.
 */
export async function insertBlock(c: PoolClient, b: { propertyId: string; start: string; end: string; type: BlockType;
  referenceId?: string | null; sourceConnectionId?: string | null; reason?: string | null; userId?: string | null }): Promise<string> {
  await c.query('SAVEPOINT block_insert');
  try {
    const row = await one<{ id: string }>(
      `INSERT INTO availability_blocks (property_id, date_range, block_type, reference_id, source_connection_id, reason, created_by_user_id)
       VALUES ($1, daterange($2::date,$3::date,'[)'), $4, $5, $6, $7, $8) RETURNING id`,
      [b.propertyId, b.start, b.end, b.type, b.referenceId ?? null, b.sourceConnectionId ?? null, b.reason ?? null, b.userId ?? null], c);
    await c.query('RELEASE SAVEPOINT block_insert');
    return row!.id;
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT block_insert');
    if (isPgError(e, PG_EXCLUSION_VIOLATION)) {
      throw new DomainError('dates_taken', 'Disse datoene ble nettopp tatt. Velg andre datoer.', 409);
    }
    throw e;
  }
}

export async function removeBlocksFor(c: PoolClient, type: BlockType, referenceId: string) {
  await c.query('DELETE FROM availability_blocks WHERE block_type=$1 AND reference_id=$2', [type, referenceId]);
}

export async function createManualBlock(propertyId: string, start: string, end: string, reason: string, actor: Actor) {
  if (!reason.trim()) throw new DomainError('reason_required', 'Oppgi en grunn for sperringen.');
  if (end <= start) throw new DomainError('bad_dates', 'Sluttdato må være etter startdato.');
  return tx(async c => {
    const id = await insertBlock(c, { propertyId, start, end, type: 'manual_admin', reason: reason.trim(), userId: actor.id });
    await c.query('UPDATE availability_blocks SET reference_id = id WHERE id = $1', [id]);
    await audit(c, actor, 'availability.manual_block_created', 'availability_block', id, undefined, { propertyId, start, end, reason });
    return id;
  });
}

export async function deleteManualBlock(blockId: string, actor: Actor) {
  await tx(async c => {
    const b = await one(`DELETE FROM availability_blocks WHERE id=$1 AND block_type='manual_admin' RETURNING property_id, lower(date_range) AS start, upper(date_range) AS end, reason`, [blockId], c);
    if (!b) throw new DomainError('not_found', 'Fant ikke sperringen.');
    await audit(c, actor, 'availability.manual_block_removed', 'availability_block', blockId, b);
  });
}

export type CalendarBlock = { id: string; start: string; end: string; block_type: BlockType; reference_id: string | null; reason: string | null; source: string | null };
export async function blocksForRange(propertyId: string, from: string, to: string, db: Db = getPool()): Promise<CalendarBlock[]> {
  return q<CalendarBlock>(
    `SELECT ab.id, to_char(lower(ab.date_range),'YYYY-MM-DD') AS start, to_char(upper(ab.date_range),'YYYY-MM-DD') AS "end",
            ab.block_type, ab.reference_id, ab.reason, cc.display_name AS source
     FROM availability_blocks ab LEFT JOIN channel_connections cc ON cc.id = ab.source_connection_id
     WHERE ab.property_id=$1 AND ab.date_range && daterange($2::date,$3::date,'[)') ORDER BY lower(ab.date_range)`, [propertyId, from, to], db);
}
