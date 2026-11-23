import { describe, it, expect } from 'vitest';
import { getPool, one, q, tx } from '../lib/db';
import { user, property, referral } from './factory';
import { actorFor } from '../lib/audit';
import { createInvitation, invitationQuota, revokeInvitation } from '../lib/domain/invitations';
import { qualifyReferralForBooking } from '../lib/domain/rewards';

const setLimit = (n: number) => getPool().query(`INSERT INTO platform_settings (key, value) VALUES ('invitation_weekly_limit', $1) ON CONFLICT (key) DO UPDATE SET value=$1`, [String(n)]);
const completed = async (memberId: string, pid: string) => (await one<{ id: string }>(`INSERT INTO bookings (reference, property_id, member_id, start_date, end_date, status, stay_price_ore, price_total_ore)
  VALUES ('L-'||substr(md5(random()::text),1,8), $1, $2, current_date - 10, current_date - 7, 'completed', 300000, 300000) RETURNING id`, [pid, memberId]))!.id;

describe('invitation limit: as many as you like, max 50 per week', () => {
  it('a member can send 50 invitations in 7 days; the 51st is refused with when they can send more; revoked ones still count', async () => {
    await setLimit(50);
    const m = await user('member', { invite_tier: 'admin_invited' });
    for (let i = 0; i < 50; i++) await createInvitation(m, { email: `venn${i}-${m.id.slice(0, 6)}@example.no`, presentationId: null }, actorFor(m));
    expect(await invitationQuota(m.id)).toMatchObject({ limit: 50, used: 50, remaining: 0 });
    const first = await one<{ id: string }>(`SELECT id FROM invitations WHERE inviter_user_id=$1 ORDER BY created_at LIMIT 1`, [m.id]);
    await revokeInvitation(first!.id, m as any, actorFor(m));
    await expect(createInvitation(m, { email: `nr51-${m.id.slice(0, 6)}@example.no` }, actorFor(m)))
      .rejects.toThrow(/maks 50 invitasjoner per uke\. Du kan sende flere fra \d\d\.\d\d\. kl\. \d\d:\d\d/);
    // After a week the oldest drop out of the window
    await getPool().query(`UPDATE invitations SET created_at = now() - interval '8 days' WHERE inviter_user_id=$1 AND id IN (SELECT id FROM invitations WHERE inviter_user_id=$1 ORDER BY created_at LIMIT 5)`, [m.id]);
    expect((await invitationQuota(m.id)).remaining).toBe(5);
    await createInvitation(m, { email: `ny-${m.id.slice(0, 6)}@example.no`, presentationId: null }, actorFor(m));
  });

  it('the limit is adjustable, holds under concurrent sends, and does not apply to admins', async () => {
    await setLimit(3);
    const m = await user('member', { invite_tier: 'admin_invited' });
    await createInvitation(m, { email: `a-${m.id.slice(0, 6)}@example.no`, presentationId: null }, actorFor(m));
    await createInvitation(m, { email: `b-${m.id.slice(0, 6)}@example.no`, presentationId: null }, actorFor(m));
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map(i => createInvitation(m, { email: `p${i}-${m.id.slice(0, 6)}@example.no`, presentationId: null }, actorFor(m))));
    expect(r.filter(x => x.status === 'fulfilled').length).toBe(1);
    expect((await invitationQuota(m.id)).used).toBe(3);
    const admin = await user('admin');
    for (let i = 0; i < 5; i++) await createInvitation(admin, { email: `adm${i}-${admin.id.slice(0, 6)}@example.no`, presentationId: null }, actorFor(admin));
    await setLimit(50);
  });
});

describe('referral bonus rules', () => {
  it('inviter gets 500 kr for EACH invited person’s first stay, the invitee gets 500 kr once; later stays give nothing', async () => {
    const pid = await property();
    const inviter = await user('member', { invite_tier: 'admin_invited' });
    const friends = [await user('member'), await user('member'), await user('member')];
    for (const f of friends) await referral(inviter.id, f.id);
    for (const f of friends) {
      const firstStay = await completed(f.id, pid), secondStay = await completed(f.id, pid);
      await tx(c => qualifyReferralForBooking(c, firstStay));
      await tx(c => qualifyReferralForBooking(c, secondStay)); // second booking: no bonus
    }
    const credits = await q<{ user_id: string; amount_ore: number }>(`SELECT user_id, amount_ore FROM reward_credits WHERE user_id = ANY($1)`, [[inviter.id, ...friends.map(f => f.id)]]);
    expect(credits.filter(c => c.user_id === inviter.id).map(c => c.amount_ore)).toEqual([50000, 50000, 50000]);
    for (const f of friends) expect(credits.filter(c => c.user_id === f.id).map(c => c.amount_ore)).toEqual([50000]);
  });
});
