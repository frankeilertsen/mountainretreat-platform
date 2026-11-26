-- Loyalty discount: +1.5 percentage points per completed booking (was 1)
UPDATE platform_settings SET value = '1.5', updated_at = now() WHERE key = 'member_loyalty_step_pct';
