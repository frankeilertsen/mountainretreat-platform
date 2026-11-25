import Stripe from 'stripe';
import { appUrl } from '../notify';
import { hmacSign } from '../crypto';
import { vippsConfigured, createVippsPayment, refundVipps } from '../payments/vipps';

/**
 * Payment provider abstraction. Card data never touches this platform: Stripe Checkout (hosted page)
 * collects it. Each provider declares honestly whether it is configured.
 */
export type CheckoutRequest = { paymentId: string; bookingRef: string; amountOre: number; description: string; customerEmail: string; idempotencyKey: string };
export type CheckoutResult = { providerReference: string; checkoutUrl: string };
export type RefundResult = { providerReference: string; status: 'succeeded' | 'pending' | 'failed'; error?: string };

export interface PaymentProvider {
  id: 'stripe' | 'vipps' | 'mock';
  configured(): boolean;
  createCheckout(r: CheckoutRequest): Promise<CheckoutResult>;
  refund(providerReference: string, amountOre: number, idempotencyKey: string): Promise<RefundResult>;
}

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export const stripeProvider: PaymentProvider = {
  id: 'stripe',
  configured: () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET,
  async createCheckout(r) {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: r.customerEmail,
      line_items: [{ quantity: 1, price_data: { currency: 'nok', unit_amount: r.amountOre, product_data: { name: r.description } } }],
      metadata: { payment_id: r.paymentId, booking_ref: r.bookingRef },
      payment_intent_data: { metadata: { payment_id: r.paymentId, booking_ref: r.bookingRef } },
      success_url: appUrl(`/medlem/bookinger?betalt=${r.bookingRef}`),
      cancel_url: appUrl(`/medlem/bookinger?avbrutt=${r.bookingRef}`),
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1 h
    }, { idempotencyKey: r.idempotencyKey });
    return { providerReference: session.id, checkoutUrl: session.url! };
  },
  async refund(providerReference, amountOre, idempotencyKey) {
    // providerReference is the Checkout Session id; refund its PaymentIntent
    const session = await stripe().checkout.sessions.retrieve(providerReference);
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!pi) return { providerReference: '', status: 'failed', error: 'No payment intent on session' };
    const refund = await stripe().refunds.create({ payment_intent: pi, amount: amountOre }, { idempotencyKey });
    return { providerReference: refund.id, status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'pending' };
  },
};

/** Vipps MobilePay ePayment (direct agreement). See lib/payments/vipps.ts. */
export const vippsProvider: PaymentProvider = {
  id: 'vipps',
  configured: () => vippsConfigured(),
  async createCheckout(r) {
    return createVippsPayment({ paymentId: r.paymentId, amountOre: r.amountOre, description: r.description, idempotencyKey: `crt_${r.paymentId}` });
  },
  async refund(providerReference, amountOre, idempotencyKey) {
    try {
      const res = await refundVipps(providerReference, amountOre, idempotencyKey);
      return { providerReference: res.pspReference ?? `${providerReference}:refund:${idempotencyKey}`, status: 'succeeded' };
    } catch (e) {
      return { providerReference: '', status: 'failed', error: (e as Error).message.slice(0, 300) };
    }
  },
};

/**
 * DEV/TEST ONLY: simulates a hosted checkout so every workflow can be tested without Stripe keys.
 * Refuses to run in production unless explicitly allowed.
 */
export const mockProvider: PaymentProvider = {
  id: 'mock',
  configured: () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_PAYMENTS === '1',
  async createCheckout(r) {
    return { providerReference: `mock_${r.paymentId}`, checkoutUrl: appUrl(`/betaling/test/${r.paymentId}`) };
  },
  async refund(ref, amount) {
    return { providerReference: `mock_refund_${ref}_${amount}_${Date.now()}`, status: 'succeeded' };
  },
};

export function cardProvider(): PaymentProvider {
  if (stripeProvider.configured()) return stripeProvider;
  if (mockProvider.configured()) return mockProvider;
  throw new Error('Ingen betalingsleverandør er konfigurert.');
}

export function providerById(id: string): PaymentProvider | null {
  return id === 'stripe' ? stripeProvider : id === 'vipps' ? vippsProvider : id === 'mock' ? mockProvider : null;
}

/** Signature for the mock webhook so it goes through the same verified path as real ones. */
export function mockSignature(body: string): string {
  return hmacSign(body, process.env.CRON_SECRET || 'dev');
}

/** Norwegian KID (MOD10 / Luhn) for invoice payments. */
export function kidMod10(base: string): string {
  let sum = 0;
  const digits = base.split('').reverse().map(Number);
  digits.forEach((d, i) => { let v = i % 2 === 0 ? d * 2 : d; if (v > 9) v -= 9; sum += v; });
  return base + ((10 - (sum % 10)) % 10);
}
