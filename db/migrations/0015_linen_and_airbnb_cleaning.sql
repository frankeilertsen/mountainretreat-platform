-- Airbnb's cleaning fee (for the price comparison) and a discount when guests bring their own bed linen
ALTER TABLE properties ADD COLUMN airbnb_cleaning_fee_ore INTEGER CHECK (airbnb_cleaning_fee_ore >= 0);
ALTER TABLE properties ADD COLUMN own_linen_discount_ore INTEGER NOT NULL DEFAULT 0 CHECK (own_linen_discount_ore >= 0);
ALTER TABLE bookings ADD COLUMN own_linen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stay_preparations ADD COLUMN own_linen BOOLEAN NOT NULL DEFAULT false;

-- Owner's figures (Nov 2026): our cleaning 625 kr, Airbnb cleaning 1 250 kr, own linen −50 kr per person
UPDATE properties SET cleaning_fee_ore = 62500, airbnb_cleaning_fee_ore = 125000, own_linen_discount_ore = 5000, updated_at = now();
