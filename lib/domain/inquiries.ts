import { getPool, one } from '../db';
import { rateLimit } from '../ratelimit';
import { enqueue, appUrl } from '../notify';
import { getStr } from '../settings';
import { audit } from '../audit';
import { DomainError } from '../errors';
import { fmtDate } from '../format';

export type LongTermInput = {
  name: string; email: string; phone?: string; propertyId?: string | null; moveIn?: string | null;
  duration?: string; persons?: number | null; message: string; consent: boolean; website?: string; // website = honeypot
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Public long-term rental enquiry → stored, e-mailed to the configured address (reply-to = sender), confirmation to sender. */
export async function submitLongTermInquiry(i: LongTermInput, ip: string | null): Promise<{ id: string | null }> {
  if (i.website) return { id: null }; // bot filled the hidden field: pretend success, store nothing
  const name = i.name.trim(), email = i.email.trim().toLowerCase(), message = i.message.trim();
  if (name.length < 2) throw new DomainError('name', 'Skriv inn navnet ditt.');
  if (!EMAIL_RE.test(email)) throw new DomainError('email', 'Ugyldig e-postadresse.');
  if (message.length < 10) throw new DomainError('message', 'Fortell litt om hva du ser etter (minst 10 tegn).');
  if (!i.consent) throw new DomainError('consent', 'Du må samtykke til at vi lagrer henvendelsen.');
  if (i.moveIn && !/^\d{4}-\d{2}-\d{2}$/.test(i.moveIn)) throw new DomainError('date', 'Ugyldig dato.');
  await rateLimit(`lt:ip:${ip ?? 'x'}`, 5, 3600);
  await rateLimit(`lt:email:${email}`, 3, 86400);
  const db = getPool();
  const prop = i.propertyId ? await one<{ id: string; name: string }>('SELECT id, name FROM properties WHERE id=$1 AND active', [i.propertyId], db) : null;
  const row = await one<{ id: string }>(
    `INSERT INTO long_term_inquiries (name, email, phone, property_id, move_in_date, duration, persons, message, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [name.slice(0, 120), email, i.phone?.trim().slice(0, 40) || null, prop?.id ?? null, i.moveIn || null, i.duration?.trim().slice(0, 80) || null,
     i.persons && i.persons > 0 ? Math.min(20, Math.floor(i.persons)) : null, message.slice(0, 4000), ip], db);
  const to = await getStr('long_term_contact_email', 'frank@mountainretreat.no', db);
  await enqueue({ to, type: 'long_term_inquiry', subject: `Forespørsel om fast leie fra ${name}`, payload: { replyTo: email },
    body: [`Ny forespørsel om fast leie via mountainretreat.no`, '', `Navn: ${name}`, `E-post: ${email}`, `Telefon: ${i.phone?.trim() || '–'}`,
      `Bolig: ${prop?.name ?? 'Ikke spesifisert'}`, `Ønsket innflytting: ${i.moveIn ? fmtDate(i.moveIn) : '–'}`, `Varighet: ${i.duration?.trim() || '–'}`,
      `Antall personer: ${i.persons || '–'}`, '', 'Melding:', message, '', `Svar direkte på denne e-posten for å kontakte ${name}.`, `Alle forespørsler: ${appUrl('/admin/foresporsler')}`].join('\n') }, db);
  await enqueue({ to: email, type: 'long_term_inquiry_receipt', subject: 'Vi har mottatt forespørselen din – Mountain Retreat',
    body: `Hei ${name}!\n\nTakk for at du tok kontakt om fast leie. Vi har mottatt forespørselen og svarer deg så snart vi kan.\n\nVennlig hilsen\nMountain Retreat / FKE Property AS` }, db);
  await audit(db, { id: null, type: 'anonymous', ip }, 'inquiry.long_term_received', 'long_term_inquiry', row!.id);
  return { id: row!.id };
}
