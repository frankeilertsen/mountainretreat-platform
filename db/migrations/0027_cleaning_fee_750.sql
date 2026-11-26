-- Final cleaning: 750 kr (was 625)
UPDATE properties SET cleaning_fee_ore = 75000, updated_at = now() WHERE cleaning_fee_ore = 62500;
