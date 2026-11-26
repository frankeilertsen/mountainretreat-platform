-- Airbnb's cleaning fee is now 1 500 kr (used in the member price comparison and texts)
UPDATE properties SET airbnb_cleaning_fee_ore = 150000, updated_at = now() WHERE airbnb_cleaning_fee_ore = 125000 OR airbnb_cleaning_fee_ore IS NULL;
