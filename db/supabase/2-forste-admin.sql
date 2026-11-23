-- =====================================================================================
-- Mountain Retreat – create the first administrator (you)
-- 1. Change the e-mail address and name below if needed.
-- 2. Supabase → SQL Editor → paste → Run.
-- Then open the site, go to "Logg inn", enter the same e-mail address, click the link in the e-mail and set up two-factor login.
-- =====================================================================================
INSERT INTO users (email, name, system_role, status)
VALUES (lower('frank@mountainretreat.no'), 'Frank', 'super_admin', 'active')
ON CONFLICT DO NOTHING;

SELECT email, name, system_role, status FROM users WHERE system_role = 'super_admin';
