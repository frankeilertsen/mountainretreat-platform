import { Db, getPool, one, tx } from '../db';
import { hashToken, randomToken } from '../crypto';
import { rateLimit } from '../ratelimit';
import { appUrl, enqueue } from '../notify';
import { audit } from '../audit';
import { DomainError } from '../errors';
import { createSession } from '../auth/sessions';

/** Always returns silently, whether or not the email exists (no account enumeration). */
export async function requestMagicLink(email: string, ip: string | null): Promise<void> {
  const norm = email.trim().toLowerCase();
  await rateLimit(`login:ip:${ip ?? 'unknown'}`, 20, 900);
  await rateLimit(`login:email:${norm}`, 5, 900);
  const user = await one<{ id: string; email: string; name: string }>(
    `SELECT id, email, name FROM users WHERE lower(email) = $1 AND status = 'active'`, [norm]);
  if (!user) {
    await audit(null, { id: null, type: 'anonymous', ip }, 'auth.magic_link_unknown_email', 'user', null, undefined, { email: norm });
    return;
  }
  const token = randomToken();
  await tx(async c => {
    await c.query(`INSERT INTO login_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '15 minutes')`,
      [user.id, hashToken(token)]);
    await enqueue({ userId: user.id, to: user.email, type: 'magic_link', subject: 'Din innloggingslenke',
      body: `Hei ${user.name}!\n\nKlikk for å logge inn (gyldig i 15 minutter, kan brukes én gang):\n${appUrl('/auth/verify?token=' + token)}\n\nHar du ikke bedt om dette, kan du se bort fra e-posten.` }, c);
  });
}

/** Consumes a magic link token and returns a new (AAL1) session token. */
export async function consumeMagicLink(token: string, ip: string | null, ua: string | null): Promise<string> {
  await rateLimit(`verify:ip:${ip ?? 'unknown'}`, 30, 900);
  return tx(async c => {
    const row = await one<{ user_id: string; system_role: string }>(
      `UPDATE login_tokens lt SET used_at = now() FROM users u
       WHERE lt.token_hash = $1 AND lt.used_at IS NULL AND lt.expires_at > now() AND u.id = lt.user_id AND u.status = 'active'
       RETURNING lt.user_id, u.system_role`, [hashToken(token)], c);
    if (!row) throw new DomainError('invalid_link', 'Lenken er utløpt eller allerede brukt. Be om en ny.');
    await audit(c, { id: row.user_id, type: 'anonymous', ip }, 'auth.magic_link_used', 'user', row.user_id);
    return createSession(row.user_id, row.system_role, { aal: 1, ip, ua }, c);
  });
}

export async function elevateSession(sessionId: string, db: Db = getPool()) {
  await db.query('UPDATE sessions SET aal = 2, step_up_at = now() WHERE id = $1', [sessionId]);
}
