-- Company details shown in the terms of sale (salgsvilkår) and the privacy page. Edited in Admin → Innstillinger.
INSERT INTO platform_settings (key, value) VALUES
  ('company_org_nr', ''),
  ('company_address', ''),
  ('company_phone', ''),
  ('company_email', 'post@mountainretreat.no')
ON CONFLICT (key) DO NOTHING;
