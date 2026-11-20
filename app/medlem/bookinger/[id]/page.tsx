import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { cancellationPreview } from '@/lib/domain/bookings';
import { fmtDate, fmtDateTime, nightsBetween, nok, todayOslo } from '@/lib/format';
import { Flash, Status } from '@/components/ui';
import { payAction, cancelAction, updateMyPreparationAction } from '../../../actions/member';
import { stripeProvider, mockProvider } from '@/lib/domain/payments';
import { getStr } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function BookingDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser('request_booking');
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
  const cardLabel = stripeProvider.configured() ? 'Betal med kort' : mockProvider.configured() ? 'Betal med kort (testmodus)' : null;
  const quote = b.price_breakdown?.quote;
  const bankAccount = await getStr('invoice_bank_account', '');

  return (
    <>
      <Link href="/medlem/bookinger" className="muted">← Mine bookinger</Link>
      <div className="page-head row between" style={{ marginTop: 12 }}>
        <div><span className="eyebrow">{b.reference}</span><h1 style={{ marginBottom: 0 }}>{b.property}</h1></div>
        <Status s={b.status} />
      </div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <dl className="dl">
              <dt>Innsjekk</dt><dd>{fmtDate(b.start, true)}, fra kl. {b.cin}</dd>
              <dt>Utsjekk</dt><dd>{fmtDate(b.end, true)}, innen kl. {b.cout}</dd>
              <dt>Gjester</dt><dd>{b.adults} voksne{b.children ? `, ${b.children} barn` : ''}{b.infants ? `, ${b.infants} spedbarn` : ''}</dd>
              {b.status === 'confirmed' && b.address && <><dt>Adresse</dt><dd>{b.address}</dd></>}
              {b.special_requests && <><dt>Dine ønsker</dt><dd>{b.special_requests}</dd></>}
              {b.rejection_reason && <><dt>Begrunnelse</dt><dd>{b.rejection_reason}</dd></>}
            </dl>
          </div>
          {editable && (
            <div className="card">
              <h3>Ankomstinformasjon</h3>
              <p className="muted" style={{ fontSize: '.88rem' }}>Brukes for å gjøre klar riktige senger. Kan endres frem til 7 dager før ankomst.</p>
              <form action={updateMyPreparationAction}>
                <input type="hidden" name="bookingId" value={id} />
                <div className="fields">
                  <div><label>Voksne</label><input type="number" name="adults" min={1} defaultValue={b.adults} /></div>
                  <div><label>Barn</label><input type="number" name="children" min={0} defaultValue={b.children} /></div>
                  <div><label>Spedbarn</label><input type="number" name="infants" min={0} defaultValue={b.infants} /></div>
                  <div><label>Forventet ankomst</label><input type="time" name="arrival" defaultValue={b.arrival ?? ''} /></div>
                </div>
                <div className="field" style={{ marginTop: 12 }}><label>Beskjed til renholder (ikke personopplysninger)</label><textarea name="comment" defaultValue={b.comment_for_cleaner ?? ''} maxLength={500} /></div>
                <button className="btn secondary small">Lagre</button>
              </form>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h3>Pris</h3>
            <div className="price-lines">
              {quote && <div className="row"><span>{quote.nights} netter, ordinær pris</span><span>{nok(b.stay_price_ore + (quote.member_discount_ore ?? 0))}</span></div>}
              {quote?.member_discount_ore > 0 && <div className="row" style={{ color: 'var(--gold-2)' }}><span>Medlemsrabatt {quote.member_discount_pct} %</span><span>−{nok(quote.member_discount_ore)}</span></div>}
              <div className="row"><span>Sluttrengjøring</span><span>{nok(b.cleaning_fee_ore)}</span></div>
              {addOns.map((a, i) => <div className="row" key={i}><span>{a.name}{a.quantity > 1 ? ` × ${a.quantity}` : ''}</span><span>{nok(a.total_price_ore)}</span></div>)}
              {b.reward_discount_ore > 0 && <div className="row"><span>Bonus brukt</span><span>−{nok(b.reward_discount_ore)}</span></div>}
              <div className="row price-total"><span>{b.price_locked_at ? 'Å betale' : 'Estimert'}</span><span>{nok(b.price_total_ore)}</span></div>
            </div>
            {!b.price_locked_at && b.price_breakdown?.use_rewards && <small className="muted">Bonus trekkes fra når forespørselen godkjennes.</small>}
          </div>
          {b.status === 'awaiting_payment' && (
            <div className="card" style={{ borderColor: 'var(--clay)' }}>
              <h3>Betal for å bekrefte</h3>
              <p>Datoene holdes av til <strong>{fmtDateTime(b.hold_expires)}</strong>.</p>
              <div className="stack">
                {methods.some(m => m.method === 'stripe_card') && cardLabel && <form action={payAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="method" value="stripe_card" /><button className="btn block">{cardLabel}</button></form>}
                {methods.some(m => m.method === 'vipps') && <form action={payAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="method" value="vipps" /><button className="btn secondary block">Betal med Vipps</button></form>}
                {methods.some(m => m.method === 'invoice') && <form action={payAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="method" value="invoice" /><button className="btn ghost block">Betal med faktura</button></form>}
              </div>
              <small className="muted">Kortbetaling skjer hos Stripe. Vi lagrer aldri kortopplysninger.</small>
            </div>
          )}
          {payments.length > 0 && (
            <div className="card"><h3>Betalinger</h3><ul className="list">{payments.map((p, i) => (
              <li key={i}><div className="row between"><span>{p.method === 'invoice' ? `Faktura ${p.invoice_number ?? ''}` : p.method === 'vipps' ? 'Vipps' : 'Kort'} · {nok(p.amount_ore)}</span><Status s={p.status} /></div>
                {p.kid_number && p.status === 'pending' && <small>KID {p.kid_number} · forfall {fmtDate(p.due)} · kontonr. {bankAccount}</small>}
                {p.refunded_amount_ore > 0 && <small>Refundert {nok(p.refunded_amount_ore)}</small>}</li>))}</ul></div>
          )}
          {cancellable && (
            <div className="card flat">
              <h3>Kansellering</h3>
              {preview ? <p className="muted">{preview.needsApproval ? `Mindre enn ${10} dager før ankomst – kanselleringen må godkjennes. ` : ''}Etter vilkårene får du refundert <strong>{preview.pct} %</strong> ({nok(preview.refundOre)}).</p>
                : <p className="muted">Bookingen er ikke betalt ennå og kan kanselleres kostnadsfritt.</p>}
              <form action={cancelAction}><input type="hidden" name="id" value={id} /><button className="btn danger small">Kanseller booking</button></form>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
