-- Owner's full price list 1 Dec 2026 – 31 Dec 2027 (replaces all periods in that range).
-- New Year 2027/28 also covers the night into 1 Jan 2028 so the 3-night minimum can be met.
DO $$
DECLARE pr RECORD; lo UUID; hi UUID; ho UUID;
BEGIN
  FOR pr IN SELECT id FROM properties LOOP
    SELECT id INTO lo FROM season_categories WHERE property_id=pr.id AND kind='low_season';
    SELECT id INTO hi FROM season_categories WHERE property_id=pr.id AND kind='high_season';
    SELECT id INTO ho FROM season_categories WHERE property_id=pr.id AND kind='holiday';
    CONTINUE WHEN lo IS NULL OR hi IS NULL OR ho IS NULL;
    UPDATE pricing_periods SET end_date='2026-11-30', updated_at=now()
      WHERE property_id=pr.id AND active AND start_date < '2026-12-01' AND end_date >= '2026-12-01';
    UPDATE pricing_periods SET active=false, updated_at=now()
      WHERE property_id=pr.id AND active AND start_date >= '2026-12-01' AND start_date <= '2028-01-01';
    INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date, price_per_night_ore, weekend_price_per_night_ore, min_nights) VALUES
      (pr.id, lo, 'Desember før jul',             '2026-12-01','2026-12-18', 275000, 300000, 2),
      (pr.id, ho, 'Juleferie, start',             '2026-12-19','2026-12-22', 380000, 380000, 3),
      (pr.id, ho, 'Jul',                          '2026-12-23','2026-12-29', 450000, 450000, 4),
      (pr.id, ho, 'Nyttår',                       '2026-12-30','2027-01-01', 500000, 500000, 3),
      (pr.id, ho, 'Juleferie, slutt',             '2027-01-02','2027-01-03', 380000, 380000, 2),
      (pr.id, hi, 'Januar',                       '2027-01-04','2027-01-31', 330000, 380000, 2),
      (pr.id, hi, 'Februar',                      '2027-02-01','2027-02-12', 350000, 400000, 2),
      (pr.id, hi, 'Uke 7 (vinterferie Rogaland)', '2027-02-13','2027-02-19', 400000, 400000, 3),
      (pr.id, ho, 'Vinterferie uke 8',            '2027-02-20','2027-02-28', 450000, 500000, 4),
      (pr.id, hi, 'Mars',                         '2027-03-01','2027-03-19', 350000, 400000, 2),
      (pr.id, ho, 'Påskeferie, start',            '2027-03-20','2027-03-23', 420000, 420000, 4),
      (pr.id, ho, 'Påske, topp',                  '2027-03-24','2027-03-28', 500000, 500000, 4),
      (pr.id, ho, '2. påskedag',                  '2027-03-29','2027-03-29', 420000, 420000, 2),
      (pr.id, hi, 'April (vårski)',               '2027-03-30','2027-04-30', 320000, 360000, 2),
      (pr.id, lo, 'Mai',                          '2027-05-01','2027-05-05', 275000, 300000, 2),
      (pr.id, hi, 'Kristi himmelfart, langhelg',  '2027-05-06','2027-05-09', 330000, 330000, 3),
      (pr.id, lo, 'Mai',                          '2027-05-10','2027-05-13', 275000, 300000, 2),
      (pr.id, hi, 'Pinse og 17. mai, langhelg',   '2027-05-14','2027-05-17', 330000, 330000, 3),
      (pr.id, lo, 'Mai–juni før skoleslutt',      '2027-05-18','2027-06-18', 275000, 300000, 2),
      (pr.id, hi, 'Juni etter skoleslutt',        '2027-06-19','2027-06-30', 320000, 360000, 2),
      (pr.id, hi, 'Juli før fellesferien',        '2027-07-01','2027-07-09', 320000, 360000, 3),
      (pr.id, ho, 'Fellesferie uke 28–30',        '2027-07-10','2027-08-01', 390000, 420000, 4),
      (pr.id, hi, 'August',                       '2027-08-02','2027-08-31', 320000, 360000, 2),
      (pr.id, hi, 'September',                    '2027-09-01','2027-10-01', 290000, 330000, 2),
      (pr.id, hi, 'Høstferie uke 40–41',          '2027-10-02','2027-10-17', 320000, 360000, 3),
      (pr.id, lo, 'Sen oktober',                  '2027-10-18','2027-10-31', 290000, 320000, 2),
      (pr.id, lo, 'November – midt i desember',   '2027-11-01','2027-12-17', 275000, 300000, 2),
      (pr.id, ho, 'Juleferie, start',             '2027-12-18','2027-12-22', 380000, 380000, 3),
      (pr.id, ho, 'Jul',                          '2027-12-23','2027-12-29', 450000, 450000, 4),
      (pr.id, ho, 'Nyttår',                       '2027-12-30','2028-01-01', 500000, 500000, 3);
  END LOOP;
END $$;
