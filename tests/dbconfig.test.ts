import { describe, it, expect } from 'vitest';
import { poolConfig } from '../lib/db';

describe('database connection settings', () => {
  it('Supabase pooler URL: TLS on, sslmode removed from the URL (so it cannot override), certificate checked when a CA is given', () => {
    const url = 'postgresql://postgres.abc:pw@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=require';
    const a = poolConfig(url);
    expect(a.connectionString).not.toContain('sslmode');
    expect(a.ssl).toEqual({ rejectUnauthorized: false });
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';
    const b = poolConfig(url);
    expect(b.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----', rejectUnauthorized: true });
    delete process.env.DATABASE_CA_CERT;
    expect(poolConfig('postgres://postgres@localhost:5432/x').ssl).toBeUndefined();
  });
});
