-- =====================================================================================
-- Mountain Retreat – background jobs every minute (e-mail/SMS queue, payment deadlines, calendar sync, reminders)
-- Supabase calls the app's /api/cron once a minute. Vercel's free plan can only run scheduled jobs once a day.
--
-- BEFORE YOU RUN: replace the two values in CAPITALS below:
--   DIN-ADRESSE      → the site's address without https:// and without a slash at the end,
--                      e.g. mountainretreat-platform.vercel.app (later: mountainretreat.no)
--   DIN-CRON-SECRET  → exactly the same value as CRON_SECRET in Vercel
-- =====================================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Remove an earlier version of the job (safe to run again, e.g. when the address changes)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mountainretreat-jobber';

SELECT cron.schedule(
  'mountainretreat-jobber',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://DIN-ADRESSE/api/cron',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'DIN-CRON-SECRET'),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$
);

-- Check after a couple of minutes (status_code should be 200):
-- SELECT id, status_code, left(content::text, 120) AS svar, created FROM net._http_response ORDER BY id DESC LIMIT 5;
