import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** GDPR data export: everything we store about the signed-in user. */
export async function GET() {
  const s = await getSession();
  if (!s || s.aal < 2) return new NextResponse('Unauthorized', { status: 401 });
  const [user, bookings, payments, rewards, rewardTx, invitations, referrals, messages] = await Promise.all([
    q(`SELECT id, email, name, phone, system_role, status, invite_tier, loyalty_status, marketing_consent, preferred_lang, created_at, last_login_at FROM users WHERE id=$1`, [s.id]),
    q(`SELECT reference, property_id, start_date, end_date, adults, children, infants, status, price_total_ore, special_requests, requested_at, confirmed_at, cancelled_at FROM bookings WHERE member_id=$1`, [s.id]),
    q(`SELECT p.method, p.amount_ore, p.refunded_amount_ore, p.status, p.created_at FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.member_id=$1`, [s.id]),
    q(`SELECT amount_ore, remaining_amount_ore, status, source, granted_at, expires_at FROM reward_credits WHERE user_id=$1`, [s.id]),
    q(`SELECT kind, amount_ore, note, created_at FROM reward_transactions WHERE user_id=$1`, [s.id]),
    q(`SELECT invitee_email, status, created_at FROM invitations WHERE inviter_user_id=$1`, [s.id]),
    q(`SELECT status, created_at, qualified_at FROM referrals WHERE referrer_user_id=$1 OR referred_user_id=$1`, [s.id]),
    q(`SELECT cv.subject, cv.status, m.sender_side, m.body, m.created_at FROM conversations cv JOIN messages m ON m.conversation_id=cv.id WHERE cv.member_id=$1 ORDER BY cv.created_at, m.created_at`, [s.id]),
  ]);
  await audit(null, { id: s.id, type: 'member' }, 'gdpr.data_exported', 'user', s.id);
  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), user: user[0], bookings, payments, rewards, reward_transactions: rewardTx, invitations, referrals, messages }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="mine-data-mountainretreat.json"' },
  });
}
