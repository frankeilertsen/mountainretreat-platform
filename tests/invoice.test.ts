import { describe, it, expect } from 'vitest';
import { user, property, d } from './factory';
import { getPool, one, q } from '../lib/db';
import { approveBooking, requestBooking, startPayment, markInvoicePaid, adminCancel } from '../lib/domain/bookings';
import { runJob } from '../lib/jobs';

async function approved(member: any, start: number) {
  const admin = await user('admin');
  const pid = await property();
  const b = await requestBooking(member, { propertyId: pid, startDate: d(start), endDate: d(start + 3), adults: 2, children: 0, infants: 0, addOns: [] }, { id: member.id, type: 'member' });
  await approveBooking(b.id, { id: admin.id, type: 'admin' });
  return { b, admin };
}

describe('invoice for selected members (issued in Fiken)', () => {
  it('only members the administrator has allowed can choose invoice', async () => {
    const m = await user('member', { invite_tier: 'admin_invited' });
    const { b } = await approved(m, 70);
    await expect(startPayment(b.id, m, 'invoice')).rejects.toThrow(/Faktura er ikke tilgjengelig/);
  });

  it('allowed member: booking confirmed at once, a draft for Fiken is made, admins told; sent → paid', async () => {
    const m = await user('member', { invite_tier: 'admin_invited' });
    await getPool().query(`UPDATE users SET invoice_allowed=true WHERE id=$1`, [m.id]);
    const { b, admin } = await approved(m, 80);
    expect(await startPayment(b.id, m, 'invoice')).toEqual({ invoice: true });
    expect(await startPayment(b.id, m, 'invoice')).toEqual({ invoice: true }); // double click → still one
    const bk = (await one<{ status: string; payment_method: string; price_total_ore: number }>(`SELECT status, payment_method, price_total_ore FROM bookings WHERE id=$1`, [b.id]))!;
    expect(bk.status).toBe('confirmed');
    expect(bk.payment_method).toBe('invoice');
    const inv = await q<{ id: string; status: string; amount_ore: number; kid_number: string | null; pid: string }>(
      `SELECT i.id, i.status, i.amount_ore, i.kid_number, p.id AS pid FROM invoices i JOIN payments p ON p.id=i.payment_id WHERE p.booking_id=$1`, [b.id]);
    expect(inv.length).toBe(1);
    expect(inv[0]).toMatchObject({ status: 'draft', amount_ore: bk.price_total_ore, kid_number: null });
    expect((await q(`SELECT 1 FROM notifications WHERE type='invoice_to_send' AND body LIKE $1`, [`%/admin/betalinger/faktura/${inv[0].id}%`])).length).toBeGreaterThan(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM cleaning_tasks WHERE booking_id=$1 AND status <> 'cancelled'`, [b.id]))!.n).toBeGreaterThan(0);

    await getPool().query(`UPDATE invoices SET status='sent', fiken_invoice_number='10234', sent_at=now() WHERE id=$1`, [inv[0].id]);
    expect(await markInvoicePaid(inv[0].pid, { id: admin.id, type: 'admin' })).toBe('confirmed');
    expect((await one<{ status: string }>(`SELECT status FROM invoices WHERE id=$1`, [inv[0].id]))!.status).toBe('paid');
    expect((await one<{ status: string }>(`SELECT status FROM payments WHERE id=$1`, [inv[0].pid]))!.status).toBe('succeeded');
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id=$1`, [b.id]))!.status).toBe('confirmed');
    expect((await q(`SELECT 1 FROM refunds WHERE payment_id=$1`, [inv[0].pid])).length).toBe(0); // no accidental refund
  });

  it('overdue invoices are flagged once; cancelling tells the admin to credit in Fiken', async () => {
    const m = await user('member', { invite_tier: 'admin_invited' });
    await getPool().query(`UPDATE users SET invoice_allowed=true WHERE id=$1`, [m.id]);
    const { b, admin } = await approved(m, 90);
    await startPayment(b.id, m, 'invoice');
    const inv = (await one<{ id: string }>(`SELECT i.id FROM invoices i JOIN payments p ON p.id=i.payment_id WHERE p.booking_id=$1`, [b.id]))!;
    await getPool().query(`UPDATE invoices SET status='sent', fiken_invoice_number='10299', due_date=current_date - 1 WHERE id=$1`, [inv.id]);
    await runJob('invoice_overdue');
    await runJob('invoice_overdue');
    expect((await one<{ status: string }>(`SELECT status FROM invoices WHERE id=$1`, [inv.id]))!.status).toBe('overdue');
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM notifications WHERE type='invoice_overdue' AND dedupe_key LIKE $1`, [`invoice_overdue:${inv.id}%`]))!.n).toBeGreaterThanOrEqual(1);

    await adminCancel(b.id, { id: admin.id, type: 'admin' });
    expect((await one<{ status: string }>(`SELECT status FROM invoices WHERE id=$1`, [inv.id]))!.status).toBe('cancelled');
    expect((await q(`SELECT 1 FROM notifications WHERE type='invoice_credit' AND body LIKE '%Fiken nr. 10299%'`)).length).toBeGreaterThan(0);
  });
});
