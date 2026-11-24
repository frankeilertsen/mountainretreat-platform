import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { requireUser } from '@/lib/auth/current';
import { mockProvider, mockSignature } from '@/lib/domain/payments';
import { appUrl } from '@/lib/notify';
import { nok } from '@/lib/format';
import crypto from 'crypto';
import { ValueButton } from '@/components/ValueButton';

export const dynamic = 'force-dynamic';

/** Simulated hosted checkout (dev only). Sends a signed webhook exactly like a real provider would. */
export default async function MockCheckout({ params }: { params: Promise<{ id: string }> }) {
  if (!mockProvider.configured()) notFound();
  const { id } = await params;
  const u = await requireUser();
  const p = await one(`SELECT p.id, p.amount_ore, p.status, b.reference, b.member_id, b.id AS bid FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=$1 AND p.provider='mock'`, [id]);
  if (!p || p.member_id !== u.id) notFound();
  async function simulate(f: FormData) {
    'use server';
    const type = f.get('result') === 'ok' ? 'payment.succeeded' : 'payment.failed';
    const body = JSON.stringify({ id: 'evt_' + crypto.randomUUID(), type, payment_id: id });
    await fetch(appUrl('/api/webhooks/test'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-signature': mockSignature(body) }, body });
    redirect(`/medlem/bookinger/${p!.bid}?${type === 'payment.succeeded' ? 'betalt=1' : 'feil=' + encodeURIComponent('Betalingen ble avvist (test).')}`);
  }
  return (
    <div className="narrow"><div className="card" style={{ borderStyle: 'dashed' }}>
      <span className="eyebrow">Testbetaling – ingen ekte penger</span>
      <h1>{nok(p.amount_ore)}</h1>
      <p>Booking {p.reference}. Denne siden erstattes av Stripe Checkout når STRIPE_SECRET_KEY er satt.</p>
      {p.status !== 'pending' ? <p>Betalingen har status <strong>{p.status}</strong>.</p> : (
        <form action={simulate} className="stack">
          <ValueButton className="btn ok block" name="result" value="ok">Simuler vellykket betaling</ValueButton>
          <ValueButton className="btn ghost block" name="result" value="fail">Simuler avvist kort</ValueButton>
        </form>
      )}
    </div></div>
  );
}
