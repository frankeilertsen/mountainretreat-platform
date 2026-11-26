-- Airbnb's service fee is now included in the Airbnb price (paid by the host), so members no longer "save" it.
UPDATE platform_settings SET value = '0', updated_at = now() WHERE key = 'airbnb_guest_fee_pct';
-- Own bed linen: 75 kr per person
UPDATE properties SET own_linen_discount_ore = 7500, updated_at = now() WHERE own_linen_discount_ore IN (0, 5000);
-- Firewood that guests can buy: 125 kr per 15 kg sack of birch, choose how many
INSERT INTO add_on_items (property_id, name, description, price_type, unit_price_ore, mandatory, active)
SELECT NULL, 'Bjørkeved (sekk à 15 kg)', 'Tørr bjørkeved til peisen. Velg hvor mange sekker du vil ha – de står klare når du kommer.', 'per_unit', 12500, false, true
WHERE NOT EXISTS (SELECT 1 FROM add_on_items WHERE name LIKE 'Bjørkeved%');
