-- When the guest cancels, the card/Vipps payment fee (not returned by Stripe/Vipps) is deducted from the refund
INSERT INTO platform_settings (key, value) VALUES ('cancellation_payment_fee_pct', '2.99'), ('cancellation_payment_fee_fixed_ore', '200')
  ON CONFLICT (key) DO NOTHING;
ALTER TABLE refunds ADD COLUMN fee_deducted_ore INTEGER NOT NULL DEFAULT 0;
