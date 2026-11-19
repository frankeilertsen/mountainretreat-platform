import Link from 'next/link';
import { q, one } from '@/lib/db';
import { fmtDate, nok } from '@/lib/format';
import { getSettings } from '@/lib/settings';
import { Flash, Status } from '@/components/ui';
import { revokeRewardAction, saveSettingsAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verving og bonus' };

export default async function RewardsAdmin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const s = await getSettings();
  const totals = await one(`SELECT COALESCE(sum(amount_ore),0)::bigint AS granted, COALESCE(sum(remaining_amount_ore) FILTER (WHERE status IN ('available','partially_used')),0)::bigint AS outstanding,
     COALESCE(sum(remaining_amount_ore) FILTER (WHERE status='pending_vest'),0)::bigint AS vesting, (SELECT COALESCE(sum(amount_applied_ore),0) FROM reward_redemptions WHERE reversed_at IS NULL)::bigint AS redeemed FROM reward_credits`);
  const referrals = await q(`SELECT r.status, r.created_at, r.qualified_at, a.name AS referrer, a.id AS aid, b.name AS referred, b.id AS bid FROM referrals r JOIN users a ON a.id=r.referrer_user_id JOIN users b ON b.id=r.referred_user_id ORDER BY r.created_at DESC LIMIT 50`);
  const credits = await q(`SELECT rc.id, rc.amount_ore, rc.remaining_amount_ore, rc.status, rc.source, rc.role_in_referral, rc.granted_at, rc.expires_at, rc.note, u.name, u.id AS uid FROM reward_credits rc JOIN users u ON u.id=rc.user_id ORDER BY rc.granted_at DESC LIMIT 100`);
  return (
    <>
      <div className="page-head"><h1>Verving og bonus</h1></div>
      <Flash sp={sp} />
      <div className="grid g4" style={{ marginBottom: 20 }}>
        <div className="card"><small>Utdelt totalt</small><div className="kpi">{nok(Number(totals.granted))}</div></div>
        <div className="card"><small>Tilgjengelig hos medlemmer</small><div className="kpi">{nok(Number(totals.outstanding))}</div></div>
        <div className="card"><small>Opptjenes</small><div className="kpi">{nok(Number(totals.vesting))}</div></div>
        <div className="card"><small>Brukt som rabatt</small><div className="kpi">{nok(Number(totals.redeemed))}</div></div>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <form action={saveSettingsAction} className="card">
          <h3>Bonusregler</h3><input type="hidden" name="back" value="/admin/bonus" />
          <p className="muted" style={{ fontSize: '.88rem' }}>Begge parter får bonus når det inviterte medlemmet fullfører sitt første opphold. Endringer gjelder for nye bonuser.</p>
          <div className="field"><label>Type</label><select name="referral_reward_type" defaultValue={s.referral_reward_type}><option value="fixed">Fast beløp</option><option value="percentage">Prosent av første opphold</option></select></div>
          <div className="fields">
            <div><label>Vervet (kr, fast)</label><input name="referral_reward_referrer_ore" defaultValue={Number(s.referral_reward_referrer_ore) / 100} /></div>
            <div><label>Ny (kr, fast)</label><input name="referral_reward_referred_ore" defaultValue={Number(s.referral_reward_referred_ore) / 100} /></div>
            <div><label>Prosent</label><input name="referral_reward_percentage" defaultValue={s.referral_reward_percentage} /></div>
            <div><label>Maks (kr, prosent)</label><input name="referral_reward_max_ore" defaultValue={Number(s.referral_reward_max_ore) / 100} /></div>
            <div><label>Min. oppholdsverdi (kr)</label><input name="referral_min_qualifying_amount_ore" defaultValue={Number(s.referral_min_qualifying_amount_ore) / 100} /></div>
            <div><label>Opptjening (dager)</label><input name="referral_reward_vesting_days" defaultValue={s.referral_reward_vesting_days} /></div>
            <div><label>Gyldighet (dager)</label><input name="referral_reward_validity_days" defaultValue={s.referral_reward_validity_days} /></div>
          </div>
          <button className="btn" style={{ marginTop: 12 }}>Lagre regler</button>
        </form>
        <div className="card"><h3>Vervinger</h3><ul className="list">{referrals.map((r, i) => <li key={i} className="row between"><span><Link href={`/admin/medlemmer/${r.aid}`}>{r.referrer}</Link> → <Link href={`/admin/medlemmer/${r.bid}`}>{r.referred}</Link><br /><small>{fmtDate(r.created_at)}{r.qualified_at ? ` · kvalifisert ${fmtDate(r.qualified_at)}` : ''}</small></span><Status s={r.status} /></li>)}</ul></div>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h3>Bonusregister</h3>
        <div className="table-wrap"><table><thead><tr><th>Medlem</th><th>Kilde</th><th>Beløp</th><th>Gjenstår</th><th>Utløper</th><th>Status</th><th></th></tr></thead><tbody>
          {credits.map(c => <tr key={c.id}><td><Link href={`/admin/medlemmer/${c.uid}`}>{c.name}</Link></td><td><small>{c.source === 'manual_adjustment' ? `Manuell: ${c.note ?? ''}` : c.role_in_referral === 'referrer' ? 'Vervet noen' : 'Ble vervet'}</small></td>
            <td>{nok(c.amount_ore)}</td><td>{nok(c.remaining_amount_ore)}</td><td><small>{fmtDate(c.expires_at)}</small></td><td><Status s={c.status} /></td>
            <td>{['pending_vest', 'available', 'partially_used'].includes(c.status) && <form action={revokeRewardAction}><input type="hidden" name="id" value={c.id} /><button className="btn ghost small">Trekk tilbake</button></form>}</td></tr>)}
        </tbody></table></div>
        <p className="muted" style={{ fontSize: '.85rem' }}>Juster bonus for et enkelt medlem fra medlemssiden.</p>
      </div>
    </>
  );
}
