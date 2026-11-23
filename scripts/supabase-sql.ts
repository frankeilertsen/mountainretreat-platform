/**
 * Builds db/supabase/1-oppsett.sql: every migration in order + the lock-down Supabase needs, as ONE file to paste into
 * Supabase → SQL Editor on a fresh project. Run `npm run supabase:sql` after adding a migration.
 */
import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '..', 'db', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const parts: string[] = [
`-- =====================================================================================
-- Mountain Retreat – full database setup for a NEW Supabase project
-- Paste everything into Supabase → SQL Editor → Run. Run it only once (it stops if the tables already exist).
-- Generated from db/migrations (${files.join(', ')}). Do not edit by hand – run: npm run supabase:sql
-- =====================================================================================

DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations') THEN
    RAISE EXCEPTION 'Databasen er allerede satt opp (schema_migrations finnes). Ikke kjør denne filen på nytt.';
  END IF;
END $guard$;

-- Dates like "today" follow Norwegian time
ALTER DATABASE postgres SET timezone TO 'Europe/Oslo';
SET timezone TO 'Europe/Oslo';

CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
`];
for (const f of files) {
  parts.push(`\n-- ---------------------------------------------------------------- ${f}\n` + fs.readFileSync(path.join(dir, f), 'utf8').trim() + `\nINSERT INTO schema_migrations (name) VALUES ('${f}');\n`);
}
parts.push(`
-- ---------------------------------------------------------------- Supabase lock-down
-- The app connects straight to Postgres. Supabase's public API keys must not be able to read or change anything here,
-- so: row level security on every table (no policies = no access through the API) and no grants to the API roles.
DO $rls$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $rls$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------- File storage (photos and PDF presentations)
-- PRIVATE bucket: files are only handed out by the app after it has checked who is asking.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mountainretreat', 'mountainretreat', false, 20971520, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

SELECT 'Ferdig: ' || count(*) || ' tabeller er opprettet.' AS resultat FROM pg_tables WHERE schemaname = 'public';
`);
fs.mkdirSync(path.join(__dirname, '..', 'db', 'supabase'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'db', 'supabase', '1-oppsett.sql'), parts.join(''));
console.log('wrote db/supabase/1-oppsett.sql from', files.length, 'migrations');
