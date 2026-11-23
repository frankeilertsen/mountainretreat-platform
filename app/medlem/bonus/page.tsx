import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { rewardBalance } from '@/lib/domain/rewards';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, nokL } from '@/lib/i18n/format';
import { Status, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bonus' };

export default async function Rewards() {
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const W = t.wallet, KIND = W.kind;
  const nok = (o: number) => nokL(o, lang), fmtDate = (d: any) => fmtDateL(d, lang);
  const bal = await rewardBalance(u.id);
  const credits = await q(`SELECT rc.amount_ore, rc.remaining_amount_ore, rc.status, rc.source, rc.role_in_referral, rc.granted_at, rc.vests_at, rc.expires_at, ru.name AS other
     FROM reward_credits rc LEFT JOIN referrals r ON r.id=rc.referral_id
     LEFT JOIN users ru ON ru.id = CASE WHEN rc.role_in_referral='referrer' THEN r.referred_user_id ELSE r.referrer_user_id END
     WHERE rc.user_id=$1 ORDER BY rc.granted_at DESC`, [u.id]);
  const tx = await q(`SELECT rt.kind, rt.amount_ore, rt.note, rt.created_at, b.reference FROM reward_transactions rt LEFT JOIN bookings b ON b.id=rt.booking_id WHERE rt.user_id=$1 ORDER BY rt.created_at DESC LIMIT 100`, [u.id]);
  return (
    <>
      <div className="page-head"><span className="eyebrow">{W.eyebrow}</span><h1>{nok(bal.available)}</h1><p className="muted">{W.lead(bal.pending ? nok(bal.pending) : null)}</p></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card"><h3>{W.credits}</h3>{credits.length === 0 ? <Empty>{W.none}</Empty> : <ul className="list">{credits.map((c, i) => (
          <li key={i}><div className="row between"><strong>{nok(c.amount_ore)}</strong><Status s={c.status} lang={lang} /></div>
            <small>{c.source === 'manual_adjustment' ? W.fromAdmin : c.role_in_referral === 'referrer' ? W.youReferred(c.other ?? W.aMember) : W.welcome(c.other ?? W.aMember)}
              {' · '}{W.remaining(nok(c.remaining_amount_ore))} · {W.expires(fmtDate(c.expires_at))}{c.status === 'pending_vest' ? ` · ${W.availableOn(fmtDate(c.vests_at))}` : ''}</small></li>))}</ul>}</div>
        <div className="card"><h3>{W.tx}</h3>{tx.length === 0 ? <Empty>{W.noTx}</Empty> : <div className="table-wrap"><table><tbody>{tx.map((x, i) => (
          <tr key={i}><td><small>{fmtDate(x.created_at)}</small></td><td>{KIND[x.kind] ?? x.kind}{x.reference ? <small> · {x.reference}</small> : ''}<br /><small className="muted">{x.note}</small></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{x.amount_ore === 0 ? '' : (x.amount_ore > 0 ? '+' : '−') + nok(Math.abs(x.amount_ore))}</td></tr>))}</tbody></table></div>}</div>
      </div>
    </>
  );
}
