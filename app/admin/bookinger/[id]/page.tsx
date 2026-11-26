import { getNum } from '@/lib/settings';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { one, q } from '@/lib/db';
import { fmtDate, fmtDateTime, nok } from '@/lib/format';
import { roomPlanForPreparation } from '@/lib/domain/cleaning';
import { BED_LABELS } from '@/lib/domain/beds';
import { Flash, Status } from '@/components/ui';
import { RoomPlan } from '@/components/RoomPlan';
import { approveAction, rejectAction, adminCancelAction, decideCancellationAction, adminPreparationAction, sleepingPlanAction, markInvoicePaidAction, goodwillRefundAction, bookingCleaningSelfAction } from '../../../actions/admin';
import { ValueButton } from '@/components/ValueButton';

export const dynamic = 'force-dynamic';

export default async function AdminBooking({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const b = await one(`SELECT b.*, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", u.name AS member, u.email, u.phone, u.id AS member_id,
      p.name AS property, p.id AS pid, h.expires_at AS hold_expires, r.name AS reviewer, sp.id AS prep_id, sp.comment_for_cleaner, to_char(sp.expected_arrival_time,'HH24:MI') AS arrival,
      sp.adults AS p_adults, sp.children AS p_children, sp.infants AS p_infants
    FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id LEFT JOIN booking_holds h ON h.booking_id=b.id AND h.released_at IS NULL
    LEFT JOIN users r ON r.id=b.admin_reviewer_id LEFT JOIN stay_preparations sp ON sp.booking_id=b.id WHERE b.id=$1`, [id]);
  const feeText = `${String(await getNum('cancellation_payment_fee_pct', 2.99)).replace('.', ',')} % + ${Math.round(await getNum('cancellation_payment_fee_fixed_ore', 200) / 100)} kr`;
  const cTasks = await q(`SELECT t.id, t.task_type, t.status, t.checkout_date, u.name AS helper FROM cleaning_tasks t LEFT JOIN users u ON u.id=t.assigned_to_user_id WHERE t.booking_id=$1 AND t.status <> 'cancelled' ORDER BY t.checkout_date`, [id]);
  if (!b) notFound();
  const [overlaps, payments, refunds, addOns, log] = await Promise.all([
    q(`SELECT ab.block_type, to_char(lower(ab.date_range),'YYYY-MM-DD') AS start, to_char(upper(ab.date_range),'YYYY-MM-DD') AS "end", ab.reason, cc.display_name FROM availability_blocks ab LEFT JOIN channel_connections cc ON cc.id=ab.source_connection_id
       WHERE ab.property_id=$1 AND ab.date_range && daterange($2::date,$3::date) AND (ab.reference_id IS DISTINCT FROM $4)`, [b.pid, b.start, b.end, id]),
    q(`SELECT p.*, i.id AS invoice_id, i.invoice_number, i.kid_number, i.fiken_invoice_number, i.status AS invoice_status FROM payments p LEFT JOIN invoices i ON i.payment_id=p.id WHERE p.booking_id=$1 ORDER BY p.created_at`, [id]),
    q(`SELECT r.* FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.booking_id=$1 ORDER BY r.created_at`, [id]),
    q(`SELECT a.name, ba.quantity, ba.total_price_ore FROM booking_add_ons ba JOIN add_on_items a ON a.id=ba.add_on_item_id WHERE ba.booking_id=$1`, [id]),
    q(`SELECT a.action, a.created_at, a.actor_type, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.entity_id=$1 ORDER BY a.created_at`, [id]),
  ]);
  const plan = b.prep_id ? await roomPlanForPreparation(b.prep_id, b.pid) : null;
  const allBeds = plan ? plan.rooms.flatMap(r => r.beds.map(bd => ({ ...bd, room: r.name }))) : [];
  const back = `/admin/bookinger/${id}`;
  const quote = b.price_breakdown?.quote;
  return (
    <>
      <Link href="/admin/bookinger" className="muted">← Bookinger</Link>
      <div className="page-head row between" style={{ marginTop: 10 }}>
        <div><span className="eyebrow">{b.reference}</span><h1 style={{ marginBottom: 0 }}>{b.member} · {b.property}</h1></div><div className="row"><Link href={`/admin/meldinger/ny?medlem=${b.member_id}&booking=${b.id}`} className="btn secondary small">Send melding om bookingen</Link><Status s={b.status} /></div>
      </div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <dl className="dl">
              <dt>Datoer</dt><dd>{fmtDate(b.start, true)} – {fmtDate(b.end, true)} ({quote?.nights ?? '–'} netter)</dd>
              <dt>Gjester</dt><dd>{b.adults} voksne, {b.children} barn, {b.infants} spedbarn</dd>
              <dt>Medlem</dt><dd><Link href={`/admin/medlemmer/${b.member_id}`}>{b.member}</Link> · {b.email}{b.phone ? ` · ${b.phone}` : ''}</dd>
              <dt>Ønsker</dt><dd>{b.special_requests ?? '–'}</dd>
              <dt>Forespurt</dt><dd>{fmtDateTime(b.requested_at)}</dd>
              {b.approved_at && <><dt>Godkjent</dt><dd>{fmtDateTime(b.approved_at)} av {b.reviewer}</dd></>}
              {b.hold_expires && <><dt>Holdes til</dt><dd>{fmtDateTime(b.hold_expires)}</dd></>}
              {b.rejection_reason && <><dt>Avslått fordi</dt><dd>{b.rejection_reason}</dd></>}
              {b.cancelled_reason && <><dt>Kansellert</dt><dd>{b.cancelled_reason} · {fmtDateTime(b.cancelled_at)}</dd></>}
            </dl>
          </div>
          {b.status === 'pending_review' && (
            <div className="card" style={{ borderColor: 'var(--sand)' }}>
              <h3>Behandle forespørsel</h3>
              {overlaps.length > 0 ? <div className="flash err">Datoene overlapper: {overlaps.map(o => `${o.display_name ?? o.block_type} ${fmtDate(o.start)}–${fmtDate(o.end)}`).join(', ')}. Godkjenning vil bli avvist av systemet.</div>
                : <p className="muted">Datoene er ledige nå. Ved godkjenning beregnes prisen på nytt og låses, datoene holdes av og medlemmet får betalingslenke.</p>}
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <form action={approveAction}><input type="hidden" name="id" value={id} /><button className="btn ok">Godkjenn</button></form>
                <form action={rejectAction} className="row" style={{ flex: 1 }}><input type="hidden" name="id" value={id} /><input name="reason" placeholder="Begrunnelse for avslag" required style={{ flex: 1 }} /><button className="btn ghost">Avslå</button></form>
              </div>
            </div>
          )}
          {b.status === 'cancellation_requested' && (
            <div className="card" style={{ borderColor: 'var(--clay)' }}>
              <h3>Kanselleringsforespørsel</h3><p className="muted">Mottatt {fmtDateTime(b.cancellation_requested_at)}. Godkjennes automatisk med full refusjon etter fristen hvis ingen behandler den.</p>
              <div className="row">
                <form action={decideCancellationAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="approve" /><button className="btn">Godkjenn (refusjon etter vilkår)</button></form>
                <form action={decideCancellationAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="deny" /><button className="btn ghost">Avslå</button></form>
              </div>
            </div>
          )}
          {plan && (
            <div className="card">
              <div className="row between"><h3>Ankomst og soveplan</h3><span className="badge">{plan.source === 'admin_override' ? 'Overstyrt' : 'Automatisk'}</span></div>
              <form action={adminPreparationAction} className="fields" style={{ marginBottom: 16 }}>
                <input type="hidden" name="prepId" value={b.prep_id} /><input type="hidden" name="back" value={back} />
                <div><label>Voksne</label><input type="number" name="adults" defaultValue={b.p_adults} min={0} /></div>
                <div><label>Barn</label><input type="number" name="children" defaultValue={b.p_children} min={0} /></div>
                <div><label>Spedbarn</label><input type="number" name="infants" defaultValue={b.p_infants} min={0} /></div>
                <div><label>Ankomst</label><input type="time" name="arrival" defaultValue={b.arrival ?? ''} /></div>
                <div style={{ gridColumn: '1/-1' }}><label>Beskjed til renholder</label><input name="comment" defaultValue={b.comment_for_cleaner ?? ''} /></div>
                <div><button className="btn secondary small">Lagre</button></div>
              </form>
              <RoomPlan plan={plan} />
              <details><summary>Overstyr senger for dette oppholdet</summary>
                <form action={sleepingPlanAction} style={{ marginTop: 10 }}>
                  <input type="hidden" name="prepId" value={b.prep_id} /><input type="hidden" name="back" value={back} />
                  <table><tbody>{allBeds.map(bd => (
                    <tr key={bd.id}><td>{bd.room}<br /><small>{bd.label} · {BED_LABELS[bd.bed_type]}</small></td>
                      <td><input type="number" name={'bed_' + bd.id} min={0} max={bd.sleeps} defaultValue={bd.allocation?.persons ?? 0} style={{ width: 70 }} /></td>
                      <td><select name={'type_' + bd.id} defaultValue={bd.allocation?.guest_type ?? 'adult'}><option value="adult">Voksen</option><option value="child">Barn</option><option value="infant">Spedbarn</option><option value="mixed">Blandet</option></select></td></tr>))}</tbody></table>
                  <div className="row" style={{ marginTop: 10 }}><button className="btn small">Lagre overstyring</button>{plan.source === 'admin_override' && <ValueButton className="btn ghost small" name="reset" value="1">Tilbake til automatisk</ValueButton>}</div>
                </form>
              </details>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h3>Pris {b.price_locked_at ? <span className="badge b-sage">Låst {fmtDate(b.price_locked_at)}</span> : <span className="badge b-warn">Estimat</span>}</h3>
            <div className="price-lines">
              {quote?.nightLines?.length > 0 && <details><summary className="muted">{quote.nights} netter – vis per natt</summary>
                {quote.nightLines.map((n: any) => <div key={n.date} className="row"><small>{fmtDate(n.date)} · {n.category}{n.los_discount_pct ? ` −${n.los_discount_pct}%` : ''}</small><small>{nok(n.price_ore)}</small></div>)}</details>}
              <div className="row"><span>Opphold{quote?.member_discount_pct ? ` (medlemsrabatt ${quote.member_discount_pct} %)` : ''}</span><span>{nok(b.stay_price_ore)}</span></div>
              <div className="row"><span>Sluttrengjøring{b.cleaning_self ? ' (vasker selv)' : ''}</span><span>{b.cleaning_self && !b.price_locked_at ? nok(0) : nok(b.cleaning_fee_ore)}</span></div>
              {b.extra_guest_fee_ore > 0 && <div className="row"><span>Ekstra gjester ({quote?.extra_guests})</span><span>{nok(b.extra_guest_fee_ore)}</span></div>}
              {addOns.map((a, i) => <div key={i} className="row"><span>{a.name} × {a.quantity}</span><span>{nok(a.total_price_ore)}</span></div>)}
              {quote?.own_linen_discount_ore > 0 && <div className="row"><span>Eget sengetøy</span><span>−{nok(quote.own_linen_discount_ore)}</span></div>}
              {b.reward_discount_ore > 0 && <div className="row"><span>Bonus</span><span>−{nok(b.reward_discount_ore)}</span></div>}
              <div className="row price-total"><span>Totalt</span><span>{nok(b.price_total_ore)}</span></div>
            </div>
          </div>
          <div className="card">
            <h3>Sluttrengjøring</h3>
            {cTasks.length > 0 && <ul className="list" style={{ marginBottom: 10 }}>{cTasks.map((t: any) => <li key={t.id}><small>{t.task_type === 'preparation' ? 'Klargjøring' : 'Utvask'} {fmtDate(t.checkout_date)} · {({ open: 'Ikke tildelt', assigned: `Tildelt ${t.helper ?? ''}`, in_progress: 'Pågår', completed: 'Ferdig', not_needed: 'Slettet / ikke nødvendig' } as Record<string, string>)[t.status] ?? t.status}</small> <Link href="/admin/renhold" className="muted" style={{ fontSize: '.8rem' }}>Renhold →</Link></li>)}</ul>}
            {b.cleaning_self ? <>
              <p className="muted">Gjesten vasker selv denne gangen. Det lages ingen vaskejobb{b.price_locked_at ? '' : ', og sluttrengjøringen fjernes fra prisen når bookingen godkjennes'}.</p>
              <form action={bookingCleaningSelfAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="on" value="0" /><button className="btn ghost small">Sett tilbake vanlig sluttrengjøring</button></form>
            </> : <>
              <p className="muted">Skal gjesten (eller du selv) vaske etter oppholdet? Da slås vaskejobben av{b.price_locked_at ? '. Prisen er allerede låst, så eventuell refusjon av sluttrengjøringen gjøres under Betalinger.' : ', og sluttrengjøringen trekkes fra prisen ved godkjenning.'}</p>
              <form action={bookingCleaningSelfAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="on" value="1" /><button className="btn ghost small">Gjesten vasker selv</button></form>
            </>}
            <p className="muted" style={{ fontSize: '.85rem', marginBottom: 0 }}>Vasker medlemmet alltid selv, kan du gi fast fritak på medlemssiden.</p>
          </div>
          <div className="card">
            <h3>Betalinger</h3>
            {payments.length === 0 ? <p className="muted">Ingen betalinger.</p> : <ul className="list">{payments.map(p => (
              <li key={p.id}><div className="row between"><span>{p.provider}{p.provider === 'mock' ? ' (test)' : ''} · {nok(p.amount_ore)} <small>{fmtDateTime(p.created_at)}</small></span><Status s={p.status} /></div>
                {p.invoice_number && <small>Faktura {p.fiken_invoice_number ? `Fiken nr. ${p.fiken_invoice_number}` : p.invoice_number}{p.kid_number ? ` · KID ${p.kid_number}` : ''} · <Status s={p.invoice_status} /> · <Link href={`/admin/betalinger/faktura/${p.invoice_id}`}>Fakturagrunnlag</Link></small>}
                {p.method === 'invoice' && p.status === 'pending' && <form action={markInvoicePaidAction} style={{ marginTop: 8 }}><input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="back" value={back} /><button className="btn small ok">Marker faktura betalt</button></form>}
              </li>))}</ul>}
            {refunds.length > 0 && <><h4>Refusjoner</h4><ul className="list">{refunds.map(r => <li key={r.id} className="row between"><span>{nok(r.amount_ore)} · {r.reason}{r.error ? <><br /><small className="muted">{r.error}</small></> : null}</span><Status s={r.status} /></li>)}</ul></>}
            {payments.some(p => ['succeeded', 'partially_refunded'].includes(p.status)) && (
              <details><summary className="muted">Kulanserefusjon</summary>
                <form action={goodwillRefundAction} className="row" style={{ marginTop: 8 }}><input type="hidden" name="bookingId" value={id} /><input name="amount" placeholder="Beløp i kr" style={{ width: 140 }} /><button className="btn small secondary">Refunder</button></form></details>)}
          </div>
          {['pending_review', 'awaiting_payment', 'confirmed', 'cancellation_requested'].includes(b.status) && (
            <div className="card flat" style={{ borderColor: 'var(--danger-soft)' }}>
              <h3>Kanseller som administrator</h3><p className="muted">Datoene frigjøres og renholdsoppgaven avlyses. Alt innbetalt refunderes, med mindre du krysser av for at gjesten selv ønsket å avbestille – da trekkes betalingsgebyret ({feeText}) fra refusjonen.</p>
              <form action={adminCancelAction} className="stack" style={{ gap: 8 }}><input type="hidden" name="id" value={id} />
                <label className="check" style={{ margin: 0 }}><input type="checkbox" name="fee" value="1" /> Gjesten ønsket å avbestille – trekk betalingsgebyret</label>
                <div className="row"><label className="check" style={{ margin: 0 }}><input type="checkbox" name="confirm" value="ja" /> Bekreft</label><button className="btn danger small">Kanseller</button></div></form>
            </div>
          )}
          <div className="card flat"><h3>Historikk</h3><ul className="list">{log.map((l, i) => <li key={i}><small>{fmtDateTime(l.created_at)} · {l.action} · {l.name ?? l.actor_type}</small></li>)}</ul></div>
        </div>
      </div>
    </>
  );
}
