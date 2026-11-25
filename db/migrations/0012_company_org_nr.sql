-- FKE Property AS organisasjonsnummer (only fills it in if it is still empty)
UPDATE platform_settings SET value = '931 902 725', updated_at = now() WHERE key = 'company_org_nr' AND value = '';
