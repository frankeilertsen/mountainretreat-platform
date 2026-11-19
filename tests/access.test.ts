import { describe, it, expect } from 'vitest';
import { getPool, one } from '../lib/db';
import { user, property, d } from './factory';
import { can } from '../lib/auth/rbac';
import { createInvitation, acceptInvitation, applyForLoyalty, decideLoyalty, revokeInvitation } from '../lib/domain/invitations';
import { createSession, loadSession } from '../lib/auth/sessions';
import { helperCanSeeTask, tasksForHelper, startTask, roomPlanForPreparation } from '../lib/domain/cleaning';
import { approveBooking, requestBooking, handlePaymentSucceeded } from '../lib/domain/bookings';
import { requestMagicLink, consumeMagicLink } from '../lib/domain/auth';
import { hashToken } from '../lib/crypto';

const tokenFromLink = (link: string) => link.split('/').pop()!;

describe('role-based access', () => {
  it('permission matrix', () => {
    const base = { id: 'x', status: 'active' };
    expect(can({ ...base, system_role: 'super_admin' }, 'admin')).toBe(true);
    expect(can({ ...base, system_role: 'admin' }, 'manage_admins')).toBe(false);
    expect(can({ ...base, system_role: 'member', invite_tier: 'admin_invited' }, 'invite')).toBe(true);
    expect(can({ ...base, system_role: 'member', invite_tier: 'member_invited', loyalty_status: 'can_apply' }, 'invite')).toBe(false);
    expect(can({ ...base, system_role: 'member', invite_tier: 'member_invited', loyalty_status: 'approved' }, 'invite')).toBe(true);
    expect(can({ ...base, system_role: 'helper' }, 'request_booking')).toBe(false);
    expect(can({ ...base, system_role: 'helper' }, 'admin')).toBe(false);
    expect(can({ ...base, system_role: 'member' }, 'cleaning_portal')).toBe(false);
    expect(can({ ...base, system_role: 'admin', status: 'suspended' }, 'admin')).toBe(false);
  });
});

describe('invitations & membership', () => {
  it('invite → accept creates member, referral and an AAL1 session; link is single-use', async () => {
    const inviter = await user('member', { invite_tier: 'admin_invited' });
    const { link } = await createInvitation(inviter, { email: 'Ny.Person@Example.no', name: 'Ny' }, { id: inviter.id, type: 'member' });
    const token = tokenFromLink(link);
    const res = await acceptInvitation(token, { name: 'Ny Person' }, '127.0.0.1', 'test');
    const u = await one('SELECT email, invite_tier, loyalty_status, status FROM users WHERE id=$1', [res.userId]);
    expect(u).toMatchObject({ email: 'ny.person@example.no', invite_tier: 'member_invited', loyalty_status: 'can_apply', status: 'active' });
    expect(await one('SELECT 1 FROM referrals WHERE referrer_user_id=$1 AND referred_user_id=$2', [inviter.id, res.userId])).toBeTruthy();
    const s = await loadSession(res.sessionToken);
    expect(s!.aal).toBe(1); // TOTP still required
    await expect(acceptInvitation(token, { name: 'Again' }, null, null)).rejects.toThrow(/allerede brukt/);
  });

  it('prevents duplicates, self-invites and invitations from members without invite rights', async () => {
    const inviter = await user('member', { invite_tier: 'admin_invited' });
    const existing = await user('member');
    await expect(createInvitation(inviter, { email: existing.email.toUpperCase() }, { id: inviter.id, type: 'member' })).rejects.toThrow(/allerede medlem/);
    await expect(createInvitation(inviter, { email: inviter.email }, { id: inviter.id, type: 'member' })).rejects.toThrow(/deg selv/);
    await createInvitation(inviter, { email: 'dup@example.no' }, { id: inviter.id, type: 'member' });
    await expect(createInvitation(inviter, { email: 'DUP@example.no' }, { id: inviter.id, type: 'member' })).rejects.toThrow(/aktiv invitasjon/);
    const noRights = await user('member', { invite_tier: 'member_invited', loyalty_status: 'can_apply' });
    await expect(createInvitation(noRights, { email: 'z@example.no' }, { id: noRights.id, type: 'member' })).rejects.toThrow(/godkjent/);
  });

  it('expired or revoked invitations cannot be used', async () => {
    const admin = await user('admin');
    const a = await createInvitation(admin, { email: 'exp@example.no' }, { id: admin.id, type: 'admin' });
    await getPool().query(`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id=$1`, [a.invitationId]);
    await expect(acceptInvitation(tokenFromLink(a.link), { name: 'Exp' }, null, null)).rejects.toThrow(/utløpt/);
    const b = await createInvitation(admin, { email: 'rev@example.no' }, { id: admin.id, type: 'admin' });
    await revokeInvitation(b.invitationId, admin, { id: admin.id, type: 'admin' });
    await expect(acceptInvitation(tokenFromLink(b.link), { name: 'Rev' }, null, null)).rejects.toThrow(/trukket tilbake/);
  });

  it('member-invited members get invite rights only after loyalty approval', async () => {
    const admin = await user('admin');
    const m = await user('member', { invite_tier: 'member_invited', loyalty_status: 'can_apply' });
    await applyForLoyalty(m, { id: m.id, type: 'member' });
    await expect(applyForLoyalty({ ...m, loyalty_status: 'can_apply' }, { id: m.id, type: 'member' })).rejects.toThrow(/allerede/);
    const app = await one<{ id: string }>('SELECT id FROM loyalty_applications WHERE applicant_user_id=$1', [m.id]);
    await decideLoyalty(app!.id, true, { id: admin.id, type: 'admin' });
    const after = await one('SELECT id, system_role, status, invite_tier, loyalty_status FROM users WHERE id=$1', [m.id]);
    expect(can(after, 'invite')).toBe(true);
  });

  it('magic link login: unknown emails reveal nothing; token is single use; suspended users cannot log in', async () => {
    const m = await user('member');
    await requestMagicLink('nobody@nowhere.no', '10.0.0.1'); // silent
    await requestMagicLink(m.email, '10.0.0.1');
    const n = await one<{ body: string }>(`SELECT body FROM notifications WHERE user_id=$1 AND type='magic_link'`, [m.id]);
    const token = n!.body.match(/token=([\w-]+)/)![1];
    const sess = await consumeMagicLink(token, null, null);
    expect((await loadSession(sess))!.aal).toBe(1);
    await expect(consumeMagicLink(token, null, null)).rejects.toThrow(/utløpt eller allerede brukt/);
    await getPool().query(`UPDATE users SET status='suspended' WHERE id=$1`, [m.id]);
    expect(await loadSession(sess)).toBeNull();
  });

  it('sessions expire after inactivity (admins: 30 min)', async () => {
    const admin = await user('admin');
    const t = await createSession(admin.id, 'admin', { aal: 2 });
    expect(await loadSession(t)).not.toBeNull();
    await getPool().query(`UPDATE sessions SET last_activity_at = now() - interval '31 minutes' WHERE session_token_hash=$1`, [hashToken(t)]);
    expect(await loadSession(t)).toBeNull();
  });

  it('magic link requests are rate limited', async () => {
    const m = await user('member');
    for (let i = 0; i < 5; i++) await requestMagicLink(m.email, '10.9.9.' + i);
    await expect(requestMagicLink(m.email, '10.9.9.99')).rejects.toThrow(/For mange/);
  });
});

describe('cleaning portal isolation', () => {
  it('helpers see only assigned tasks (unless granted broad access) and never prices or guest names', async () => {
    const pid = await property();
    const admin = await user('admin');
    const m = await user('member', { invite_tier: 'admin_invited' });
    const rita = await user('helper');
    const other = await user('helper');
    const broad = await user('helper', { cleaning_scope: 'all' });
    await getPool().query(`INSERT INTO helper_property_assignments (helper_user_id, property_id) VALUES ($1,$2)`, [rita.id, pid]);
    const b = await requestBooking(m, { propertyId: pid, startDate: d(5), endDate: d(7), adults: 2, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
    await approveBooking(b.id, { id: admin.id, type: 'admin' });
    const p = await one<{ id: string }>(`INSERT INTO payments (booking_id, method, provider, amount_ore, idempotency_key) VALUES ($1,'stripe_card','mock',1,'h1') RETURNING id`, [b.id]);
    await handlePaymentSucceeded(p!.id);
    const task = await one<{ id: string; assigned_to_user_id: string }>(`SELECT id, assigned_to_user_id FROM cleaning_tasks WHERE booking_id=$1 AND task_type='turnover'`, [b.id]);
    expect(task!.assigned_to_user_id).toBe(rita.id); // auto-assigned: only helper on the property
    expect(await helperCanSeeTask(rita, task!.id)).toBe(true);
    expect(await helperCanSeeTask(other, task!.id)).toBe(false);
    expect(await helperCanSeeTask(broad, task!.id)).toBe(true);
    expect(await helperCanSeeTask(m, task!.id)).toBe(false);
    await expect(startTask(task!.id, other, { id: other.id, type: 'helper' })).rejects.toThrow(/tilgang/);
    const list = await tasksForHelper(rita, d(0), d(30));
    expect(list.length).toBeGreaterThan(0);
    const keys = Object.keys(list[0]).join(',');
    expect(keys).not.toMatch(/price|ore|member|email|phone|name_of_guest/);
    expect(await tasksForHelper(other, d(0), d(30))).toEqual([]);
  });

  it('room plan for a stay is derived from the configured beds and can be overridden', async () => {
    const pid = await property();
    const admin = await user('admin');
    const r1 = (await one<{ id: string }>(`INSERT INTO rooms (property_id, name, max_capacity, sort_order) VALUES ($1,'Soverom 1',2,1) RETURNING id`, [pid]))!.id;
    const r2 = (await one<{ id: string }>(`INSERT INTO rooms (property_id, name, max_capacity, sort_order) VALUES ($1,'Soverom 2',2,2) RETURNING id`, [pid]))!.id;
    await getPool().query(`INSERT INTO beds (property_id, room_id, label, bed_type, sleeps, allocation_priority) VALUES ($1,$2,'Dobbel','double',2,10),($1,$3,'Enkel','single',1,20),($1,$3,'Enkel 2','single',1,21)`, [pid, r1, r2]);
    const prep = (await one<{ id: string }>(`INSERT INTO stay_preparations (property_id, external_event_id, adults) SELECT $1, NULL, 3 WHERE false RETURNING id`, [pid]));
    // create a prep tied to a booking
    const m = await user('member', { invite_tier: 'admin_invited' });
    const b = await requestBooking(m, { propertyId: pid, startDate: d(30), endDate: d(32), adults: 3, children: 0, infants: 0, addOns: [] }, { id: m.id, type: 'member' });
    const sp = await one<{ id: string }>('SELECT id FROM stay_preparations WHERE booking_id=$1', [b.id]);
    const plan = await roomPlanForPreparation(sp!.id, pid);
    expect(plan.source).toBe('auto');
    const room2 = plan.rooms.find(r => r.name === 'Soverom 2')!;
    expect(room2.guestsInRoom).toBe(1);
    expect(room2.beds.filter(b => b.allocation).length).toBe(1);
    expect(room2.supplies.towelsLarge).toBe(1);
    const { overrideSleepingPlan } = await import('../lib/domain/cleaning');
    const singles = room2.beds.map(b => b.id);
    await overrideSleepingPlan(sp!.id, [{ bed_id: singles[0], persons: 1, guest_type: 'adult' }, { bed_id: singles[1], persons: 1, guest_type: 'adult' }], { id: admin.id, type: 'admin' });
    const over = await roomPlanForPreparation(sp!.id, pid);
    expect(over.source).toBe('admin_override');
    expect(over.rooms.find(r => r.name === 'Soverom 1')!.guestsInRoom).toBe(0);
    expect(prep).toBeNull();
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    await getPool().query(`INSERT INTO audit_log (actor_type, action, entity_type) VALUES ('system','x','y')`);
    await expect(getPool().query(`UPDATE audit_log SET action='z'`)).rejects.toThrow(/append-only/);
    await expect(getPool().query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
  });
});
