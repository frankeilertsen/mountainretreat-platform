import { one, getPool } from '../lib/db';
import { humanCode, hashToken, randomToken } from '../lib/crypto';
import { addDays, todayOslo } from '../lib/format';

export const today = () => todayOslo();
export const d = (n: number) => addDays(todayOslo(), n);

export async function user(role = 'member', extra: Record<string, unknown> = {}) {
  const email = `${role}-${humanCode(6).toLowerCase()}@test.no`;
  const all: Record<string, unknown> = { email, name: `${role} ${humanCode(3)}`, system_role: role, status: 'active', referral_code: humanCode(8), ...extra };
  const cols = Object.keys(all), vals = Object.values(all);
  return (await one<any>(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})
    RETURNING id, email, name, system_role, status, invite_tier, loyalty_status, cleaning_scope`, vals))!;
}

export async function referral(referrerId: string, referredId: string) {
  const inv = await one<{ id: string }>(`INSERT INTO invitations (inviter_user_id, invitee_email, token_hash, status, expires_at) VALUES ($1,$2,$3,'accepted',now()) RETURNING id`,
    [referrerId, `x${humanCode(6)}@t.no`, hashToken(randomToken())]);
  return (await one<{ id: string }>(`INSERT INTO referrals (referrer_user_id, referred_user_id, invitation_id) VALUES ($1,$2,$3) RETURNING id`, [referrerId, referredId, inv!.id]))!.id;
}

/** Property priced 1000 kr/night (low season; tests run with a flat 10 % member discount, min 2 nights), cleaning fee 500 kr. */
export async function property(opts: { maxGuests?: number } = {}) {
  const p = (await one<{ id: string }>(`INSERT INTO properties (slug, name, max_guests, cleaning_fee_ore) VALUES ($1,'Testhytte',$2,50000) RETURNING id`,
    ['p-' + humanCode(6).toLowerCase(), opts.maxGuests ?? 6]))!.id;
  const cat = (await one<{ id: string }>(`INSERT INTO season_categories (property_id, kind, name, price_per_night_ore, min_nights) VALUES ($1,'low_season','Lavsesong',100000,2) RETURNING id`, [p]))!.id;
  await getPool().query(`INSERT INTO pricing_periods (property_id, season_category_id, name, start_date, end_date) VALUES ($1,$2,'Alt',$3,$4)`, [p, cat, d(-30), d(400)]);
  return p;
}
