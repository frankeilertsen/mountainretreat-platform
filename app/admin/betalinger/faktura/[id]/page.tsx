import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { getStr } from '@/lib/settings';
import { fmtDate, fmtDateTime, nok } from '@/lib/format';
import { Flash, Status } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { invoiceSentAction, markInvoicePaidAction } from '../../../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fakturagrunnlag' };
const kr = (ore: number) => (ore / 100).toFixed(2).replace('.', ',');

/** Everything needed to issue the invoice in Fiken: customer, lines, amounts, due date and reference. */
export default async function InvoiceDraft({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireUser('admin');
  const { id } = await params; const sp = await searchParams;
  const i = await one<any>(`SELECT i.*, to_char(i.due_date,'YYYY-MM-DD') AS due, to_char(p.created_at AT TIME ZONE 'Europe/Oslo','YYYY-MM-DD') AS issued, p.id AS pid, p.status AS pay_status,
      b.id AS bid, b.reference, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", (b.end_date - b.start_date) AS nights,
      b.stay_price_ore, b.cleaning_fee_ore, b.extra_guest_fee_ore, b.reward_discount_ore, b.price_total_ore, b.adults, b.children, b.infants, b.status AS booking_status,
      u.name, u.email, u.phone, pr.name AS property
    FROM invoices i JOIN payments p ON p.id=i.payment_id JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=b.member_id JOIN properties pr ON pr.id=b.property_id WHERE i.id=$1`, [id]);
  if (!i) notFound();
  const addOns = await q<{ name: string; quantity: number; unit: number; total: number }>(
    `SELECT a.name, ba.quantity, ba.unit_price_at_selection_ore AS unit, ba.total_price_ore AS total FROM booking_add_ons ba JOIN add_on_items a ON a.id=ba.add_on_item_id WHERE ba.booking_id=$1`, [i.bid]);
  const company = await getStr('company_name', 'FKE Property AS');
  const guests = `${i.adults} voksne${i.children ? `, ${i.children} barn` : ''}${i.infants ? `, ${i.infants} spedbarn` : ''}`;
  const lines: { text: string; qty: number; unit: number; total: number }[] = [
    { text: `Opphold ${i.property}, ${fmtDate(i.start)} – ${fmtDate(i.end)} (${i.nights} netter, ${guests})`, qty: 1, unit: i.stay_price_ore, total: i.stay_price_ore },
    ...(i.cleaning_fee_ore > 0 ? [{ text: 'Sluttrengjøring', qty: 1, unit: i.cleaning_fee_ore, total: i.cleaning_fee_ore }] : []),
    ...(i.extra_guest_fee_ore > 0 ? [{ text: 'Tillegg for ekstra gjester', qty: 1, unit: i.extra_guest_fee_ore, total: i.extra_guest_fee_ore }] : []),
    ...addOns.map(a => ({ text: a.name, qty: a.quantity, unit: a.unit, total: a.total })),
    ...(i.reward_discount_ore > 0 ? [{ text: 'Vervebonus (rabatt)', qty: 1, unit: -i.reward_discount_ore, total: -i.reward_discount_ore }] : []),
  ];
  const sum = lines.reduce((s, l) => s + l.total, 0);
  const asText = [
    `Kunde: ${i.name}`, `E-post: ${i.email}`, i.phone ? `Telefon: ${i.phone}` : '', `Fakturadato: ${fmtDate(i.issued)}`, `Forfall: ${fmtDate(i.due)}`, `Deres ref./bookingnr.: ${i.reference}`, '',
    ...lines.map(l => `${l.text}\t${l.qty}\t${kr(l.unit)}\t${kr(l.total)}`), '', `Totalt: ${kr(i.amount_ore)} kr`,
  ].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n');
  return (
    <>
      <div className="page-head"><div><span className="eyebrow">Betalinger · faktura</span><h1>Fakturagrunnlag {i.invoice_number}</h1></div>
        <div className="row"><Status s={i.status} /><Link href={`/admin/bookinger/${i.bid}`} className="btn ghost small">Booking {i.reference}</Link></div></div>
      <Flash sp={sp} />
      {['cancelled'].includes(i.status) && <div className="flash err">Bookingen er kansellert – fakturaen skal ikke sendes (eller krediteres i Fiken hvis den er sendt).</div>}
      <div className="grid split-2-1" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="grid g2">
            <div><small className="muted">Kunde</small><p style={{ margin: '4px 0' }}><strong>{i.name}</strong><br />{i.email}{i.phone && <><br />{i.phone}</>}</p></div>
            <div><small className="muted">Selger</small><p style={{ margin: '4px 0' }}>{company}</p>
              <small className="muted">Fakturadato / forfall</small><p style={{ margin: '4px 0' }}>{fmtDate(i.issued)} / <strong>{fmtDate(i.due)}</strong></p>
              <small className="muted">Deres referanse</small><p style={{ margin: '4px 0' }}>{i.reference}</p></div>
          </div>
          <div className="table-wrap" style={{ marginTop: 16 }}><table>
            <thead><tr><th>Beskrivelse</th><th>Antall</th><th>Pris</th><th>Beløp</th></tr></thead>
            <tbody>{lines.map((l, k) => <tr key={k}><td>{l.text}</td><td>{l.qty}</td><td>{kr(l.unit)}</td><td>{kr(l.total)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}><strong>Totalt å betale</strong></td><td><strong>{kr(i.amount_ore)}</strong></td></tr></tfoot>
          </table></div>
          {sum !== i.amount_ore && <div className="flash err">Linjene summerer til {nok(sum)}, men fakturabeløpet er {nok(i.amount_ore)}. Bruk fakturabeløpet og sjekk bookingen.</div>}
          <p className="muted" style={{ fontSize: '.85rem' }}>Beløpene er det medlemmet har fått oppgitt og godkjent (inkludert eventuell mva). Velg riktig mva-sats og konto i Fiken.</p>
          <div className="row" style={{ marginTop: 10 }}><CopyButton value={asText} label="Kopier alt som tekst" /><CopyButton value={i.email} label="Kopier e-post" /><CopyButton value={kr(i.amount_ore)} label="Kopier beløp" /></div>
        </div>
        <div className="stack">
          <div className="card">
            <h3>1 · Send fra Fiken</h3>
            <p className="muted" style={{ fontSize: '.88rem' }}>Lag fakturaen i Fiken med linjene til venstre og send den på e-post til kunden. Skriv så inn fakturanummeret fra Fiken her.</p>
            {i.fiken_invoice_number && <p>Sendt fra Fiken: <strong>nr. {i.fiken_invoice_number}</strong>{i.kid_number ? ` · KID ${i.kid_number}` : ''}{i.sent_at ? <><br /><small className="muted">{fmtDateTime(i.sent_at)}</small></> : null}</p>}
            {['draft', 'sent', 'overdue'].includes(i.status) && (
              <form action={invoiceSentAction}><input type="hidden" name="id" value={i.id} />
                <div className="field"><label>Fakturanummer i Fiken</label><input name="fiken_nr" defaultValue={i.fiken_invoice_number ?? ''} required /></div>
                <div className="field"><label>KID (valgfritt)</label><input name="kid" defaultValue={i.kid_number ?? ''} inputMode="numeric" /></div>
                <button className="btn small">{i.fiken_invoice_number ? 'Oppdater' : 'Marker som sendt'}</button></form>
            )}
          </div>
          <div className="card">
            <h3>2 · Når betalingen kommer</h3>
            {i.status === 'paid' ? <p><span className="badge b-ok">Betalt</span> {i.marked_paid_at ? fmtDateTime(i.marked_paid_at) : ''}</p> : ['draft', 'sent', 'overdue'].includes(i.status) ? <>
              <p className="muted" style={{ fontSize: '.88rem' }}>Når innbetalingen er registrert i Fiken eller banken, marker den som betalt her. Medlemmet får beskjed.</p>
              <form action={markInvoicePaidAction}><input type="hidden" name="paymentId" value={i.pid} /><input type="hidden" name="back" value={`/admin/betalinger/faktura/${i.id}`} /><button className="btn ok small">Marker som betalt</button></form>
            </> : <p className="muted">—</p>}
          </div>
        </div>
      </div>
    </>
  );
}
