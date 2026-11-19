import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { rewardBalance } from '@/lib/domain/rewards';
import { fmtDate, nok } from '@/lib/format';
import { Status, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bonus' };
const KIND: Record<string, string> = { granted: 'Opptjent', vested: 'Tilgjengelig', redeemed: 'Brukt', redemption_reversed: 'Tilbakeført', expired: 'Utløpt', revoked: 'Trukket tilbake', adjusted: 'Justering' };

export default async function Rewards() {
  const u = await requireUser('request_booking');
  const bal = await rewardBalance(u.id);
  const credits = await q(`SELECT rc.amount_ore, rc.remaining_amount_ore, rc.status, rc.source, rc.role_in_referral, rc.granted_at, rc.vests_at, rc.expires_at, ru.name AS other
     FROM reward_credits rc LEFT JOIN referrals r ON r.id=rc.referral_id
     LEFT JOIN users ru ON ru.id = CASE WHEN rc.role_in_referral='referrer' THEN r.referred_user_id ELSE r.referrer_user_id END
     WHERE rc.user_id=$1 ORDER BY rc.granted_at DESC`, [u.id]);
  const tx = await q(`SELECT rt.kind, rt.amount_ore, rt.note, rt.created_at, b.reference FROM reward_transactions rt LEFT JOIN bookings b ON b.id=rt.booking_id WHERE rt.user_id=$1 ORDER BY rt.created_at DESC LIMIT 100`, [u.id]);
  return (
    <>
      <div className="page-head"><span className="eyebrow">Bonuslommebok</span><h1>{nok(bal.available)}</h1><p className="muted">tilgjengelig til bruk{bal.pending ? ` · ${nok(bal.pending)} blir tilgjengelig snart` : ''}. Bonus kan brukes som rabatt på bookinger, men ikke tas ut i penger.</p></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card"><h3>Bonuser</h3>{credits.length === 0 ? <Empty>Ingen bonuser ennå.</Empty> : <ul className="list">{credits.map((c, i) => (
          <li key={i}><div className="row between"><strong>{nok(c.amount_ore)}</strong><Status s={c.status} /></div>
            <small>{c.source === 'manual_adjustment' ? 'Fra administrator' : c.role_in_referral === 'referrer' ? `Du vervet ${c.other ?? 'et medlem'}` : `Velkomstbonus (invitert av ${c.other ?? 'et medlem'})`}
              {' · '}gjenstår {nok(c.remaining_amount_ore)} · utløper {fmtDate(c.expires_at)}{c.status === 'pending_vest' ? ` · tilgjengelig ${fmtDate(c.vests_at)}` : ''}</small></li>))}</ul>}</div>
        <div className="card"><h3>Transaksjoner</h3>{tx.length === 0 ? <Empty>Ingen transaksjoner.</Empty> : <div className="table-wrap"><table><tbody>{tx.map((t, i) => (
          <tr key={i}><td><small>{fmtDate(t.created_at)}</small></td><td>{KIND[t.kind] ?? t.kind}{t.reference ? <small> · {t.reference}</small> : ''}<br /><small className="muted">{t.note}</small></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{t.amount_ore === 0 ? '' : (t.amount_ore > 0 ? '+' : '−') + nok(Math.abs(t.amount_ore))}</td></tr>))}</tbody></table></div>}</div>
      </div>
    </>
  );
}
