import Link from 'next/link';
import { q, one } from '@/lib/db';
import { fmtDate, fmtDateTime, nok } from '@/lib/format';
import { stripeProvider, mockProvider, vippsProvider } from '@/lib/domain/payments';
import { Flash, Status } from '@/components/ui';
import { markInvoicePaidAction, retryRefundAction, manualRefundDoneAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Betalinger' };

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const pays = await q(`SELECT p.*, b.reference, b.id AS bid, u.name FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=b.member_id ORDER BY p.created_at DESC LIMIT 200`);
  const invoices = await q(`SELECT i.*, to_char(i.due_date,'YYYY-MM-DD') AS due, p.id AS pid, b.reference, b.id AS bid, u.name FROM invoices i JOIN payments p ON p.id=i.payment_id JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=b.member_id WHERE i.status IN ('draft','sent','overdue') ORDER BY (i.status='draft') DESC, i.due_date`);
  const refunds = await q(`SELECT r.*, b.reference, b.id AS bid, u.name, p.provider FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=b.member_id ORDER BY (r.status<>'succeeded') DESC, r.created_at DESC LIMIT 100`);
  const t = await one(`SELECT COALESCE(sum(amount_ore) FILTER (WHERE status IN ('succeeded','partially_refunded','refunded')),0)::bigint AS paid, COALESCE(sum(refunded_amount_ore),0)::bigint AS refunded FROM payments`);
  const prov = [['Stripe (kort)', stripeProvider.configured() ? 'Aktiv' : 'Mangler nøkler'], ['Vipps', vippsProvider.configured() ? 'Aktiv' : 'Ikke koblet til'], ['Testleverandør', mockProvider.configured() ? 'PÅ (kun utvikling)' : 'Av']];
  return (
    <>
      <div className="page-head"><h1>Betalinger</h1></div>
      <Flash sp={sp} />
      <div className="grid g4" style={{ marginBottom: 20 }}>
        <div className="card kpi-card"><span className="kpi-label">Innbetalt</span><div className="kpi">{nok(Number(t.paid))}</div></div>
        <div className="card kpi-card"><span className="kpi-label">Refundert</span><div className="kpi">{nok(Number(t.refunded))}</div></div>
        <div className="card" style={{ gridColumn: 'span 2' }}><small>Leverandører</small>{prov.map(([n, s]) => <div key={n} className="row between"><span>{n}</span><small>{s}</small></div>)}</div>
      </div>
      {invoices.length > 0 && <div className="card" style={{ marginBottom: 20 }}><h3>Fakturaer</h3>
        <p className="muted" style={{ fontSize: '.88rem' }}>«Skal sendes» = lag og send fakturaen i Fiken ut fra fakturagrunnlaget. Bookingene er allerede bekreftet.</p>
        <table><tbody>{invoices.map(i => (
        <tr key={i.id}><td><Link href={`/admin/bookinger/${i.bid}`}>{i.reference}</Link> · {i.name}</td><td>{i.fiken_invoice_number ? `Fiken nr. ${i.fiken_invoice_number}` : i.invoice_number}</td><td>{nok(i.amount_ore)}</td><td>Forfall {fmtDate(i.due)} <Status s={i.status} /></td>
          <td><Link href={`/admin/betalinger/faktura/${i.id}`} className="btn small">{i.status === 'draft' ? 'Fakturagrunnlag →' : 'Åpne'}</Link></td></tr>))}</tbody></table></div>}
      {refunds.length > 0 && <div className="card" style={{ marginBottom: 20 }}><h3>Refusjoner</h3><table><tbody>{refunds.map(r => (
        <tr key={r.id}><td><Link href={`/admin/bookinger/${r.bid}`}>{r.reference}</Link> · {r.name}</td><td>{nok(r.amount_ore)} · {r.reason}<br /><small className="muted">{r.error}</small></td><td><Status s={r.status} /></td>
          <td><div className="row">{r.status === 'failed' && <form action={retryRefundAction}><input type="hidden" name="id" value={r.id} /><button className="btn ghost small">Prøv igjen</button></form>}
            {r.status !== 'succeeded' && <form action={manualRefundDoneAction}><input type="hidden" name="id" value={r.id} /><button className="btn ghost small">Utført manuelt</button></form>}</div></td></tr>))}</tbody></table></div>}
      <div className="card"><h3>Alle betalinger</h3><div className="table-wrap"><table><thead><tr><th>Tid</th><th>Booking</th><th>Metode</th><th>Beløp</th><th>Refundert</th><th>Status</th></tr></thead><tbody>
        {pays.map(p => <tr key={p.id}><td><small>{fmtDateTime(p.created_at)}</small></td><td><Link href={`/admin/bookinger/${p.bid}`}>{p.reference}</Link> · {p.name}</td><td>{p.method}{p.provider === 'mock' ? ' (test)' : ''}</td><td>{nok(p.amount_ore)}</td><td>{p.refunded_amount_ore ? nok(p.refunded_amount_ore) : ''}</td><td><Status s={p.status} /></td></tr>)}
      </tbody></table></div></div>
    </>
  );
}
