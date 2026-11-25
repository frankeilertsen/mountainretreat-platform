-- Payment methods: card (Stripe) and Vipps (direct agreement). Invoice is no longer offered.
UPDATE payment_method_settings SET enabled = false, updated_at = now() WHERE method = 'invoice';
INSERT INTO payment_method_settings (method, enabled) VALUES ('vipps', true) ON CONFLICT (method) DO UPDATE SET enabled = true, updated_at = now();
