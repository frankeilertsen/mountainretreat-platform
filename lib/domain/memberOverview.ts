import { Db, getPool, q } from '../db';
import { getSettings } from '../settings';
import { nok } from '../format';

export type InviteRow = {
  id: string; invitee_email: string; invitee_name: string | null; status: string; created_at: string; member_name: string | null;
  referral_status: string | null; active_bookings: number; completed_stays: number; reward_ore: number | null;
  stage: 'pending' | 'expired' | 'revoked' | 'member_no_booking' | 'booked' | 'qualified';
};

/** A member's own invitations with what happened afterwards (only the invitee's FIRST completed stay gives bonus). */
export async function invitationsWithOutcome(userId: string, db: Db = getPool()): Promise<InviteRow[]> {
  const rows = await q<Omit<InviteRow, 'stage'>>(
    `SELECT i.id, i.invitee_email, i.invitee_name, i.status, i.created_at, u.name AS member_name, r.status AS referral_status,
       (SELECT count(*) FROM bookings b WHERE b.member_id=u.id AND b.status IN ('pending_review','awaiting_payment','confirmed','cancellation_requested'))::int AS active_bookings,
       (SELECT count(*) FROM bookings b WHERE b.member_id=u.id AND b.status='completed')::int AS completed_stays,
       (SELECT rc.amount_ore FROM reward_credits rc WHERE rc.referral_id=r.id AND rc.role_in_referral='referrer') AS reward_ore
     FROM invitations i LEFT JOIN users u ON u.id=i.accepted_user_id LEFT JOIN referrals r ON r.invitation_id=i.id
     WHERE i.inviter_user_id=$1 AND i.role='member' ORDER BY i.created_at DESC`, [userId], db);
  return rows.map(r => ({
    ...r,
    stage: r.referral_status === 'qualified' ? 'qualified' : r.status === 'accepted' ? (r.active_bookings > 0 ? 'booked' : 'member_no_booking')
      : r.status === 'pending' ? 'pending' : r.status === 'revoked' ? 'revoked' : 'expired',
  }));
}

export const STAGE_LABEL: Record<InviteRow['stage'], [string, string]> = {
  pending: ['Invitert – ikke registrert ennå', 'b-info'],
  expired: ['Invitasjonen utløp', ''],
  revoked: ['Trukket tilbake', ''],
  member_no_booking: ['Medlem – har ikke booket', 'b-warn'],
  booked: ['Har booket – bonus etter oppholdet', 'b-clay'],
  qualified: ['Første opphold fullført – bonus gitt', 'b-ok'],
};

/** Human description of the current referral reward (from admin settings). */
export async function rewardTerms(db: Db = getPool()) {
  const s = await getSettings(db);
  if (s.referral_reward_type === 'percentage') {
    const t = `${s.referral_reward_percentage} % av det første oppholdet (maks ${nok(Number(s.referral_reward_max_ore))})`;
    return { referrer: t, referred: t, vestingDays: Number(s.referral_reward_vesting_days) };
  }
  return { referrer: nok(Number(s.referral_reward_referrer_ore)), referred: nok(Number(s.referral_reward_referred_ore)), vestingDays: Number(s.referral_reward_vesting_days) };
}
