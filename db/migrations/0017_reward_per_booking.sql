-- Up to 10 unused bonuses; up to 5 can be used on one booking
UPDATE platform_settings SET value = '10', updated_at = now() WHERE key = 'referral_reward_max_unused';
INSERT INTO platform_settings (key, value) VALUES ('referral_reward_max_per_booking', '5') ON CONFLICT (key) DO NOTHING;
