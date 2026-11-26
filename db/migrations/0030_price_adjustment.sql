-- Manual price adjustment by the administrator (negative = discount), with an optional note shown to the member
ALTER TABLE bookings ADD COLUMN price_adjustment_ore INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN price_adjustment_note TEXT;
