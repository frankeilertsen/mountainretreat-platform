-- Weekend (Friday and Saturday night) prices for seasons and periods
ALTER TABLE season_categories ADD COLUMN weekend_price_per_night_ore INTEGER CHECK (weekend_price_per_night_ore >= 0);
ALTER TABLE pricing_periods   ADD COLUMN weekend_price_per_night_ore INTEGER CHECK (weekend_price_per_night_ore >= 0);

-- Season calendar for Strandafjellet, Nov 2026 – Dec 2027 (from the owner's season overview).
-- Applied only to properties that have no active periods yet. Season prices are only set when they are
-- still the untouched defaults, and the property switches to season pricing only if it has no Airbnb prices.
DO $$
DECLARE pr RECORD; lo UUID; hi UUID; ho UUID;
BEGIN
  FOR pr IN SELECT id FROM properties p WHERE NOT EXISTS (SELECT 1 FROM pricing_periods pp WHERE pp.property_id = p.id AND pp.active) LOOP
    INSERT INTO season_categories (property_id, kind, name, price_per_night_ore, min_nights, color)
      VALUES (pr.id,'low_season','Lavsesong',275000,2,'#BBD7E6'),(pr.id,'high_season','Høysesong',380000,2,'#F1CF86'),(pr.id,'holiday','Ferie',550000,2,'#C2453A')
      ON CONFLICT (property_id, kind) DO NOTHING;
    UPDATE season_categories SET name='Lavsesong', price_per_night_ore=275000, weekend_price_per_night_ore=300000, min_nights=2, color='#BBD7E6', updated_at=now()
      WHERE property_id=pr.id AND kind='low_season' AND price_per_night_ore IN (100000,275000);
    UPDATE season_categories SET name='Høysesong', price_per_night_ore=380000, weekend_price_per_night_ore=420000, min_nights=2, color='#F1CF86', updated_at=now()
      WHERE property_id=pr.id AND kind='high_season' AND price_per_night_ore IN (150000,380000);
    UPDATE season_categories SET name='Ferie', price_per_night_ore=550000, weekend_price_per_night_ore=600000, min_nights=2, color='#C2453A', updated_at=now()
      WHERE property_id=pr.id AND kind='holiday' AND price_per_night_ore IN (200000,550000);
    SELECT id INTO lo FROM season_categories WHERE property_id=pr.id AND kind='low_season';
    SELECT id INTO hi FROM season_categories WHERE property_id=pr.id AND kind='high_season';
    SELECT id INTO ho FROM season_categories WHERE property_id=pr.id AND kind='holiday';
    INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date) VALUES
      (pr.id, lo, 'Lavsesong', '2026-11-20', '2026-12-18'),
      (pr.id, ho, 'Jul og nyttår', '2026-12-19', '2027-01-03'),
      (pr.id, hi, 'Vintersesong', '2027-01-04', '2027-02-19'),
      (pr.id, ho, 'Vinterferie', '2027-02-20', '2027-02-28'),
      (pr.id, hi, 'Vintersesong', '2027-03-01', '2027-03-20'),
      (pr.id, ho, 'Påske', '2027-03-21', '2027-03-29'),
      (pr.id, hi, 'Vår', '2027-03-30', '2027-04-30'),
      (pr.id, lo, 'Lavsesong', '2027-05-01', '2027-05-05'),
      (pr.id, hi, 'Kristi himmelfart', '2027-05-06', '2027-05-09'),
      (pr.id, lo, 'Lavsesong', '2027-05-10', '2027-05-13'),
      (pr.id, hi, '17. mai og pinse', '2027-05-14', '2027-05-17'),
      (pr.id, lo, 'Lavsesong', '2027-05-18', '2027-06-30'),
      (pr.id, hi, 'Sommer', '2027-07-01', '2027-07-09'),
      (pr.id, ho, 'Fellesferie', '2027-07-10', '2027-08-01'),
      (pr.id, hi, 'Sensommer og høst', '2027-08-02', '2027-10-31'),
      (pr.id, lo, 'Lavsesong', '2027-11-01', '2027-12-17'),
      (pr.id, ho, 'Jul og nyttår', '2027-12-18', '2027-12-31');
    IF NOT EXISTS (SELECT 1 FROM external_nightly_rates r WHERE r.property_id = pr.id) THEN
      UPDATE properties SET pricing_mode='manual', updated_at=now() WHERE id=pr.id;
    END IF;
  END LOOP;
END $$;
