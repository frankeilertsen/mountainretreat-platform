-- Extra guests (above the included number): 150 kr per person per night, same as on Airbnb
UPDATE properties SET extra_guest_fee_ore = 15000, extra_guest_fee_basis = 'per_night', updated_at = now();
