-- Loyalty: up to 15 % over 11 bookings – 1 % for the first 5, 1.5 % for the next 4, 2 % for the last 2
INSERT INTO platform_settings (key, value) VALUES ('member_loyalty_steps', '1;1;1;1;1;1.5;1.5;1.5;1.5;2;2')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
UPDATE platform_settings SET value = '15', updated_at = now() WHERE key = 'member_loyalty_max_pct';
