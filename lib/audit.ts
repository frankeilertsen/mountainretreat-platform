import { Db, getPool } from './db';

export type Actor = { id: string | null; type: 'admin' | 'member' | 'helper' | 'system' | 'anonymous'; ip?: string | null };
export const SYSTEM: Actor = { id: null, type: 'system' };

export function actorFor(user: { id: string; system_role: string }, ip?: string | null): Actor {
  const type = user.system_role === 'super_admin' || user.system_role === 'admin' ? 'admin'
    : user.system_role === 'helper' ? 'helper' : 'member';
  return { id: user.id, type, ip: ip ?? null };
}

export async function audit(db: Db | null, actor: Actor, action: string, entityType: string, entityId: string | null,
  before?: unknown, after?: unknown): Promise<void> {
  await (db ?? getPool()).query(
    `INSERT INTO audit_log (actor_user_id, actor_type, action, entity_type, entity_id, before_state, after_state, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.id, actor.type, action, entityType, entityId,
     before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), actor.ip ?? null],
  );
}
