import { getPool, one } from '../db';
import { getNum } from '../settings';
import { rewardBalance } from './rewards';
import { memberDiscount } from './memberDiscount';
import { invitationsWithOutcome, rewardTerms } from './memberOverview';
import type { BenefitData } from '@/components/Benefits';

export async function loadBenefits(userId: string, lang: 'no' | 'en' = 'no'): Promise<BenefitData & { invites: Awaited<ReturnType<typeof invitationsWithOutcome>> }> {
  const [disc, bal, invites, terms, fee, maxUnused, unused] = await Promise.all([
    memberDiscount(userId), rewardBalance(userId), invitationsWithOutcome(userId), rewardTerms(getPool(), lang),
    getNum('airbnb_guest_fee_pct', 15), getNum('referral_reward_max_unused', 10),
    one<{ n: number }>(`SELECT count(*)::int AS n FROM reward_credits WHERE user_id=$1 AND status IN ('pending_vest','available','partially_used') AND expires_at > now() AND remaining_amount_ore > 0`, [userId], getPool()),
  ]);
  return { disc, airbnbFeePct: fee, balance: bal.available, pending: bal.pending, invited: invites.length, qualified: invites.filter(i => i.stage === 'qualified').length,
    terms, unusedBonuses: unused?.n ?? 0, maxUnused, invites };
}
