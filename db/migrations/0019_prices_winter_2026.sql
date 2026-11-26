-- Nov 2026 – Jan 2027 with the same prices as the matching 2027 periods.
-- New Year spans 30 Dec – 1 Jan (3 nights, matching the 3-night minimum), January uses the February prices.
DO $$
DECLARE pr RECORD; lo UUID; hi UUID; ho UUID;
BEGIN
  FOR pr IN SELECT id FROM properties LOOP
    SELECT id INTO lo FROM season_categories WHERE property_id=pr.id AND kind='low_season';
    SELECT id INTO hi FROM season_categories WHERE property_id=pr.id AND kind='high_season';
    SELECT id INTO ho FROM season_categories WHERE property_id=pr.id AND kind='holiday';
    CONTINUE WHEN lo IS NULL OR hi IS NULL OR ho IS NULL;
    UPDATE pricing_periods SET active=false, updated_at=now()
      WHERE property_id=pr.id AND active AND start_date >= '2026-11-01' AND end_date <= '2027-01-31';
    UPDATE pricing_periods SET end_date='2026-10-31', updated_at=now()
      WHERE property_id=pr.id AND active AND start_date < '2026-11-01' AND end_date >= '2026-11-01' AND end_date <= '2027-01-31';
    INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date, price_per_night_ore, weekend_price_per_night_ore, min_nights) VALUES
      (pr.id, lo, 'November – midt i desember', '2026-11-20','2026-12-17', 275000, 300000, 2),
      (pr.id, ho, 'Juleferie, start',           '2026-12-18','2026-12-22', 380000, 380000, 3),
      (pr.id, ho, 'Jul',                        '2026-12-23','2026-12-29', 450000, 450000, 4),
      (pr.id, ho, 'Nyttår',                     '2026-12-30','2027-01-01', 500000, 500000, 3),
      (pr.id, hi, 'Januar',                     '2027-01-02','2027-01-31', 370000, 420000, 2);
    -- New Year 2027/28 also covers the night into 1 Jan so a 3-night stay over New Year can be booked
    IF NOT EXISTS (SELECT 1 FROM pricing_periods WHERE property_id=pr.id AND active AND start_date <= '2028-01-01' AND end_date >= '2028-01-01') THEN
      UPDATE pricing_periods SET end_date='2028-01-01', updated_at=now()
        WHERE property_id=pr.id AND active AND name='Nyttår' AND start_date='2027-12-30' AND end_date='2027-12-31';
    END IF;
  END LOOP;
END $$;
