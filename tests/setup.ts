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
});
afterAll(async () => {
  await getPool().end();
  (global as any).__pgPool = undefined;
});
