import { PoolClient } from 'pg';
import { Db, getPool, isPgError, one, PG_UNIQUE_VIOLATION, q, tx } from '../db';
import { DomainError, forbidden } from '../errors';
import { audit, Actor, SYSTEM } from '../audit';
import { appUrl, enqueue, notifyAdmins } from '../notify';
import { getNum } from '../settings';
import { humanCode } from '../crypto';
import { fmtDate, hoursText, nightsBetween, nok, pctNo, todayOslo } from '../format';
import { isAdmin, can, UserLike } from '../auth/rbac';
import { quoteFor } from './pricing';
import { insertBlock, isRangeFree, removeBlocksFor } from './availability';
import { qualifyReferralForBooking, redeemForBooking, rewardBalance, reverseRedemptions } from './rewards';
import { cardProvider, kidMod10, providerById } from './payments';
import { reconcileCleaningTasks, upsertBookingPreparation } from './cleaning';
import { memberDiscount } from './memberDiscount';

export type BookingRequestInput = {
  propertyId: string; startDate: string; endDate: string; adults: number; children: number; infants: number;
  addOns: { id: string; quantity: number }[]; specialRequests?: string; useRewards?: boolean; idempotencyKey?: string; ownLinen?: boolean | number;
};

type BookingRow = {
  id: string; reference: string; property_id: string; member_id: string; start_date: string; end_date: string; status: string;
  adults: number; children: number; infants: number; price_total_ore: number; stay_price_ore: number; reward_discount_ore: number;
  payment_method: string | null; price_breakdown: any;
};

const BOOKING_COLS = `id, reference, property_id, member_id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date,
  status, adults, children, infants, price_total_ore, stay_price_ore, reward_discount_ore, payment_method, price_breakdown`;

async function lockBooking(c: PoolClient, id: string): Promise<BookingRow> {
  const b = await one<BookingRow>(`SELECT ${BOOKING_COLS} FROM bookings WHERE id=$1 FOR UPDATE`, [id], c);
  if (!b) throw new DomainError('not_found', 'Fant ikke bookingen.', 404);
  return b;
}
async function memberOf(c: Db, id: string) {
  return (await one<{ id: string; email: string; name: string }>('SELECT id, email, name FROM users WHERE id=$1', [id], c))!;
}
async function propertyName(c: Db, id: string) {
  return (await one<{ name: string }>('SELECT name FROM properties WHERE id=$1', [id], c))!.name;
}

/** Tells the member their discount went up thanks to this booking (until the loyalty cap is reached). */
async function announceDiscountLevel(c: PoolClient, memberId: string, bookingId: string) {
  const before = await memberDiscount(memberId, c, bookingId);
  const after = await memberDiscount(memberId, c);
  if (after.totalPct <= before.totalPct) return;
  const m = await memberOf(c, memberId);
  await enqueue({ userId: memberId, to: m.email, type: 'discount_increased', dedupeKey: `discount_increased:${bookingId}`,
    subject: `Medlemsrabatten din er nå ${pctNo(after.totalPct)} %`,
    body: `Hei ${m.name}!\n\nTakk for bookingen. Medlemsrabatten din har økt fra ${pctNo(before.totalPct)} % til ${pctNo(after.totalPct)} % på alle fremtidige opphold.` +
      (after.atMax ? `\nDu har nå nådd maksimal lojalitetsrabatt. 🎉` : `\nNeste booking gir ${pctNo(after.nextTotalPct)} %.`) }, c);
}

// ---------------------------------------------------------------- request
export async function requestBooking(member: UserLike & { email: string; name: string }, input: BookingRequestInput, actor: Actor) {
  if (!can(member, 'request_booking')) throw forbidden();
  const guests = input.adults + input.children; // infants don't count toward occupancy
  if (input.adults < 1) throw new DomainError('bad_guests', 'Minst én voksen må være med.');
  if (input.startDate < todayOslo()) throw new DomainError('past', 'Innreise kan ikke være tilbake i tid.');
  const quote = await quoteFor(input.propertyId, member.id, input.startDate, input.endDate, guests, input.addOns, getPool(), null, input.ownLinen ?? 0);
  // Friendly early check; authoritative check happens at approval via the exclusion constraint
  if (!(await isRangeFree(input.propertyId, input.startDate, input.endDate))) {
    throw new DomainError('unavailable', 'Datoene er ikke ledige.');
  }
  const autoApprove = (await getNum('booking_auto_approve', 0)) === 1;
  const estimatedReward = input.useRewards ? Math.min((await rewardBalance(member.id)).next?.amount ?? 0, quote.subtotal_ore) : 0;
  try {
    const created = await tx(async c => {
      const b = await one<{ id: string; reference: string }>(
        `INSERT INTO bookings (reference, property_id, member_id, start_date, end_date, adults, children, infants,
           stay_price_ore, cleaning_fee_ore, add_ons_price_ore, extra_guest_fee_ore, reward_discount_ore, price_total_ore, price_breakdown, special_requests, request_idempotency_key, own_linen, own_linen_persons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$16,0,$12,$13,$14,$15,$17,$18) RETURNING id, reference`,
        ['MR-' + humanCode(6), input.propertyId, member.id, input.startDate, input.endDate, input.adults, input.children, input.infants,
         quote.stay_ore, quote.cleaning_fee_ore, quote.add_ons_ore, quote.subtotal_ore,
         JSON.stringify({ quote, use_rewards: !!input.useRewards, estimated_reward_ore: estimatedReward }),
         input.specialRequests?.trim().slice(0, 2000) || null, input.idempotencyKey ?? null, quote.extra_guest_fee_ore, !!quote.own_linen, quote.own_linen_persons ?? 0], c);
      for (const a of quote.add_ons) {
        await c.query(`INSERT INTO booking_add_ons (booking_id, add_on_item_id, quantity, unit_price_at_selection_ore, total_price_ore) VALUES ($1,$2,$3,$4,$5)`,
          [b!.id, a.id, a.quantity, a.unit_price_ore, a.total_ore]);
      }
      await upsertBookingPreparation(c, b!.id, input.propertyId, { adults: input.adults, children: input.children, infants: input.infants, ownLinen: !!quote.own_linen, ownLinenPersons: quote.own_linen_persons ?? 0 });
      await audit(c, actor, 'booking.requested', 'booking', b!.id, undefined, { ...input, total: quote.subtotal_ore });
      const prop = await propertyName(c, input.propertyId);
      if (autoApprove) return { ...b!, prop };
      await notifyAdmins({ type: 'booking_requested', dedupeKey: `booking_requested:${b!.id}`, subject: `Ny bookingforespørsel ${b!.reference}`,
        body: `${member.name} ønsker ${prop} ${fmtDate(input.startDate)} – ${fmtDate(input.endDate)} (${guests} gjester${input.infants ? ` + ${input.infants} spedbarn` : ''}).\nEstimert pris: ${nok(quote.subtotal_ore)}${input.specialRequests?.trim() ? `\n\nKommentar fra medlemmet:\n${input.specialRequests.trim()}` : ''}\n\nBehandle: ${appUrl('/admin/bookinger/' + b!.id)}` }, c);
      await enqueue({ userId: member.id, to: member.email, type: 'booking_request_received', dedupeKey: `booking_request_received:${b!.id}`,
        subject: `Vi har mottatt forespørselen din (${b!.reference})`,
        body: `Hei ${member.name}!\n\nTakk for forespørselen om ${prop} ${fmtDate(input.startDate)} – ${fmtDate(input.endDate)}. Du får beskjed så snart den er behandlet.` }, c);
      return { ...b!, prop };
    });
    if (!autoApprove) return { id: created.id, reference: created.reference, status: 'pending_review' as const };
    return await autoApproveBooking(created, member, input, quote.subtotal_ore);
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION) && input.idempotencyKey) {
      // Double-submit: return the booking created by the first click
      const existing = await one<{ id: string; reference: string; status: string }>('SELECT id, reference, status FROM bookings WHERE member_id=$1 AND request_idempotency_key=$2', [member.id, input.idempotencyKey]);
      if (existing) return existing;
    }
    throw e;
  }
}

/**
 * Direct booking (setting booking_auto_approve=1): the request is approved by the system straight away, so the price is
 * locked and the dates are held while the member pays. If that fails (e.g. the dates were taken a moment ago) the booking
 * stays pending and is handled manually as before.
 */
async function autoApproveBooking(b: { id: string; reference: string; prop: string }, member: UserLike & { email: string; name: string }, input: BookingRequestInput, estimateOre: number) {
  const guests = input.adults + input.children;
  const period = `${b.prop} ${fmtDate(input.startDate)} – ${fmtDate(input.endDate)} (${guests} gjester${input.infants ? ` + ${input.infants} spedbarn` : ''})`;
  try {
    const r = await approveBooking(b.id, SYSTEM);
    const total = (await one<{ price_total_ore: number }>('SELECT price_total_ore FROM bookings WHERE id=$1', [b.id]))!.price_total_ore;
    await notifyAdmins({ type: 'booking_requested', dedupeKey: `booking_requested:${b.id}`, subject: `Ny booking ${b.reference}${r.status === 'confirmed' ? ' (bekreftet)' : ' (venter på betaling)'}`,
      body: `${member.name} har booket ${period}.
Pris: ${nok(total)}
Status: ${r.status === 'confirmed' ? 'bekreftet' : 'venter på betaling'} (direktebooking – ingen godkjenning nødvendig).${input.specialRequests?.trim() ? `\n\nKommentar fra medlemmet:\n${input.specialRequests.trim()}` : ''}

Se bookingen: ${appUrl('/admin/bookinger/' + b.id)}` });
    return { id: b.id, reference: b.reference, status: r.status };
  } catch (e) {
    await notifyAdmins({ type: 'booking_requested', dedupeKey: `booking_requested:${b.id}`, subject: `Booking ${b.reference} må behandles manuelt`,
      body: `${member.name} prøvde å booke ${period}, men den kunne ikke godkjennes automatisk (${e instanceof Error ? e.message : 'ukjent feil'}).
Estimert pris: ${nok(estimateOre)}

Behandle: ${appUrl('/admin/bookinger/' + b.id)}` });
    await enqueue({ userId: member.id, to: member.email, type: 'booking_request_received', dedupeKey: `booking_request_received:${b.id}`,
      subject: `Vi har mottatt bookingen din (${b.reference})`,
      body: `Hei ${member.name}!

Takk for bookingen av ${b.prop} ${fmtDate(input.startDate)} – ${fmtDate(input.endDate)}. Vi må se på den før den kan bekreftes, og du får beskjed så snart den er behandlet.` });
    return { id: b.id, reference: b.reference, status: 'pending_review' as const };
  }
}

// ---------------------------------------------------------------- manual price adjustment
/**
 * The administrator sets the price the member pays (after any bonus). Before approval the adjustment is stored and
 * kept when the price is locked; while awaiting payment the locked price is changed directly (open checkouts are
 * cancelled so the member pays the new amount, a draft invoice is updated).
 */
export async function adjustBookingPrice(bookingId: string, newTotalOre: number | null, note: string, actor: Actor) {
  return tx(async c => {
    const b = await lockBooking(c, bookingId);
    if (!['pending_review', 'awaiting_payment'].includes(b.status)) throw new DomainError('bad_state', 'Prisen kan bare justeres før bookingen er betalt.');
    const oldAdj = (await one<{ a: number }>(`SELECT price_adjustment_ore AS a FROM bookings WHERE id=$1`, [b.id], c))!.a;
    let baseSubtotal: number, reward: number;
    if (b.status === 'pending_review') {
      // the estimate the member saw when requesting (the price is re-calculated and locked at approval, keeping the adjustment)
      baseSubtotal = Number(b.price_breakdown?.quote?.subtotal_ore ?? b.price_total_ore); reward = 0;
    } else {
      baseSubtotal = b.price_total_ore + b.reward_discount_ore - oldAdj; reward = b.reward_discount_ore;
    }
    const adj = newTotalOre == null ? 0 : newTotalOre + reward - baseSubtotal;
    if (newTotalOre != null && newTotalOre < 0) throw new DomainError('bad_amount', 'Prisen kan ikke være negativ.');
    await c.query(`UPDATE bookings SET price_adjustment_ore=$2, price_adjustment_note=$3, updated_at=now() WHERE id=$1`, [b.id, adj, adj ? (note.trim().slice(0, 300) || null) : null]);
    if (b.status === 'awaiting_payment') {
      const total = baseSubtotal + adj - reward;
      await c.query(`UPDATE bookings SET price_total_ore=$2,
          price_breakdown = jsonb_set(jsonb_set(jsonb_set(price_breakdown, '{quote,subtotal_ore}', to_jsonb($3::int)), '{quote,price_adjustment_ore}', to_jsonb($4::int)), '{quote,price_adjustment_note}', to_jsonb($5::text)),
          updated_at=now() WHERE id=$1`, [b.id, total, baseSubtotal + adj, adj, adj ? note.trim() : '']);
      await c.query(`UPDATE payments SET status='cancelled', updated_at=now() WHERE booking_id=$1 AND status='pending' AND method <> 'invoice'`, [b.id]);
      await c.query(`UPDATE payments SET amount_ore=$2, updated_at=now() WHERE booking_id=$1 AND status='pending' AND method='invoice'`, [b.id, total]);
      await c.query(`UPDATE invoices SET amount_ore=$2 WHERE status='draft' AND payment_id IN (SELECT id FROM payments WHERE booking_id=$1)`, [b.id, total]);
      const m = await memberOf(c, b.member_id);
      await enqueue({ userId: m.id, to: m.email, type: 'price_adjusted', subject: `Ny pris på bookingen din (${b.reference})`,
        body: `Hei ${m.name}!

Prisen for oppholdet ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} er justert til ${nok(total)}.${note.trim() ? `
${note.trim()}` : ''}

Betal her: ${appUrl('/medlem/bookinger/' + b.id)}` }, c);
    }
    await audit(c, actor, 'booking.price_adjusted', 'booking', b.id, { adjustment: oldAdj }, { adjustment: adj, newTotal: newTotalOre, note });
    return { adjustment: adj, baseSubtotal, reward };
  });
}

// ---------------------------------------------------------------- approve / reject
export async function approveBooking(bookingId: string, actor: Actor): Promise<{ status: string }> {
  return tx(async c => {
    const b = await lockBooking(c, bookingId);
    if (b.status !== 'pending_review') throw new DomainError('not_pending', 'Bookingen er allerede behandlet.');
    const guests = b.adults + b.children;
    // Re-price server-side with current rules and LOCK the price from here on
    const addOns = await q<{ add_on_item_id: string; quantity: number }>('SELECT add_on_item_id, quantity FROM booking_add_ons WHERE booking_id=$1', [b.id], c);
    const quote = await quoteFor(b.property_id, b.member_id, b.start_date, b.end_date, guests, addOns.map(a => ({ id: a.add_on_item_id, quantity: a.quantity })), c, b.id);
    // Authoritative double-booking guard
    await insertBlock(c, { propertyId: b.property_id, start: b.start_date, end: b.end_date, type: 'platform_booking', referenceId: b.id, userId: actor.id });
    const useRewards = !!b.price_breakdown?.use_rewards;
    const reward = useRewards ? await redeemForBooking(c, b.member_id, b.id, quote.subtotal_ore) : 0;
    const total = quote.subtotal_ore - reward;
    const holdHours = await getNum('booking_hold_duration_hours', 1, c);
    const newStatus = total === 0 ? 'confirmed' : 'awaiting_payment';
    await c.query(
      `UPDATE bookings SET status=$2, stay_price_ore=$3, cleaning_fee_ore=$4, add_ons_price_ore=$5, reward_discount_ore=$6, price_total_ore=$7, extra_guest_fee_ore=$10,
         price_breakdown = price_breakdown || $8::jsonb, price_locked_at=now(), approved_at=now(), admin_reviewer_id=$9,
         confirmed_at = CASE WHEN $2='confirmed' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`,
      [b.id, newStatus, quote.stay_ore, quote.cleaning_fee_ore, quote.add_ons_ore, reward, total, JSON.stringify({ quote, reward_applied_ore: reward }), actor.id, quote.extra_guest_fee_ore]);
    if (newStatus === 'awaiting_payment') {
      await c.query(`INSERT INTO booking_holds (booking_id, hold_duration_hours_at_creation, expires_at) VALUES ($1,$2, now() + make_interval(hours => $2))`, [b.id, holdHours]);
    } else {
      await reconcileCleaningTasks(c, b.property_id);
      await announceDiscountLevel(c, b.member_id, b.id);
    }
    await audit(c, actor, 'booking.approved', 'booking', b.id, { status: b.status, total: b.price_total_ore }, { status: newStatus, total, reward });
    const m = await memberOf(c, b.member_id);
    const prop = await propertyName(c, b.property_id);
    await enqueue({ userId: m.id, to: m.email, type: 'booking_approved', dedupeKey: `booking_approved:${b.id}`,
      subject: newStatus === 'confirmed' ? `Bookingen er bekreftet (${b.reference})` : actor.type === 'system' ? `Takk for bookingen – betal innen ${hoursText(holdHours)} (${b.reference})` : `Bookingen er godkjent – betal innen ${hoursText(holdHours)} (${b.reference})`,
      body: newStatus === 'confirmed'
        ? `Hei ${m.name}!\n\n${prop} ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} er bekreftet. Hele beløpet ble dekket av bonusen din.`
        : actor.type === 'system'
        ? `Hei ${m.name}!\n\nTakk for bookingen av ${prop} ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}. Datoene holdes av for deg i ${hoursText(holdHours)} – bookingen er bekreftet når betalingen er gjennomført. Betaler du ikke innen fristen, frigis datoene.\n\nÅ betale: ${nok(total)}${reward ? ` (etter ${nok(reward)} bonus)` : ''}\nBetal her: ${appUrl('/medlem/bookinger/' + b.id)}`
        : `Hei ${m.name}!\n\nForespørselen om ${prop} ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} er godkjent. Datoene holdes av for deg i ${hoursText(holdHours)}. Betaler du ikke innen fristen, frigis datoene.\n\nÅ betale: ${nok(total)}${reward ? ` (etter ${nok(reward)} bonus)` : ''}\nBetal her: ${appUrl('/medlem/bookinger/' + b.id)}` }, c);
    return { status: newStatus };
  });
}

export async function rejectBooking(bookingId: string, reason: string, actor: Actor) {
  if (!reason.trim()) throw new DomainError('reason_required', 'Oppgi en begrunnelse.');
  await tx(async c => {
    const b = await lockBooking(c, bookingId);
    if (b.status !== 'pending_review') throw new DomainError('not_pending', 'Bookingen er allerede behandlet.');
    await c.query(`UPDATE bookings SET status='rejected', rejection_reason=$2, admin_reviewer_id=$3, updated_at=now() WHERE id=$1`, [b.id, reason.trim(), actor.id]);
    await audit(c, actor, 'booking.rejected', 'booking', b.id, { status: b.status }, { status: 'rejected', reason });
    const m = await memberOf(c, b.member_id);
    await enqueue({ userId: m.id, to: m.email, type: 'booking_rejected', dedupeKey: `booking_rejected:${b.id}`, subject: `Forespørselen kunne dessverre ikke godkjennes (${b.reference})`,
      body: `Hei ${m.name}.\n\nForespørselen for ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} ble ikke godkjent.\nBegrunnelse: ${reason.trim()}` }, c);
  });
}

// ---------------------------------------------------------------- payment
export async function startPayment(bookingId: string, user: UserLike & { email: string }, method: 'stripe_card' | 'vipps' | 'invoice') {
  const b = await one<BookingRow & { hold_expires: string | null; method_enabled: boolean | null }>(
    `SELECT b.*, to_char(b.start_date,'YYYY-MM-DD') AS start_date, to_char(b.end_date,'YYYY-MM-DD') AS end_date,
            h.expires_at AS hold_expires, (SELECT enabled FROM payment_method_settings WHERE method=$2) AS method_enabled
     FROM bookings b LEFT JOIN booking_holds h ON h.booking_id=b.id AND h.released_at IS NULL WHERE b.id=$1`, [bookingId, method]);
  if (!b) throw new DomainError('not_found', 'Fant ikke bookingen.', 404);
  if (b.member_id !== user.id && !isAdmin(user)) throw forbidden();
  if (method === 'invoice' && b.status === 'confirmed' && (b as any).payment_method === 'invoice') return { invoice: true as const }; // double click
  if (b.status !== 'awaiting_payment') throw new DomainError('not_payable', 'Bookingen venter ikke på betaling.');
  if (!b.hold_expires || new Date(b.hold_expires) < new Date()) throw new DomainError('hold_expired', 'Fristen for betaling er utløpt.');
  if (method === 'invoice') {
    const allowed = await one<{ ok: boolean }>(`SELECT invoice_allowed AS ok FROM users WHERE id=$1`, [b.member_id]);
    if (!allowed?.ok) throw new DomainError('method_disabled', 'Faktura er ikke tilgjengelig for deg. Velg kort eller Vipps.');
  } else if (!b.method_enabled) throw new DomainError('method_disabled', 'Denne betalingsmåten er ikke tilgjengelig.');
  if (b.price_total_ore <= 0) throw new DomainError('nothing_to_pay', 'Ingenting å betale.');

  if (method === 'invoice') return createInvoice(b, user);
  const provider = method === 'vipps' ? providerById('vipps')! : cardProvider();
  if (!provider.configured()) throw new DomainError('provider_unconfigured', 'Betalingsløsningen er ikke satt opp ennå.');
  // Reuse an open checkout instead of creating duplicates on double clicks
  const open = await one<{ checkout_url: string }>(
    `SELECT checkout_url FROM payments WHERE booking_id=$1 AND status='pending' AND method=$2 AND provider=$3 AND created_at > now() - interval '50 minutes' AND checkout_url IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [b.id, method, provider.id]);
  if (open) return { checkoutUrl: open.checkout_url };
  const idem = `pay_${b.id}_${Date.now()}`;
  const pay = await one<{ id: string }>(
    `INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key, test_mode) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [b.id, method, provider.id, b.price_total_ore, idem, isTestPayment(method, provider.id)]);
  try {
    const res = await provider.createCheckout({ paymentId: pay!.id, bookingRef: b.reference, amountOre: b.price_total_ore,
      description: `Opphold ${b.reference} (${fmtDate(b.start_date)} – ${fmtDate(b.end_date)})`, customerEmail: user.email, idempotencyKey: idem });
    await getPool().query(`UPDATE payments SET provider_reference=$2, checkout_url=$3, updated_at=now() WHERE id=$1`, [pay!.id, res.providerReference, res.checkoutUrl]);
    await audit(null, { id: user.id, type: 'member' }, 'payment.started', 'payment', pay!.id, undefined, { provider: provider.id, amount: b.price_total_ore });
    return { checkoutUrl: res.checkoutUrl };
  } catch (e) {
    await getPool().query(`UPDATE payments SET status='failed', updated_at=now() WHERE id=$1`, [pay!.id]);
    throw new DomainError('provider_error', 'Kunne ikke starte betalingen. Prøv igjen om litt.');
  }
}

/**
 * Invoice (only for members the administrator has allowed): the booking is confirmed at once, and an invoice
 * draft (fakturagrunnlag) is made for the administrator to issue and send from Fiken. Payment stays open
 * until the administrator marks it as paid.
 */
async function createInvoice(b: BookingRow, user: UserLike) {
  return tx(async c => {
    const existing = await one<{ id: string }>(`SELECT p.id FROM payments p WHERE booking_id=$1 AND method='invoice' AND status='pending'`, [b.id], c);
    if (existing) return { invoice: true as const };
    const days = await getNum('invoice_due_date_days', 14, c);
    const pay = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) VALUES ($1,'invoice','invoice',$2,$3) RETURNING id`,
      [b.id, b.price_total_ore, `inv_${b.id}_${Date.now()}`], c);
    const seq = await one<{ n: string }>(`SELECT (count(*) + 10001)::text AS n FROM invoices`, [], c);
    const inv = await one<{ id: string; due: string }>(`INSERT INTO invoices (payment_id, invoice_number, kid_number, amount_ore, due_date, status) VALUES ($1,$2,NULL,$3, current_date + $4::int, 'draft')
      RETURNING id, to_char(due_date,'YYYY-MM-DD') AS due`, [pay!.id, `U-${seq!.n}`, b.price_total_ore, days], c);
    // Confirm the booking straight away – the member is trusted to pay the invoice
    await c.query(`UPDATE bookings SET status='confirmed', confirmed_at=now(), payment_method='invoice', updated_at=now() WHERE id=$1`, [b.id]);
    await c.query(`UPDATE booking_holds SET released_at=now() WHERE booking_id=$1 AND released_at IS NULL`, [b.id]);
    await c.query(`UPDATE payments SET status='cancelled', updated_at=now() WHERE booking_id=$1 AND status='pending' AND id<>$2`, [b.id, pay!.id]);
    await audit(c, { id: user.id, type: 'member' }, 'payment.invoice_requested', 'payment', pay!.id, undefined, { amount: b.price_total_ore, invoice: `U-${seq!.n}` });
    await audit(c, { id: user.id, type: 'member' }, 'booking.confirmed', 'booking', b.id, { status: b.status }, { status: 'confirmed', by: 'invoice' });
    await reconcileCleaningTasks(c, b.property_id);
    await announceDiscountLevel(c, b.member_id, b.id);
    const m = await memberOf(c, b.member_id);
    const prop = await propertyName(c, b.property_id);
    await enqueue({ userId: m.id, to: m.email, type: 'booking_confirmed', dedupeKey: `booking_confirmed:${b.id}`, subject: `Bekreftet: ${prop} ${fmtDate(b.start_date)} (${b.reference})`,
      body: `Hei ${m.name}!\n\nOppholdet er bekreftet.\n${prop}: ${fmtDate(b.start_date, true)} – ${fmtDate(b.end_date, true)}\nBeløp: ${nok(b.price_total_ore)}\n\nFakturaen sendes til deg på e-post fra FKE Property AS, med forfall om ${days} dager.\n\nGod tur!` }, c);
    await notifyAdmins({ type: 'invoice_to_send', dedupeKey: `invoice_to_send:${inv!.id}`, subject: `Faktura skal sendes i Fiken: ${m.name} (${b.reference})`,
      body: `${m.name} har valgt faktura for ${prop} ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}. Beløp ${nok(b.price_total_ore)}, forfall ${fmtDate(inv!.due)}.\nFakturagrunnlag: ${appUrl('/admin/betalinger/faktura/' + inv!.id)}` }, c);
    return { invoice: true as const };
  });
}

/**
 * Idempotent success handler for every provider. Safe to call any number of times for the same payment.
 * Re-checks availability before confirming; a late payment for an expired/cancelled booking is refunded automatically.
 */
export async function handlePaymentSucceeded(paymentId: string, actor: Actor = SYSTEM): Promise<'confirmed' | 'already' | 'refunded'> {
  const refundIds: string[] = [];
  const result = await tx(async c => {
    const p = await one<{ id: string; booking_id: string; status: string; amount_ore: number }>('SELECT id, booking_id, status, amount_ore FROM payments WHERE id=$1 FOR UPDATE', [paymentId], c);
    if (!p) throw new DomainError('not_found', 'Ukjent betaling.', 404);
    if (p.status !== 'pending') return 'already' as const;
    const b = await lockBooking(c, p.booking_id);
    await c.query(`UPDATE payments SET status='succeeded', updated_at=now() WHERE id=$1`, [p.id]);
    await audit(c, actor, 'payment.succeeded', 'payment', p.id, { status: 'pending' }, { status: 'succeeded' });
    const method = (await one<{ method: string }>(`SELECT method FROM payments WHERE id=$1`, [p.id], c))!.method;
    if (method === 'invoice' && ['confirmed', 'completed', 'cancellation_requested'].includes(b.status)) {
      // Invoice bookings are confirmed when the invoice is requested; this only records the payment
      const m = await memberOf(c, b.member_id);
      await enqueue({ userId: m.id, to: m.email, type: 'payment_received', dedupeKey: `invoice_paid:${p.id}`, subject: `Betaling mottatt (${b.reference})`,
        body: `Hei ${m.name}!\n\nVi har registrert betalingen på ${nok(p.amount_ore)} for ${b.reference}. Takk!` }, c);
      return 'confirmed' as const;
    }
    const block = await one(`SELECT 1 FROM availability_blocks WHERE block_type='platform_booking' AND reference_id=$1`, [b.id], c);
    if (b.status !== 'awaiting_payment' || !block) {
      const r = await one<{ id: string }>(`INSERT INTO refunds (payment_id, amount_ore, reason, status) VALUES ($1,$2,'conflict_auto_refund','pending') RETURNING id`, [p.id, p.amount_ore], c);
      refundIds.push(r!.id);
      await audit(c, actor, 'payment.late_auto_refund', 'payment', p.id, undefined, { booking_status: b.status });
      await notifyAdmins({ type: 'payment_conflict', subject: `Betaling mottatt for ${b.reference} som ikke lenger var aktiv`, body: `Beløpet refunderes automatisk. Status: ${b.status}.` }, c);
      return 'refunded' as const;
    }
    await c.query(`UPDATE bookings SET status='confirmed', confirmed_at=now(), payment_method=(SELECT method FROM payments WHERE id=$2), updated_at=now() WHERE id=$1`, [b.id, p.id]);
    await c.query(`UPDATE booking_holds SET released_at=now() WHERE booking_id=$1 AND released_at IS NULL`, [b.id]);
    await c.query(`UPDATE payments SET status='cancelled', updated_at=now() WHERE booking_id=$1 AND status='pending' AND id<>$2`, [b.id, p.id]);
    await c.query(`UPDATE invoices SET status='cancelled' WHERE payment_id IN (SELECT id FROM payments WHERE booking_id=$1 AND status='cancelled') AND status IN ('sent','overdue')`, [b.id]);
    await audit(c, actor, 'booking.confirmed', 'booking', b.id, { status: b.status }, { status: 'confirmed' });
    await reconcileCleaningTasks(c, b.property_id);
    await announceDiscountLevel(c, b.member_id, b.id);
    const m = await memberOf(c, b.member_id);
    const prop = await propertyName(c, b.property_id);
    await enqueue({ userId: m.id, to: m.email, type: 'booking_confirmed', dedupeKey: `booking_confirmed:${b.id}`, subject: `Bekreftet: ${prop} ${fmtDate(b.start_date)} (${b.reference})`,
      body: `Hei ${m.name}!\n\nBetalingen er mottatt og oppholdet er bekreftet.\n${prop}: ${fmtDate(b.start_date, true)} – ${fmtDate(b.end_date, true)}\nBetalt: ${nok(p.amount_ore)}\n\nGod tur!` }, c);
    await notifyAdmins({ type: 'booking_confirmed', dedupeKey: `booking_confirmed_admin:${b.id}`, subject: `Booking bekreftet ${b.reference}`, body: `${m.name}, ${prop} ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}. Betalt ${nok(p.amount_ore)}.` }, c);
    return 'confirmed' as const;
  });
  if (refundIds.length) await processRefunds(refundIds);
  return result;
}

export async function handlePaymentFailed(paymentId: string) {
  await tx(async c => {
    const p = await one<{ status: string }>('SELECT status FROM payments WHERE id=$1 FOR UPDATE', [paymentId], c);
    if (!p || p.status !== 'pending') return;
    await c.query(`UPDATE payments SET status='failed', updated_at=now() WHERE id=$1`, [paymentId]);
    await audit(c, SYSTEM, 'payment.failed', 'payment', paymentId);
  });
}

export async function markInvoicePaid(paymentId: string, actor: Actor) {
  await one(`UPDATE invoices SET status='paid', marked_paid_by_user_id=$2, marked_paid_at=now() WHERE payment_id=$1 AND status IN ('draft','sent','overdue') RETURNING id`, [paymentId, actor.id]);
  await audit(null, actor, 'invoice.marked_paid', 'payment', paymentId);
  return handlePaymentSucceeded(paymentId, actor);
}

// ---------------------------------------------------------------- refunds
/** Executes pending refunds against the provider (outside DB transactions). Also retried by the jobs runner. */
export async function processRefunds(ids?: string[]) {
  const rows = await q<{ id: string; amount_ore: number; provider: string; provider_reference: string | null; payment_id: string; booking_id: string }>(
    `SELECT r.id, r.amount_ore, p.provider, p.provider_reference, p.id AS payment_id, p.booking_id
     FROM refunds r JOIN payments p ON p.id = r.payment_id
     WHERE r.status='pending' ${ids ? 'AND r.id = ANY($1)' : ''} ORDER BY r.created_at LIMIT 25`, ids ? [ids] : []);
  for (const r of rows) {
    let status: 'succeeded' | 'failed' | 'pending' = 'failed', ref: string | null = null, err: string | null = null;
    try {
      if (r.provider === 'invoice') { status = 'pending'; err = 'Manuell tilbakebetaling via bank – marker som utført når overført.'; }
      else {
        const prov = providerById(r.provider);
        if (!prov || !r.provider_reference) throw new Error('Mangler leverandørreferanse');
        const res = await prov.refund(r.provider_reference, r.amount_ore, `refund_${r.id}`);
        status = res.status; ref = res.providerReference; err = res.error ?? null;
      }
    } catch (e) { status = 'failed'; err = (e as Error).message; }
    await tx(async c => {
      await c.query(`UPDATE refunds SET status=$2, provider_reference=COALESCE($3, provider_reference), error=$4 WHERE id=$1`, [r.id, status, ref, err]);
      if (status === 'succeeded') {
        await c.query(`UPDATE payments SET refunded_amount_ore = refunded_amount_ore + $2,
                         status = CASE WHEN refunded_amount_ore + $2 >= amount_ore THEN 'refunded' ELSE 'partially_refunded' END, updated_at=now() WHERE id=$1`, [r.payment_id, r.amount_ore]);
        await audit(c, SYSTEM, 'refund.succeeded', 'refund', r.id, undefined, { amount: r.amount_ore });
        const b = await one<{ member_id: string; reference: string }>('SELECT member_id, reference FROM bookings WHERE id=$1', [r.booking_id], c);
        const m = await memberOf(c, b!.member_id);
        await enqueue({ userId: m.id, to: m.email, type: 'refund_done', dedupeKey: `refund_done:${r.id}`, subject: `Refusjon ${nok(r.amount_ore)} (${b!.reference})`, body: `Hei ${m.name}! Vi har refundert ${nok(r.amount_ore)}. Det kan ta noen dager før beløpet vises på kontoen.` }, c);
      } else if (status === 'failed') {
        await audit(c, SYSTEM, 'refund.failed', 'refund', r.id, undefined, { error: err });
        await notifyAdmins({ type: 'refund_failed', dedupeKey: `refund_failed:${r.id}`, subject: 'Refusjon feilet', body: `Refusjon ${r.id} på ${nok(r.amount_ore)} feilet: ${err}. Må håndteres manuelt.` }, c);
      }
    });
  }
}

export async function markManualRefundDone(refundId: string, actor: Actor) {
  await tx(async c => {
    const r = await one<{ payment_id: string; amount_ore: number; status: string }>('SELECT payment_id, amount_ore, status FROM refunds WHERE id=$1 FOR UPDATE', [refundId], c);
    if (!r || r.status === 'succeeded') throw new DomainError('bad_state', 'Refusjonen er allerede fullført.');
    await c.query(`UPDATE refunds SET status='succeeded', error=NULL, initiated_by_user_id=COALESCE(initiated_by_user_id,$2) WHERE id=$1`, [refundId, actor.id]);
    await c.query(`UPDATE payments SET refunded_amount_ore = refunded_amount_ore + $2, status = CASE WHEN refunded_amount_ore + $2 >= amount_ore THEN 'refunded' ELSE 'partially_refunded' END WHERE id=$1`, [r.payment_id, r.amount_ore]);
    await audit(c, actor, 'refund.marked_done_manually', 'refund', refundId);
  });
}

/** Sandbox / test-environment payments are left out of revenue figures. */
function isTestPayment(method: string, providerId: string) {
  if (providerId === 'mock') return true;
  if (method === 'vipps') return process.env.VIPPS_ENV !== 'production';
  return (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test');
}

// ---------------------------------------------------------------- cancellation
async function tierFor(c: Db, propertyId: string, startDate: string) {
  const days = nightsBetween(todayOslo(), startDate);
  const tiers = await q<{ id: string; refund_percentage: string; requires_admin_approval: boolean; days_before_checkin_min: number; days_before_checkin_max: number | null; property_id: string | null }>(
    `SELECT id, refund_percentage, requires_admin_approval, days_before_checkin_min, days_before_checkin_max, property_id
     FROM cancellation_policy_tiers WHERE active AND (property_id=$1 OR property_id IS NULL)
       AND days_before_checkin_min <= $2 AND (days_before_checkin_max IS NULL OR days_before_checkin_max >= $2)
     ORDER BY property_id NULLS LAST LIMIT 1`, [propertyId, Math.max(0, days)], c);
  const t = tiers[0];
  return t ? { id: t.id, pct: Number(t.refund_percentage), needsApproval: t.requires_admin_approval, days } : { id: null, pct: 0, needsApproval: true, days };
}

/** Payment fee kept back when the guest cancels (card and Vipps): pct of the amount paid + fixed, per payment. */
export async function paymentFeeFor(amountOre: number, db: Db = getPool()) {
  const pct = await getNum('cancellation_payment_fee_pct', 2.99, db), fixed = await getNum('cancellation_payment_fee_fixed_ore', 200, db);
  return amountOre > 0 ? Math.round(amountOre * pct / 100) + Math.round(fixed) : 0;
}
const FEE_METHODS = `('stripe_card','vipps')`;

export async function cancellationPreview(bookingId: string, user: UserLike) {
  const b = await one<BookingRow>(`SELECT ${BOOKING_COLS} FROM bookings WHERE id=$1`, [bookingId]);
  if (!b) throw new DomainError('not_found', 'Fant ikke bookingen.');
  if (b.member_id !== user.id && !isAdmin(user)) throw forbidden();
  const pays = await q<{ amount: number; remaining: number; feeable: boolean }>(`SELECT amount_ore AS amount, (amount_ore - refunded_amount_ore) AS remaining, method IN ${FEE_METHODS} AS feeable FROM payments WHERE booking_id=$1 AND status IN ('succeeded','partially_refunded')`, [b.id]);
  const t = await tierFor(getPool(), b.property_id, b.start_date);
  let refundOre = 0, feeOre = 0;
  for (const p of pays) {
    const gross = Math.round(p.remaining * t.pct / 100);
    const fee = gross > 0 && p.feeable ? Math.min(gross, await paymentFeeFor(p.amount)) : 0;
    refundOre += gross - fee; feeOre += fee;
  }
  return { ...t, paidOre: pays.reduce((s, p) => s + p.remaining, 0), refundOre, feeOre };
}

/** Core cancellation: block removed, hold released, rewards restored, refund queued, cleaning reconciled. */
async function doCancel(c: PoolClient, b: BookingRow, reason: string, refundPct: number, refundReason: string, tierId: string | null, actor: Actor, deductFee = false): Promise<string[]> {
  await c.query(`UPDATE bookings SET status='cancelled', cancelled_reason=$2, cancelled_at=now(), updated_at=now() WHERE id=$1`, [b.id, reason]);
  await removeBlocksFor(c, 'platform_booking', b.id);
  await c.query(`UPDATE booking_holds SET released_at=now() WHERE booking_id=$1 AND released_at IS NULL`, [b.id]);
  await c.query(`UPDATE payments SET status='cancelled', updated_at=now() WHERE booking_id=$1 AND status='pending'`, [b.id]);
  const openInv = await q<{ id: string; invoice_number: string; fiken_invoice_number: string | null; status: string; amount_ore: number }>(
    `SELECT i.id, i.invoice_number, i.fiken_invoice_number, i.status, i.amount_ore FROM invoices i JOIN payments p ON p.id=i.payment_id WHERE p.booking_id=$1 AND i.status IN ('draft','sent','overdue')`, [b.id], c);
  await c.query(`UPDATE invoices SET status='cancelled' WHERE payment_id IN (SELECT id FROM payments WHERE booking_id=$1) AND status IN ('draft','sent','overdue')`, [b.id]);
  for (const iv of openInv) {
    const owed = Math.round(iv.amount_ore * (100 - refundPct) / 100);
    await notifyAdmins({ type: 'invoice_credit', dedupeKey: `invoice_credit:${iv.id}`, subject: `Booking ${b.reference} kansellert – ${iv.status === 'draft' ? 'ikke send fakturaen' : 'krediter fakturaen i Fiken'}`,
      body: iv.status === 'draft'
        ? `Fakturaen ${iv.invoice_number} var ikke sendt ennå.${owed > 0 ? ` Etter avbestillingsvilkårene skal gjesten likevel betale ${nok(owed)}.` : ' Ingenting skal faktureres.'}`
        : `Fakturaen${iv.fiken_invoice_number ? ` (Fiken nr. ${iv.fiken_invoice_number})` : ''} på ${nok(iv.amount_ore)} må krediteres i Fiken.${owed > 0 ? ` Etter avbestillingsvilkårene skal gjesten betale ${nok(owed)} – send en ny faktura på dette beløpet.` : ''}` }, c);
  }
  await reverseRedemptions(c, b.id);
  const refundIds: string[] = [];
  let feeTotal = 0;
  if (refundPct > 0) {
    const pays = await q<{ id: string; amount: number; remaining: number; feeable: boolean }>(`SELECT id, amount_ore AS amount, (amount_ore - refunded_amount_ore) AS remaining, method IN ${FEE_METHODS} AS feeable FROM payments WHERE booking_id=$1 AND status IN ('succeeded','partially_refunded')`, [b.id], c);
    for (const p of pays) {
      const gross = Math.round(p.remaining * refundPct / 100);
      const fee = deductFee && gross > 0 && p.feeable ? Math.min(gross, await paymentFeeFor(p.amount, c)) : 0;
      feeTotal += fee;
      const amt = gross - fee;
      if (amt > 0) {
        const r = await one<{ id: string }>(`INSERT INTO refunds (payment_id, amount_ore, reason, policy_tier_id, initiated_by_user_id, fee_deducted_ore) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [p.id, amt, refundReason, tierId, actor.id, fee], c);
        refundIds.push(r!.id);
      }
    }
  }
  await reconcileCleaningTasks(c, b.property_id);
  await audit(c, actor, 'booking.cancelled', 'booking', b.id, { status: b.status }, { status: 'cancelled', reason, refundPct, feeDeducted: feeTotal });
  const m = await memberOf(c, b.member_id);
  await enqueue({ userId: m.id, to: m.email, type: 'booking_cancelled', dedupeKey: `booking_cancelled:${b.id}`, subject: `Bookingen er kansellert (${b.reference})`,
    body: `Hei ${m.name}.\n\nBookingen ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)} er kansellert.${refundPct > 0 ? ` Du får refundert ${pctNo(refundPct)} % av innbetalt beløp${feeTotal > 0 ? `, med fradrag av betalingsgebyret på ${nok(feeTotal)} (gebyret Stripe/Vipps tar for betalingen, og som ikke betales tilbake)` : ''}.` : ''}` }, c);
  return refundIds;
}

export async function requestCancellation(bookingId: string, user: UserLike, actor: Actor): Promise<'cancelled' | 'requested'> {
  let refundIds: string[] = [];
  const out = await tx(async c => {
    const b = await lockBooking(c, bookingId);
    if (b.member_id !== user.id && !isAdmin(user)) throw forbidden();
    if (['pending_review', 'awaiting_payment'].includes(b.status)) {
      refundIds = await doCancel(c, b, 'member_request', 0, 'cancellation_tier', null, actor);
      return 'cancelled' as const;
    }
    if (b.status !== 'confirmed') throw new DomainError('not_cancellable', 'Bookingen kan ikke kanselleres.');
    const t = await tierFor(c, b.property_id, b.start_date);
    if (t.needsApproval) {
      await c.query(`UPDATE bookings SET status='cancellation_requested', cancellation_requested_at=now(), updated_at=now() WHERE id=$1`, [b.id]);
      await audit(c, actor, 'booking.cancellation_requested', 'booking', b.id);
      await notifyAdmins({ type: 'cancellation_requested', dedupeKey: `cancellation_requested:${b.id}`, subject: `Kanselleringsforespørsel ${b.reference}`, body: `Må behandles innen fristen, ellers godkjennes den automatisk med full refusjon.\n${appUrl('/admin/bookinger/' + b.id)}` }, c);
      return 'requested' as const;
    }
    refundIds = await doCancel(c, b, 'member_request', t.pct, 'cancellation_tier', t.id, actor, true);
    return 'cancelled' as const;
  });
  if (refundIds.length) await processRefunds(refundIds);
  return out;
}

export async function decideCancellation(bookingId: string, approve: boolean, actor: Actor) {
  let refundIds: string[] = [];
  await tx(async c => {
    const b = await lockBooking(c, bookingId);
    if (b.status !== 'cancellation_requested') throw new DomainError('bad_state', 'Ingen ventende kansellering.');
    if (!approve) {
      await c.query(`UPDATE bookings SET status='confirmed', updated_at=now() WHERE id=$1`, [b.id]);
      await audit(c, actor, 'booking.cancellation_denied', 'booking', b.id);
      const m = await memberOf(c, b.member_id);
      await enqueue({ userId: m.id, to: m.email, type: 'cancellation_denied', subject: `Kanselleringen ble ikke godkjent (${b.reference})`, body: `Hei ${m.name}. Bookingen din står fortsatt som bekreftet.` }, c);
      return;
    }
    const t = await tierFor(c, b.property_id, b.start_date);
    refundIds = await doCancel(c, b, 'member_request', t.pct, 'cancellation_tier', t.id, actor, true);
  });
  if (refundIds.length) await processRefunds(refundIds);
}

/** deductFee: the guest asked for the cancellation, so the payment fee is kept back (full refund otherwise). */
export async function adminCancel(bookingId: string, actor: Actor, reason: 'admin_action' | 'membership_revoked' = 'admin_action', c?: PoolClient, deductFee = false) {
  const run = async (cl: PoolClient) => {
    const b = await lockBooking(cl, bookingId);
    if (!['pending_review', 'awaiting_payment', 'confirmed', 'cancellation_requested'].includes(b.status)) throw new DomainError('bad_state', 'Bookingen kan ikke kanselleres.');
    return doCancel(cl, b, deductFee ? 'member_request' : reason, 100, reason === 'membership_revoked' ? 'membership_revoked' : 'admin_cancellation', null, actor, deductFee && reason === 'admin_action');
  };
  const ids = c ? await run(c) : await tx(run);
  if (!c && ids.length) await processRefunds(ids);
  return ids;
}

export async function cancelAllForMember(c: PoolClient, memberId: string, actor: Actor) {
  const rows = await q<{ id: string }>(`SELECT id FROM bookings WHERE member_id=$1 AND status IN ('pending_review','awaiting_payment','confirmed','cancellation_requested')`, [memberId], c);
  for (const r of rows) await adminCancel(r.id, actor, 'membership_revoked', c);
}

// ---------------------------------------------------------------- background jobs
export async function expireHolds(): Promise<number> {
  const due = await q<{ booking_id: string }>(
    `SELECT h.booking_id FROM booking_holds h WHERE h.released_at IS NULL AND h.expires_at < now()
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=h.booking_id AND p.status='pending' AND p.method<>'invoice' AND p.created_at > now() - interval '30 minutes')`);
  for (const d of due) {
    await tx(async c => {
      const b = await lockBooking(c, d.booking_id);
      if (b.status !== 'awaiting_payment') return;
      await c.query(`UPDATE bookings SET status='expired', cancelled_reason='payment_expired', updated_at=now() WHERE id=$1`, [b.id]);
      await removeBlocksFor(c, 'platform_booking', b.id);
      await c.query(`UPDATE booking_holds SET released_at=now() WHERE booking_id=$1`, [b.id]);
      await c.query(`UPDATE payments SET status='cancelled' WHERE booking_id=$1 AND status='pending'`, [b.id]);
      await c.query(`UPDATE invoices SET status='overdue' WHERE payment_id IN (SELECT id FROM payments WHERE booking_id=$1) AND status='sent'`, [b.id]);
      await reverseRedemptions(c, b.id);
      await audit(c, SYSTEM, 'booking.hold_expired', 'booking', b.id);
      const m = await memberOf(c, b.member_id);
      await enqueue({ userId: m.id, to: m.email, type: 'hold_expired', dedupeKey: `hold_expired:${b.id}`, subject: `Betalingsfristen gikk ut (${b.reference})`, body: `Hei ${m.name}. Betalingen ble ikke fullført innen fristen, så datoene er frigitt. Du kan booke på nytt hvis de fortsatt er ledige: ${appUrl('/medlem')}` }, c);
    });
  }
  return due.length;
}

export async function sendHoldReminders(): Promise<number> {
  const rows = await q<{ booking_id: string; reference: string; email: string; name: string; member_id: string; hours_left: number; hold_hours: number }>(
    `SELECT b.id AS booking_id, b.reference, u.email, u.name, u.id AS member_id, EXTRACT(EPOCH FROM (h.expires_at - now()))/3600 AS hours_left,
            h.hold_duration_hours_at_creation AS hold_hours
     FROM booking_holds h JOIN bookings b ON b.id=h.booking_id JOIN users u ON u.id=b.member_id
     WHERE h.released_at IS NULL AND b.status='awaiting_payment' AND h.expires_at > now() AND h.expires_at < now() + interval '24 hours'`);
  let sent = 0;
  for (const r of rows) {
    const link = appUrl('/medlem/bookinger/' + r.booking_id);
    if (Number(r.hold_hours) < 6) {
      // Short deadline: one reminder when about 20 minutes are left.
      const min = Math.round(Number(r.hours_left) * 60);
      if (min > 20) continue;
      await enqueue({ userId: r.member_id, to: r.email, type: 'payment_reminder', dedupeKey: `payment_reminder:${r.booking_id}:last`,
        subject: `Påminnelse: betal innen ${Math.max(1, min)} minutter (${r.reference})`,
        body: `Hei ${r.name}! Datoene er holdt av for deg i ${Math.max(1, min)} minutter til. Betal nå for å beholde dem: ${link}` });
      sent++; continue;
    }
    const bucket = r.hours_left <= 4 ? '4h' : '24h';
    await enqueue({ userId: r.member_id, to: r.email, type: 'payment_reminder', dedupeKey: `payment_reminder:${r.booking_id}:${bucket}`,
      subject: `Påminnelse: betal innen ${hoursText(Math.max(1, Math.floor(r.hours_left)))} (${r.reference})`,
      body: `Hei ${r.name}! Husk å betale for å beholde datoene: ${link}` });
    sent++;
  }
  return sent;
}

export async function autoResolveCancellations(): Promise<number> {
  const hours = await getNum('cancellation_approval_timeout_hours', 48);
  const rows = await q<{ id: string }>(`SELECT id FROM bookings WHERE status='cancellation_requested' AND cancellation_requested_at < now() - make_interval(hours => $1)`, [hours]);
  for (const r of rows) {
    let ids: string[] = [];
    await tx(async c => {
      const b = await lockBooking(c, r.id);
      if (b.status !== 'cancellation_requested') return;
      // Resolved in the member's favour: full refund (spec §9)
      ids = await doCancel(c, b, 'timeout_auto_approval', 100, 'timeout_auto_approval', null, SYSTEM);
      await notifyAdmins({ type: 'cancellation_auto_approved', subject: `Kansellering ${b.reference} ble automatisk godkjent`, body: 'Ingen behandlet forespørselen innen fristen. Full refusjon er gitt.' }, c);
    });
    if (ids.length) await processRefunds(ids);
  }
  return rows.length;
}

/** Marks stays completed after checkout and fires referral qualification (idempotent). */
export async function completeStays(): Promise<number> {
  const rows = await q<{ id: string }>(`SELECT id FROM bookings WHERE status='confirmed' AND end_date <= $1::date`, [todayOslo()]);
  for (const r of rows) {
    await tx(async c => {
      const b = await lockBooking(c, r.id);
      if (b.status !== 'confirmed') return;
      await c.query(`UPDATE bookings SET status='completed', completed_at=now(), updated_at=now() WHERE id=$1`, [b.id]);
      await audit(c, SYSTEM, 'booking.completed', 'booking', b.id);
      await qualifyReferralForBooking(c, b.id);
    });
  }
  return rows.length;
}
