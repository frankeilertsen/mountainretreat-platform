import { Db, getPool, one } from '../db';
import { hashToken, randomToken } from '../crypto';

export type SessionUser = {
  id: string; email: string; name: string; phone: string | null; system_role: string; status: string;
  invite_tier: string | null; loyalty_status: string; totp_enrolled_at: string | null; referral_code: string | null;
  cleaning_scope: string;
  session_id: string; aal: number; step_up_at: string | null;
};

// Security constants (spec §20) — deliberately NOT admin-editable.
export const SESSION_LIMITS = {
  admin: { absoluteHours: 12, idleMinutes: 30 },
  default: { absoluteHours: 24, idleMinutes: 60 },
};

export async function createSession(userId: string, role: string, opts: { aal: number; ip?: string | null; ua?: string | null }, db: Db = getPool()) {
  const token = randomToken();
  const lim = role === 'super_admin' || role === 'admin' ? SESSION_LIMITS.admin : SESSION_LIMITS.default;
  await db.query(
    `INSERT INTO sessions (user_id, session_token_hash, aal, ip_address, user_agent, expires_at, idle_timeout_minutes)
     VALUES ($1,$2,$3,$4,$5, now() + make_interval(hours => $6), $7)`,
    [userId, hashToken(token), opts.aal, opts.ip ?? null, opts.ua?.slice(0, 300) ?? null, lim.absoluteHours, lim.idleMinutes]);
  return token;
}

/** Validates absolute + idle expiry in the database and slides the idle window. */
export async function loadSession(token: string, db: Db = getPool()): Promise<SessionUser | null> {
  return one<SessionUser>(
    `WITH s AS (
       UPDATE sessions SET last_activity_at = now()
       WHERE session_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
         AND last_activity_at > now() - make_interval(mins => idle_timeout_minutes)
       RETURNING id, user_id, aal, step_up_at)
     SELECT u.id, u.email, u.name, u.phone, u.system_role, u.status, u.invite_tier, u.loyalty_status,
            u.totp_enrolled_at, u.referral_code, u.cleaning_scope, s.id AS session_id, s.aal, s.step_up_at
     FROM s JOIN users u ON u.id = s.user_id
     WHERE u.status = 'active'`, [hashToken(token)], db);
}

export async function revokeSession(sessionId: string, db: Db = getPool()) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
}
export async function revokeAllSessions(userId: string, db: Db = getPool()) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}
