'use server';
import { run, str, int } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor } from '@/lib/audit';
import { requestBooking, startPayment, requestCancellation } from '@/lib/domain/bookings';
import { createInvitation, revokeInvitation, applyForLoyalty } from '@/lib/domain/invitations';
import { updatePreparation } from '@/lib/domain/cleaning';
import { one, getPool, tx } from '@/lib/db';
import { DomainError, forbidden } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { redirect } from 'next/navigation';
import { revokeAllSessions } from '@/lib/auth/sessions';
import { nightsBetween, todayOslo } from '@/lib/format';

export async function requestBookingAction(f: FormData) {
  const u = await assertUser('request_booking');
  const actor = actorFor(u, await clientIp());
  const slug = str(f, 'slug');
  await run(`/medlem/boliger/${slug}`, async () => {
    let addOns: { id: string; quantity: number }[] = [];
    try { addOns = JSON.parse(str(f, 'addons') || '[]'); } catch { /* ignore */ }
    const b = await requestBooking(u, {
      propertyId: str(f, 'propertyId'), startDate: str(f, 'fra'), endDate: str(f, 'til'),
      adults: int(f, 'voksne', 1), children: int(f, 'barn'), infants: int(f, 'sped'), addOns,
      specialRequests: str(f, 'requests'), useRewards: !!f.get('useRewards'), idempotencyKey: str(f, 'idem') || undefined,
    }, actor);
    return { redirect: `/medlem/bookinger/${b.id}`, ok: 'Forespørselen er sendt. Du får beskjed når den er behandlet.' };
  });
}

export async function payAction(f: FormData) {
  const u = await assertUser('request_booking');
  const id = str(f, 'id');
  let url: string | null = null;
  await run(`/medlem/bookinger/${id}`, async () => {
    const method = str(f, 'method') as 'stripe_card' | 'vipps' | 'invoice';
    const r = await startPayment(id, u, method);
    if ('checkoutUrl' in r) url = r.checkoutUrl;
    return url ? { redirect: url } : 'Bookingen er bekreftet. Fakturaen sendes til deg på e-post.';
  });
}

export async function cancelAction(f: FormData) {
  const u = await assertUser('request_booking');
  const id = str(f, 'id');
  await run(`/medlem/bookinger/${id}`, async () => {
    const r = await requestCancellation(id, u, actorFor(u, await clientIp()));
    return r === 'cancelled' ? 'Bookingen er kansellert.' : 'Kanselleringen er sendt til godkjenning.';
  });
}

export async function updateMyPreparationAction(f: FormData) {
  const u = await assertUser('request_booking');
  const id = str(f, 'bookingId');
  await run(`/medlem/bookinger/${id}`, async () => {
    const b = await one<{ member_id: string; start: string; prep_id: string; max_guests: number; status: string; booked: number }>(
      `SELECT b.member_id, to_char(b.start_date,'YYYY-MM-DD') AS start, sp.id AS prep_id, p.max_guests, b.status, b.adults + b.children AS booked FROM bookings b JOIN stay_preparations sp ON sp.booking_id=b.id JOIN properties p ON p.id=b.property_id WHERE b.id=$1`, [id]);
    if (!b || b.member_id !== u.id) throw forbidden();
    if (nightsBetween(todayOslo(), b.start) < 7) throw new DomainError('cutoff', 'Endringer må gjøres senest 7 dager før ankomst. Kontakt oss.');
    if (!['pending_review', 'awaiting_payment', 'confirmed'].includes(b.status)) throw new DomainError('bad_state', 'Kan ikke endres.');
    const adults = int(f, 'adults', 1), children = int(f, 'children'), infants = int(f, 'infants');
    if (adults < 1 || adults + children > b.max_guests) throw new DomainError('bad_guests', `1–${b.max_guests} gjester.`);
    if (adults + children > b.booked) throw new DomainError('more_guests', 'Flere gjester enn bestilt kan påvirke prisen. Kontakt oss, så oppdaterer vi bookingen.');
    await updatePreparation(b.prep_id, { adults, children, infants, comment: str(f, 'comment'), arrival: str(f, 'arrival') || null }, actorFor(u));
    await getPool().query('UPDATE bookings SET adults=$2, children=$3, infants=$4 WHERE id=$1', [id, adults, children, infants]);
    return 'Lagret.';
  });
}

export async function inviteAction(f: FormData) {
  const u = await assertUser('invite');
  await run('/medlem/invitasjoner', async () => {
    await createInvitation(u, { email: str(f, 'email'), name: str(f, 'name'), presentationId: (v => v === 'none' ? null : /^[0-9a-f-]{36}$/i.test(v) ? v : undefined)(str(f, 'presentationId')), lang: str(f, 'lang') === 'en' ? 'en' : 'no' }, actorFor(u, await clientIp()));
    return 'Invitasjonen er sendt.';
  });
}

export async function revokeMyInvitationAction(f: FormData) {
  const u = await assertUser();
  await run('/medlem/invitasjoner', async () => { await revokeInvitation(str(f, 'id'), u as any, actorFor(u)); return 'Invitasjonen er trukket tilbake.'; });
}

export async function applyLoyaltyAction() {
  const u = await assertUser();
  await run('/medlem/invitasjoner', async () => { await applyForLoyalty(u as any, actorFor(u)); return 'Søknaden er sendt.'; });
}

export async function updateProfileAction(f: FormData) {
  const u = await assertUser();
  await run('/medlem/profil', async () => {
    const name = str(f, 'name');
    if (name.length < 2) throw new DomainError('bad_name', 'Skriv inn navnet ditt.');
    await getPool().query('UPDATE users SET name=$2, phone=$3, marketing_consent=$4, updated_at=now() WHERE id=$1', [u.id, name, str(f, 'phone') || null, !!f.get('marketing')]);
    await audit(null, actorFor(u), 'user.profile_updated', 'user', u.id);
    return 'Profilen er oppdatert.';
  });
}

/** GDPR right to erasure: strips personal data, keeps financial records under a pseudonymous id. */
export async function anonymizeAction(f: FormData) {
  const u = await assertUser();
  if (!['SLETT', 'DELETE'].includes(str(f, 'confirm').trim().toUpperCase())) redirect('/medlem/profil?feil=' + encodeURIComponent('Skriv SLETT for å bekrefte.'));
  const active = await one(`SELECT 1 FROM bookings WHERE member_id=$1 AND status IN ('pending_review','awaiting_payment','confirmed','cancellation_requested')`, [u.id]);
  if (active) redirect('/medlem/profil?feil=' + encodeURIComponent('Du har aktive bookinger. Kanseller dem eller vent til oppholdet er over.'));
  await tx(async c => {
    await c.query(`UPDATE users SET status='anonymized', name='Anonymisert medlem', email='anon-'||id||'@anonymized.invalid', phone=NULL, totp_secret_encrypted=NULL,
                   recovery_codes_hashed=NULL, referral_code=NULL, marketing_consent=false, updated_at=now() WHERE id=$1`, [u.id]);
    await c.query(`UPDATE invitations SET status='revoked' WHERE inviter_user_id=$1 AND status='pending'`, [u.id]);
    await c.query(`UPDATE stay_preparations SET comment_for_cleaner=NULL WHERE booking_id IN (SELECT id FROM bookings WHERE member_id=$1)`, [u.id]);
    await audit(c, actorFor(u), 'user.anonymized', 'user', u.id);
  });
  await revokeAllSessions(u.id);
  redirect('/?ok=anonymisert');
}
