-- Payment deadline after booking/approval: 1 hour (was 48) – keeps the window for double bookings from other channels short.
UPDATE platform_settings SET value = '1' WHERE key = 'booking_hold_duration_hours';
