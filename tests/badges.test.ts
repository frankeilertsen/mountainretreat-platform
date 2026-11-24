import { describe, it, expect } from 'vitest';
import { getPool } from '../lib/db';
import { adminBadges, badgeSignature } from '../lib/domain/badges';

describe('menu badges', () => {
  it('a new long-term inquiry changes the admin badge count and fingerprint; handling it removes it', async () => {
    const before = await adminBadges();
    const r = await getPool().query(`INSERT INTO long_term_inquiries (name, email, message) VALUES ('Test', 'badge@example.test', 'Hei') RETURNING id`);
    const after = await adminBadges();
    expect(after.inquiries).toBe(before.inquiries + 1);
    expect(badgeSignature(after)).not.toBe(badgeSignature(before));
    await getPool().query(`UPDATE long_term_inquiries SET status='contacted' WHERE id=$1`, [r.rows[0].id]);
    expect((await adminBadges()).inquiries).toBe(before.inquiries);
  });
});
