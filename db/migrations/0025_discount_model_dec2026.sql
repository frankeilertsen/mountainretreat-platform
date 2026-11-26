-- Discount model (Nov 2026):
--  * Member discount 20 % in low and high season, 15 % in holiday periods
--  * Loyalty +1 % per stay, max +5 %, low and high season only
--  * Total discount capped at 25 % per night
--  * Launch campaign: +5 % on all seasons for bookings made in December 2026
--  * Referral bonus 500 kr, max 3 per booking, max 6 unused
INSERT INTO platform_settings (key, value) VALUES
  ('member_holiday_discount_pct', '15'), ('member_discount_cap_pct', '25'), ('member_loyalty_in_holiday', '0'),
  ('launch_discount_pct', '5'), ('launch_discount_from', '2026-12-01'), ('launch_discount_to', '2026-12-31')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
UPDATE platform_settings SET value = '20', updated_at = now() WHERE key = 'member_base_discount_pct';
UPDATE platform_settings SET value = '1;1;1;1;1', updated_at = now() WHERE key = 'member_loyalty_steps';
UPDATE platform_settings SET value = '5', updated_at = now() WHERE key = 'member_loyalty_max_pct';
UPDATE platform_settings SET value = '3', updated_at = now() WHERE key = 'referral_reward_max_per_booking';
UPDATE platform_settings SET value = '6', updated_at = now() WHERE key = 'referral_reward_max_unused';
UPDATE platform_settings SET value = '50000', updated_at = now() WHERE key IN ('referral_reward_referrer_ore', 'referral_reward_referred_ore');
