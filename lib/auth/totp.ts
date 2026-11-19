import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { Db, getPool, one } from '../db';
import { decrypt, encrypt, hashToken } from '../crypto';
import { DomainError } from '../errors';
import { audit, Actor } from '../audit';
import { notifyAdmins } from '../notify';

authenticator.options = { window: 1 };

export async function beginEnrollment(userId: string, email: string, db: Db = getPool()) {
  const u = await one<{ totp_secret_encrypted: string | null; totp_enrolled_at: string | null }>(
    'SELECT totp_secret_encrypted, totp_enrolled_at FROM users WHERE id = $1', [userId], db);
  if (u?.totp_enrolled_at) throw new DomainError('already_enrolled', 'Tofaktor er allerede satt opp.');
  let secret = u?.totp_secret_encrypted ? decrypt(u.totp_secret_encrypted) : null;
  if (!secret) {
    secret = authenticator.generateSecret();
    await db.query('UPDATE users SET totp_secret_encrypted = $2 WHERE id = $1', [userId, encrypt(secret)]);
  }
  const otpauth = authenticator.keyuri(email, 'Mountain Retreat', secret);
  return { secret, qrDataUrl: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) };
}

/** Verifies a code; locks the account for 15 min after 5 failures (spec §19/§20). */
export async function verifyTotp(userId: string, code: string, actor: Actor, db: Db = getPool()): Promise<{ recoveryCodes?: string[] }> {
  const u = await one<{ totp_secret_encrypted: string | null; totp_enrolled_at: string | null; locked_until: string | null;
    failed_totp_attempts: number; recovery_codes_hashed: string[] | null; system_role: string; email: string }>(
    'SELECT totp_secret_encrypted, totp_enrolled_at, locked_until, failed_totp_attempts, recovery_codes_hashed, system_role, email FROM users WHERE id = $1',
    [userId], db);
  if (!u?.totp_secret_encrypted) throw new DomainError('no_totp', 'Tofaktor er ikke satt opp.');
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new DomainError('locked', 'Kontoen er midlertidig låst etter for mange feil forsøk. Prøv igjen om 15 minutter.', 429);
  }
  const clean = code.replace(/\s/g, '');
  let ok = /^\d{6}$/.test(clean) && authenticator.check(clean, decrypt(u.totp_secret_encrypted));
  // Recovery code (single use)
  if (!ok && u.totp_enrolled_at && u.recovery_codes_hashed?.length && /^[a-z0-9-]{8,}$/i.test(clean)) {
    const h = hashToken(clean.toLowerCase());
    if (u.recovery_codes_hashed.includes(h)) {
      ok = true;
      await db.query('UPDATE users SET recovery_codes_hashed = array_remove(recovery_codes_hashed, $2) WHERE id = $1', [userId, h]);
      await audit(db, actor, 'auth.recovery_code_used', 'user', userId);
    }
  }
  if (!ok) {
    const r = await one<{ failed_totp_attempts: number }>(
      `UPDATE users SET failed_totp_attempts = failed_totp_attempts + 1,
         locked_until = CASE WHEN failed_totp_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
       WHERE id = $1 RETURNING failed_totp_attempts`, [userId], db);
    await audit(db, actor, 'auth.totp_failed', 'user', userId, undefined, { attempts: r?.failed_totp_attempts });
    if ((r?.failed_totp_attempts ?? 0) >= 5 && (u.system_role === 'admin' || u.system_role === 'super_admin')) {
      await notifyAdmins({ type: 'security_alert', subject: 'Sikkerhetsvarsel: admin-konto låst',
        body: `Admin-kontoen ${u.email} ble låst etter gjentatte feil tofaktorkoder.` }, db);
    }
    throw new DomainError('bad_code', 'Feil kode. Prøv igjen.');
  }
  let recoveryCodes: string[] | undefined;
  if (!u.totp_enrolled_at) {
    recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
    await db.query('UPDATE users SET totp_enrolled_at = now(), recovery_codes_hashed = $2 WHERE id = $1',
      [userId, recoveryCodes.map(c => hashToken(c))]);
    await audit(db, actor, 'auth.totp_enrolled', 'user', userId);
  }
  await db.query('UPDATE users SET failed_totp_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [userId]);
  return { recoveryCodes };
}
