import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { cancellationPreview } from '@/lib/domain/bookings';
import { nightsBetween, todayOslo } from '@/lib/format';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, fmtDateTimeL, nokL } from '@/lib/i18n/format';
import { Flash, Status } from '@/components/ui';
import { payAction, cancelAction, updateMyPreparationAction } from '../../../actions/member';
import { stripeProvider, mockProvider } from '@/lib/domain/payments';
import { getStr } from '@/lib/settings';
import { SavingsBreakdown } from '@/components/Savings';

export const dynamic = 'force-dynamic';

export default async function BookingDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const T = t.bookings;
  const nok = (o: number) => nokL(o, lang), fmtDate = (d: string, w?: boolean) => fmtDateL(d, lang, w), fmtDateTime = (d: any) => fmtDateTimeL(d, lang);
  const b = await one(`SELECT b.*, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", p.name AS property, p.address, p.slug,
      to_char(p.check_in_time,'HH24:MI') AS cin, to_char(p.check_out_time,'HH24:MI') AS cout, h.expires_at AS hold_expires,
      sp.comment_for_cleaner, to_char(sp.expected_arrival_time,'HH24:MI') AS arrival
    FROM bookings b JOIN properties p ON p.id=b.property_id LEFT JOIN booking_holds h ON h.booking_id=b.id AND h.released_at IS NULL
    LEFT JOIN stay_preparations sp ON sp.booking_id=b.id WHERE b.id=$1`, [id]);
  if (!b || b.member_id !== u.id) notFound();
  const methods = await q<{ method: string }>(`SELECT method FROM payment_method_settings WHERE enabled ORDER BY method`);
  const payments = await q(`SELECT p.method, p.status, p.amount_ore, p.refunded_amount_ore, p.created_at, i.kid_number, i.invoice_number, to_char(i.due_date,'YYYY-MM-DD') AS due
    FROM payments p LEFT JOIN invoices i ON i.payment_id=p.id WHERE p.booking_id=$1 AND p.status <> 'cancelled' ORDER BY p.created_at`, [id]);
  const addOns = await q(`SELECT a.name, ba.quantity, ba.total_price_ore FROM booking_add_ons ba JOIN add_on_items a ON a.id=ba.add_on_item_id WHERE ba.booking_id=$1`, [id]);
  const cancellable = ['pending_review', 'awaiting_payment', 'confirmed'].includes(b.status);
  const preview = b.status === 'confirmed' ? await cancellationPreview(id, u as any) : null;
  const editable = ['pending_review', 'awaiting_payment', 'confirmed'].includes(b.status) && nightsBetween(todayOslo(), b.start) >= 7;
  const cardLabel = stripeProvider.configured() ? T.payCard : mockProvider.configured() ? T.payCardTest : null;
  const quote = b.price_breakdown?.quote;
  const bankAccount = await getStr('invoice_bank_account', '');

  return (
    <>
      <Link href="/medlem/bookinger" className="muted">{T.back}</Link>
      <div className="page-head row between" style={{ marginTop: 12 }}>
        <div><span className="eyebrow">{b.reference}</span><h1 style={{ marginBottom: 0 }}>{b.property}</h1></div>
        <Status s={b.status} lang={lang} />
      </div>
      <Flash sp={sp} lang={lang} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <dl className="dl">
              <dt>{T.checkIn}</dt><dd>{fmtDate(b.start, true)}, {T.fromT(b.cin)}</dd>
              <dt>{T.checkOut}</dt><dd>{fmtDate(b.end, true)}, {T.byT(b.cout)}</dd>
              <dt>{T.guests}</dt><dd>{T.guestLine(b.adults, b.children, b.infants)}</dd>
              {b.status === 'confirmed' && b.address && <><dt>{T.address}</dt><dd>{b.address}</dd></>}
              {b.special_requests && <><dt>{T.wishes}</dt><dd>{b.special_requests}</dd></>}
              {b.rejection_reason && <><dt>{T.reason}</dt><dd>{b.rejection_reason}</dd></>}
            </dl>
          </div>
          {editable && (
            <div className="card">
              <h3>{T.arrivalTitle}</h3>
              <p className="muted" style={{ fontSize: '.88rem' }}>{T.arrivalText}</p>
              <form action={updateMyPreparationAction}>
                <input type="hidden" name="bookingId" value={id} />
                <div className="fields">
                  <div><label>{T.adults}</label><input type="number" name="adults" min={1} defaultValue={b.adults} /></div>
                  <div><label>{T.children}</label><input type="number" name="children" min={0} defaultValue={b.children} /></div>
                  <div><label>{T.infants}</label><input type="number" name="infants" min={0} defaultValue={b.infants} /></div>
                  <div><label>{T.arrival}</label><input type="time" name="arrival" defaultValue={b.arrival ?? ''} /></div>
                </div>
                <div className="field" style={{ marginTop: 12 }}><label>{T.toCleaner}</label><textarea name="comment" defaultValue={b.comment_for_cleaner ?? ''} maxLength={500} /></div>
                <button className="btn secondary small">{t.common.save}</button>
              </form>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h3>{T.price}</h3>
            {quote ? <SavingsBreakdown quote={{ ...quote, stay_ore: b.stay_price_ore, cleaning_fee_ore: b.cleaning_fee_ore, subtotal_ore: b.price_total_ore + b.reward_discount_ore }} rewardOre={b.reward_discount_ore} lang={lang} />
              : <div className="row price-total"><span>{T.total}</span><span>{nok(b.price_total_ore)}</span></div>}
            {!b.price_locked_at && b.price_breakdown?.use_rewards && <small className="muted">{T.bonusOnApproval}</small>}
          </div>
          {b.status === 'awaiting_payment' && (
            <div className="card" style={{ borderColor: 'var(--clay)' }}>
              <h3>{T.payTitle}</h3>
              <p>{T.heldUntil(fmtDateTime(b.hold_expires))}</p>
              <div className="stack">
                {methods.some(m => m.method === 'stripe_card') && cardLabel && <form action={payAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="method" value="stripe_card" /><button className="btn block">{cardLabel}</button></form>}
                {methods.some(m => m.method === 'vipps') && <form action={payAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="method" value="vipps" /><button className="btn secondary block">{T.payVipps}</button></form>}
                {methods.some(m => m.method === 'invoice') && <form action={payAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="method" value="invoice" /><button className="btn ghost block">{T.payInvoice}</button></form>}
              </div>
              <small className="muted">{T.cardNote}</small>
            </div>
          )}
          {payments.length > 0 && (
            <div className="card"><h3>{T.payments}</h3><ul className="list">{payments.map((p, i) => (
              <li key={i}><div className="row between"><span>{p.method === 'invoice' ? `${T.invoice} ${p.invoice_number ?? ''}` : p.method === 'vipps' ? 'Vipps' : T.card} · {nok(p.amount_ore)}</span><Status s={p.status} lang={lang} /></div>
                {p.kid_number && p.status === 'pending' && <small>{T.kidLine(p.kid_number, fmtDate(p.due), bankAccount)}</small>}
                {p.refunded_amount_ore > 0 && <small>{T.refunded(nok(p.refunded_amount_ore))}</small>}</li>))}</ul></div>
          )}
          {cancellable && (
            <div className="card flat">
              <h3>{T.cancelTitle}</h3>
              {preview ? <p className="muted">{preview.needsApproval ? T.needsApproval : ''}{T.refundTerms(preview.pct, nok(preview.refundOre))}</p>
                : <p className="muted">{T.freeCancel}</p>}
              <form action={cancelAction}><input type="hidden" name="id" value={id} /><button className="btn danger small">{T.cancel}</button></form>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
