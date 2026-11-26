-- Referral bonus rules (Nov 2026): one bonus per booking, max 5 unused, valid 24 months from the date it was earned
INSERT INTO platform_settings (key, value) VALUES ('referral_reward_validity_months', '24') ON CONFLICT (key) DO NOTHING;
UPDATE platform_settings SET value = '5', updated_at = now() WHERE key = 'referral_reward_max_unused';
ALTER TABLE reward_credits ADD COLUMN expiry_reminded_at TIMESTAMPTZ;
UPDATE reward_credits SET expires_at = granted_at + interval '24 months'
 WHERE status IN ('pending_vest', 'available', 'partially_used') AND expires_at > now();
