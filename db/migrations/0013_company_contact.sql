-- FKE Property AS forretningsadresse og telefon (only fills in values that are still empty)
UPDATE platform_settings SET value = 'Fr. Nansens vei 11B, 6007 Ålesund', updated_at = now() WHERE key = 'company_address' AND value = '';
UPDATE platform_settings SET value = '+47 905 19 218', updated_at = now() WHERE key = 'company_phone' AND value = '';
