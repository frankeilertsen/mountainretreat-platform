-- Members book directly (no manual approval) when 1; 0 = every booking waits for admin approval (previous behaviour).
INSERT INTO platform_settings (key, value) VALUES ('booking_auto_approve', '1') ON CONFLICT (key) DO UPDATE SET value = '1';
