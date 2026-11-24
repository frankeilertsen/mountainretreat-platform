import { PoolClient } from 'pg';
import { Db, getPool, isPgError, one, PG_UNIQUE_VIOLATION, q, tx } from '../db';
import { hashToken, humanCode, randomToken } from '../crypto';
import { audit, Actor } from '../audit';
import { appUrl, enqueue, notifyAdmins } from '../notify';
import { DomainError, forbidden } from '../errors';
import { can, isAdmin, UserLike } from '../auth/rbac';
import { getNum } from '../settings';
import { createSession } from '../auth/sessions';
import { rateLimit } from '../ratelimit';
import { inviteBenefits } from './inviteBenefits';
import { MAX_ATTACH_BYTES } from './presentations';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * presentationId: a presentation id, null = no attachment, undefined = the default presentation (if any).
 * lang: language of the e-mail and the invitation page (the invitee can still switch).
 */
export async function createInvitation(inviter: UserLike & { email: string; name: string }, input: { email: string; name?: string; presentationId?: string | null; lang?: 'no' | 'en' },
  actor: Actor): Promise<{ invitationId: string; link: string }> {
  if (!can(inviter, 'invite')) throw forbidden('Du kan invitere andre når medlemskapet ditt er godkjent for invitasjoner.');
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new DomainError('bad_email', 'Ugyldig e-postadresse.');
  if (email === inviter.email.toLowerCase()) throw new DomainError('self_invite', 'Du kan ikke invitere deg selv.');
  if (isAdmin(inviter)) await rateLimit(`invite:${inviter.id}`, 200, 86400);

  const token = randomToken();
  const days = await getNum('invitation_validity_days', 10);
  return tx(async c => {
    if (!isAdmin(inviter)) {
      // Serialise this member's invitations so two at once can't slip past the weekly limit
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('invite:' || $1))`, [inviter.id]);
      await checkWeeklyInviteLimit(inviter.id, c);
    }
    const existing = await one('SELECT id FROM users WHERE lower(email) = $1', [email], c);
    if (existing) throw new DomainError('already_member', 'Denne personen er allerede medlem.');
    // Expire stale pending invites for this address so a fresh one can be issued
    await c.query(`UPDATE invitations SET status='expired' WHERE lower(invitee_email)=$1 AND status='pending' AND expires_at < now()`, [email]);
    const lang = input.lang === 'en' ? 'en' : 'no';
    let pres: { id: string; title: string; size_bytes: number } | null = null;
    if (input.presentationId === undefined) pres = await one(`SELECT id, title, size_bytes FROM presentations WHERE is_default AND active`, [], c);
    else if (input.presentationId) {
      pres = await one(`SELECT id, title, size_bytes FROM presentations WHERE id=$1 AND active`, [input.presentationId], c);
      if (!pres) throw new DomainError('presentation', 'Presentasjonen finnes ikke lenger. Velg en annen.');
    }
    let inv: { id: string } | null;
    try {
      inv = await one<{ id: string }>(
        `INSERT INTO invitations (inviter_user_id, invitee_email, invitee_name, token_hash, expires_at, presentation_id, lang)
         VALUES ($1,$2,$3,$4, now() + make_interval(days => $5), $6, $7) RETURNING id`,
        [inviter.id, email, input.name?.trim() || null, hashToken(token), days, pres?.id ?? null, lang], c);
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('pending_exists', 'Denne personen har allerede en aktiv invitasjon.');
      throw e;
    }
    const link = appUrl('/invitasjon/' + token);
    const benefits = (await inviteBenefits(lang, c)).map(b => `• ${b.title}: ${b.text}`).join('\n');
    const pdfLink = pres ? appUrl(`/invitasjon/${token}/presentasjon`) : null;
    const attached = !!pres && pres.size_bytes <= MAX_ATTACH_BYTES;
    const hi = input.name?.trim() ? ' ' + input.name.trim() : '';
    const body = lang === 'en'
      ? `Hi${hi}!\n\n${inviter.name} has invited you to Retreat Club – the private members’ club and booking portal of Mountain Retreat.\n\nAs a member you get:\n${benefits}\n\n`
        + (pres ? `${attached ? 'The attached presentation' : 'The presentation'} has pictures and more information about the place${attached ? '' : `: ${pdfLink}`}.\n\n` : '')
        + `Create your account here (valid for ${days} days):\n${link}`
      : `Hei${hi}!\n\n${inviter.name} har invitert deg til Retreat Club – den private medlemsklubben og bookingportalen til Mountain Retreat.\n\nSom medlem får du:\n${benefits}\n\n`
        + (pres ? `${attached ? 'I presentasjonen som er lagt ved' : 'I presentasjonen'} finner du bilder og mer informasjon om stedet${attached ? '' : `: ${pdfLink}`}.\n\n` : '')
        + `Opprett kontoen din her (gyldig i ${days} dager):\n${link}`;
    await enqueue({ to: email, type: 'invitation',
      subject: lang === 'en' ? `${inviter.name} has invited you to Retreat Club` : `${inviter.name} har invitert deg til Retreat Club`,
      body, payload: attached ? { attachPresentationId: pres!.id } : undefined }, c);
    await audit(c, actor, 'invitation.sent', 'invitation', inv!.id, undefined, { email, presentation: pres?.id ?? null, lang });
    return { invitationId: inv!.id, link };
  });
}

/** Members can invite as many people as they like, but at most N per rolling 7 days (setting invitation_weekly_limit, default 50). */
export async function invitationQuota(userId: string, db: Db = getPool()): Promise<{ limit: number; used: number; remaining: number; nextFreeAt: string | null }> {
  const limit = await getNum('invitation_weekly_limit', 50, db);
  const r = await one<{ used: number; oldest: string | null }>(
    `SELECT count(*)::int AS used, min(created_at) AS oldest FROM invitations WHERE inviter_user_id=$1 AND role='member' AND created_at > now() - interval '7 days'`, [userId], db);
  const used = r?.used ?? 0;
  const nextFreeAt = used >= limit && r?.oldest ? new Date(new Date(r.oldest).getTime() + 7 * 86400_000).toISOString() : null;
  return { limit, used, remaining: Math.max(0, limit - used), nextFreeAt };
}
async function checkWeeklyInviteLimit(userId: string, db: Db) {
  const qta = await invitationQuota(userId, db);
  if (qta.limit > 0 && qta.used >= qta.limit) {
    const p = qta.nextFreeAt ? Object.fromEntries(new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(qta.nextFreeAt)).map(x => [x.type, x.value])) : null;
    throw new DomainError('invite_limit', `Du kan sende maks ${qta.limit} invitasjoner per uke.${p ? ` Du kan sende flere fra ${p.day.padStart(2, '0')}.${p.month.padStart(2, '0')}. kl. ${p.hour.padStart(2, '0')}:${p.minute.padStart(2, '0')}.` : ''}`);
  }
}

export async function getInvitationByToken(token: string) {
  return one<{ id: string; invitee_email: string; invitee_name: string | null; status: string; expires_at: string; inviter_name: string; role: string; property_name: string | null; presentation_id: string | null; presentation_title: string | null; lang: 'no' | 'en' }>(
    `SELECT i.id, i.invitee_email, i.invitee_name, i.status, i.expires_at, u.name AS inviter_name, i.role, (SELECT name FROM properties WHERE id=i.property_id) AS property_name,
       i.presentation_id, (SELECT title FROM presentations WHERE id=i.presentation_id AND active) AS presentation_title, i.lang
     FROM invitations i JOIN users u ON u.id = i.inviter_user_id WHERE i.token_hash = $1`, [hashToken(token)]);
}

/** Creates the member account, the referral relation, and an AAL1 session (TOTP enrollment follows). */
export async function acceptInvitation(token: string, input: { name: string; phone?: string; marketingConsent?: boolean },
  ip: string | null, ua: string | null): Promise<{ userId: string; sessionToken: string }> {
  await rateLimit(`accept:ip:${ip ?? 'unknown'}`, 20, 900);
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError('bad_name', 'Skriv inn fullt navn.');
  return tx(async c => {
    const inv = await one<{ id: string; invitee_email: string; inviter_user_id: string; status: string; expires_at: string; role: string; property_id: string | null }>(
      `SELECT id, invitee_email, inviter_user_id, status, expires_at, role, property_id FROM invitations WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(token)], c);
    if (!inv) throw new DomainError('invalid_invite', 'Invitasjonen finnes ikke.');
    if (inv.status === 'accepted') throw new DomainError('used_invite', 'Denne invitasjonen er allerede brukt.');
    if (inv.status === 'revoked') throw new DomainError('revoked_invite', 'Invitasjonen er trukket tilbake.');
    if (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) {
      await c.query(`UPDATE invitations SET status='expired' WHERE id=$1`, [inv.id]);
      throw new DomainError('expired_invite', 'Invitasjonen er utløpt. Be personen som inviterte deg om en ny.');
    }
    const inviter = await one<{ id: string; system_role: string; status: string; loyalty_status: string; invite_tier: string | null }>(
      'SELECT id, system_role, status, loyalty_status, invite_tier FROM users WHERE id = $1', [inv.inviter_user_id], c);
    if (!inviter || inviter.status !== 'active') throw new DomainError('inviter_inactive', 'Invitasjonen er ikke lenger gyldig.');
    const adminInvited = inviter.system_role === 'admin' || inviter.system_role === 'super_admin';
    if (inv.role === 'helper') return acceptHelper(c, inv, inviter.id, name, input.phone ?? '', ip, ua);

    let user: { id: string; system_role: string } | null;
    try {
      user = await one(
        `INSERT INTO users (email, name, phone, system_role, status, invite_tier, loyalty_status, invited_by_user_id, referral_code, marketing_consent)
         VALUES ($1,$2,$3,'member','active',$4,$5,$6,$7,$8) RETURNING id, system_role`,
        [inv.invitee_email, name, input.phone?.trim() || null, adminInvited ? 'admin_invited' : 'member_invited',
         adminInvited ? 'not_applicable' : 'can_apply', inviter.id, humanCode(8), !!input.marketingConsent], c);
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('duplicate', 'Det finnes allerede en konto for denne e-postadressen.');
      throw e;
    }
    await c.query(`UPDATE invitations SET status='accepted', accepted_at=now(), accepted_user_id=$2 WHERE id=$1`, [inv.id, user!.id]);
    await c.query(`INSERT INTO referrals (referrer_user_id, referred_user_id, invitation_id) VALUES ($1,$2,$3)`,
      [inviter.id, user!.id, inv.id]);
    const actor: Actor = { id: user!.id, type: 'member', ip };
    await audit(c, actor, 'user.created_from_invitation', 'user', user!.id, undefined, { invitation_id: inv.id, inviter: inviter.id });
    const inviterRow = await one<{ email: string }>('SELECT email FROM users WHERE id=$1', [inviter.id], c);
    await enqueue({ userId: inviter.id, to: inviterRow!.email, type: 'invitation_accepted', subject: `${name} har takket ja til invitasjonen`,
      body: `${name} er nå medlem av Mountain Retreat. Når ${name} har fullført sitt første opphold, får dere begge vervebonus.` }, c);
    await notifyAdmins({ type: 'member_registered', subject: `Nytt medlem: ${name}`, body: `${name} (${inv.invitee_email}) har registrert seg via invitasjon.` }, c);
    const sessionToken = await createSession(user!.id, 'member', { aal: 1, ip, ua }, c);
    return { userId: user!.id, sessionToken };
  });
}

export async function revokeInvitation(invitationId: string, actingUser: UserLike, actor: Actor) {
  await tx(async c => {
    const inv = await one<{ inviter_user_id: string; status: string }>('SELECT inviter_user_id, status FROM invitations WHERE id=$1 FOR UPDATE', [invitationId], c);
    if (!inv) throw new DomainError('not_found', 'Fant ikke invitasjonen.');
    if (!isAdmin(actingUser) && inv.inviter_user_id !== actingUser.id) throw forbidden();
    if (inv.status !== 'pending') throw new DomainError('not_pending', 'Kun ventende invitasjoner kan trekkes tilbake.');
    await c.query(`UPDATE invitations SET status='revoked' WHERE id=$1`, [invitationId]);
    await audit(c, actor, 'invitation.revoked', 'invitation', invitationId, { status: 'pending' }, { status: 'revoked' });
  });
}

export async function applyForLoyalty(user: UserLike, actor: Actor) {
  if (!can(user, 'apply_loyalty')) throw forbidden('Du kan ikke søke nå.');
  await tx(async c => {
    const recent = await one(`SELECT 1 FROM loyalty_applications WHERE applicant_user_id=$1 AND status='rejected' AND reviewed_at > now() - interval '3 months'`, [user.id], c);
    if (recent) throw new DomainError('too_soon', 'Du kan søke igjen tre måneder etter forrige avslag.');
    try {
      const a = await one<{ id: string }>(`INSERT INTO loyalty_applications (applicant_user_id) VALUES ($1) RETURNING id`, [user.id], c);
      await c.query(`UPDATE users SET loyalty_status='applied' WHERE id=$1`, [user.id]);
      await audit(c, actor, 'loyalty.applied', 'loyalty_application', a!.id);
      await notifyAdmins({ type: 'loyalty_application', subject: 'Ny søknad om invitasjonsrett', body: 'Et medlem har søkt om å kunne invitere andre. Se godkjenningskøen.' }, c);
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('pending', 'Du har allerede en søknad til behandling.');
      throw e;
    }
  });
}

export async function decideLoyalty(applicationId: string, approve: boolean, actor: Actor) {
  await tx(async c => {
    const a = await one<{ applicant_user_id: string; status: string }>('SELECT applicant_user_id, status FROM loyalty_applications WHERE id=$1 FOR UPDATE', [applicationId], c);
    if (!a || a.status !== 'pending') throw new DomainError('not_pending', 'Søknaden er allerede behandlet.');
    await c.query(`UPDATE loyalty_applications SET status=$2, reviewed_by_user_id=$3, reviewed_at=now() WHERE id=$1`,
      [applicationId, approve ? 'approved' : 'rejected', actor.id]);
    await c.query(`UPDATE users SET loyalty_status=$2 WHERE id=$1`, [a.applicant_user_id, approve ? 'approved' : 'can_apply']);
    await audit(c, actor, approve ? 'loyalty.approved' : 'loyalty.rejected', 'loyalty_application', applicationId);
    const u = await one<{ email: string; name: string }>('SELECT email, name FROM users WHERE id=$1', [a.applicant_user_id], c);
    await enqueue({ userId: a.applicant_user_id, to: u!.email, type: 'loyalty_decided',
      subject: approve ? 'Du kan nå invitere andre' : 'Søknaden om invitasjonsrett ble ikke godkjent',
      body: approve ? `Hei ${u!.name}! Du kan nå invitere venner til Retreat Club fra medlemssiden din.` : `Hei ${u!.name}. Søknaden ble ikke godkjent denne gangen. Du kan søke igjen om tre måneder.` }, c);
  });
}

export async function setMemberStatus(userId: string, status: 'active' | 'suspended' | 'revoked', actor: Actor, cancelBookings: (c: PoolClient) => Promise<void>) {
  await tx(async c => {
    const u = await one<{ status: string; system_role: string }>('SELECT status, system_role FROM users WHERE id=$1 FOR UPDATE', [userId], c);
    if (!u) throw new DomainError('not_found', 'Fant ikke brukeren.');
    if (u.system_role === 'super_admin') throw forbidden('Super-admin kan ikke suspenderes her.');
    await c.query('UPDATE users SET status=$2, updated_at=now() WHERE id=$1', [userId, status]);
    if (status !== 'active') {
      await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      await c.query(`UPDATE invitations SET status='revoked' WHERE inviter_user_id=$1 AND status='pending'`, [userId]);
    }
    if (status === 'revoked') await cancelBookings(c);
    await audit(c, actor, `user.status_${status}`, 'user', userId, { status: u.status }, { status });
  });
}

export async function listInvitationsFor(userId: string, db: Db = getPool()) {
  return q(`SELECT i.id, i.invitee_email, i.invitee_name, i.status, i.created_at, i.expires_at, u.name AS member_name,
              r.status AS referral_status
            FROM invitations i LEFT JOIN users u ON u.id = i.accepted_user_id LEFT JOIN referrals r ON r.invitation_id = i.id
            WHERE i.inviter_user_id = $1 ORDER BY i.created_at DESC`, [userId], db);
}

// ------------------------------------------------------------------ cleaning staff
/** Admin invites a cleaner. The cleaner registers herself with name, phone and e-mail via the link. */
export async function createHelperInvitation(admin: UserLike & { email: string; name: string }, input: { email: string; name?: string; propertyId?: string | null }, actor: Actor) {
  if (!isAdmin(admin)) throw forbidden();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new DomainError('bad_email', 'Ugyldig e-postadresse.');
  const token = randomToken();
  const days = await getNum('invitation_validity_days', 10);
  return tx(async c => {
    if (await one('SELECT id FROM users WHERE lower(email) = $1', [email], c)) throw new DomainError('exists', 'E-postadressen er allerede i bruk.');
    await c.query(`UPDATE invitations SET status='expired' WHERE lower(invitee_email)=$1 AND status='pending' AND expires_at < now()`, [email]);
    let inv: { id: string } | null;
    try {
      inv = await one<{ id: string }>(`INSERT INTO invitations (inviter_user_id, invitee_email, invitee_name, role, property_id, token_hash, expires_at)
        VALUES ($1,$2,$3,'helper',$4,$5, now() + make_interval(days => $6)) RETURNING id`, [admin.id, email, input.name?.trim() || null, input.propertyId || null, hashToken(token), days], c);
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('pending_exists', 'Denne personen har allerede en aktiv invitasjon.');
      throw e;
    }
    const link = appUrl('/invitasjon/' + token);
    await enqueue({ to: email, type: 'helper_invitation', subject: 'Du er invitert som renholder – Mountain Retreat',
      body: `Hei${input.name ? ' ' + input.name : ''}!\n\n${admin.name} har gitt deg tilgang til renholdsportalen for Mountain Retreat (FKE Property AS). Der ser du alle vasker, tider og hvilke senger som skal redes, og du får varsel om nye bookinger og påminnelse samme dag.\n\nRegistrer deg med navn og mobilnummer her (gyldig i ${days} dager):\n${link}` }, c);
    await audit(c, actor, 'invitation.helper_sent', 'invitation', inv!.id, undefined, { email });
    return { invitationId: inv!.id, link };
  });
}

async function acceptHelper(c: PoolClient, inv: { id: string; invitee_email: string; property_id: string | null }, inviterId: string, name: string, phone: string,
  ip: string | null, ua: string | null): Promise<{ userId: string; sessionToken: string }> {
  const cleanPhone = phone.replace(/[^\d+]/g, '');
  if (cleanPhone.replace(/\D/g, '').length < 8) throw new DomainError('phone', 'Mobilnummer er påkrevd for renholdere (brukes til varsler).');
  let user: { id: string } | null;
  try {
    user = await one(`INSERT INTO users (email, name, phone, system_role, status, invited_by_user_id, referral_code) VALUES ($1,$2,$3,'helper','active',$4,$5) RETURNING id`,
      [inv.invitee_email, name, cleanPhone, inviterId, humanCode(8)], c);
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('duplicate', 'Det finnes allerede en konto for denne e-postadressen.');
    throw e;
  }
  await c.query(`UPDATE invitations SET status='accepted', accepted_at=now(), accepted_user_id=$2 WHERE id=$1`, [inv.id, user!.id]);
  if (inv.property_id) {
    await c.query(`INSERT INTO helper_property_assignments (helper_user_id, property_id, assigned_by_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [user!.id, inv.property_id, inviterId]);
  }
  await audit(c, { id: user!.id, type: 'helper', ip }, 'user.helper_registered', 'user', user!.id, undefined, { invitation_id: inv.id });
  await notifyAdmins({ type: 'helper_registered', subject: `Ny renholder registrert: ${name}`, body: `${name} (${inv.invitee_email}, ${cleanPhone}) har registrert seg i renholdsportalen.` }, c);
  return { userId: user!.id, sessionToken: await createSession(user!.id, 'helper', { aal: 1, ip, ua }, c) };
}
