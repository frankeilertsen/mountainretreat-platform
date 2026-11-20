import { beforeAll, afterAll } from 'vitest';
import { migrate } from '../scripts/migrate';
import { getPool } from '../lib/db';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/byrampen_test';
process.env.TOKEN_PEPPER ||= 'test-pepper';
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.CRON_SECRET ||= 'test-cron';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, true);
  // Most tests assume a flat 10 % member discount; tests/discount.test.ts exercises the loyalty steps explicitly.
  await getPool().query(`UPDATE platform_settings SET value = CASE key WHEN 'member_base_discount_pct' THEN '10' WHEN 'member_loyalty_step_pct' THEN '0' ELSE value END`);
});
afterAll(async () => {
  await getPool().end();
  (global as any).__pgPool = undefined;
});
