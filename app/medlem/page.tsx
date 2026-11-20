import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { rewardBalance } from '@/lib/domain/rewards';
import { memberDiscount } from '@/lib/domain/memberDiscount';
import { invitationsWithOutcome, rewardTerms } from '@/lib/domain/memberOverview';
import { fmtDate, nok } from '@/lib/format';
import { Flash, PropertyMedia, Status, Empty } from '@/components/ui';
import { BenefitCards } from '@/components/Benefits';

export const dynamic = 'force-dynamic';

export default async function MemberHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const [props, history, bal, disc, invites, terms] = await Promise.all([
    q(`SELECT p.id, p.slug, p.name, p.short_description, p.max_guests,
              (SELECT ph.id FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=p.id ORDER BY ph.created_at LIMIT 1) AS photo_id,
              (SELECT min(sc.price_per_night_ore) FROM season_categories sc WHERE sc.property_id=p.id AND sc.active)::int AS from_price
       FROM properties p WHERE p.active ORDER BY p.name`),
    q(`SELECT b.id, b.reference, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.price_total_ore, p.name AS property,
              (b.price_breakdown->'quote'->>'member_discount_pct')::numeric AS disc
       FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.member_id=$1 ORDER BY b.start_date DESC LIMIT 12`, [u.id]),
    rewardBalance(u.id), memberDiscount(u.id), invitationsWithOutcome(u.id), rewardTerms(),
  ]);
  const upcoming = history.filter(b => ['pending_review', 'awaiting_payment', 'confirmed', 'cancellation_requested'].includes(b.status));
  return (
    <>
      <div className="page-head row between">
        <div><span className="eyebrow">Velkommen</span><h1 style={{ marginBottom: 0 }}>Hei, {u.name.split(' ')[0]}</h1></div>
        <Link href="/medlem/fordeler" className="btn secondary small">Slik fungerer fordelene</Link>
      </div>
      <Flash sp={sp} />
      <BenefitCards disc={disc} balance={bal.available} pending={bal.pending} invited={invites.length} qualified={invites.filter(i => i.stage === 'qualified').length} terms={terms} />

      <h2 style={{ marginTop: 40 }}>Boliger</h2>
      <div className="grid g3">
        {props.map(p => (
          <Link key={p.id} href={`/medlem/boliger/${p.slug}`} className="card" style={{ textDecoration: 'none', padding: 14 }}>
            <PropertyMedia photoId={p.photo_id} alt={p.name} />
            <div style={{ padding: '14px 6px 4px' }}>
              <h3 style={{ marginBottom: 4 }}>{p.name}</h3>
              <p className="muted" style={{ marginBottom: 8 }}>{p.short_description}</p>
              <small>Opptil {p.max_guests} gjester{p.from_price ? <> · fra <span style={{ color: 'var(--gold-2)' }}>{nok(p.from_price * (1 - disc.totalPct / 100))}</span> / natt med din rabatt</> : ''}</small>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid g2" style={{ marginTop: 40, alignItems: 'start' }}>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Bookinghistorikk</h3><Link href="/medlem/bookinger" className="muted">Alle →</Link></div>
          {history.length === 0 ? <Empty>Ingen bookinger ennå.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>Bolig</th><th>Datoer</th><th>Rabatt</th><th>Beløp</th><th>Status</th></tr></thead><tbody>
              {history.map(b => <tr key={b.id}><td><Link href={`/medlem/bookinger/${b.id}`}>{b.property}</Link></td><td><small>{fmtDate(b.start)} – {fmtDate(b.end)}</small></td>
                <td><small>{b.disc != null ? `${Number(b.disc)} %` : '–'}</small></td><td>{nok(b.price_total_ore)}</td><td><Status s={b.status} /></td></tr>)}
            </tbody></table></div>)}
          {upcoming.length > 0 && <small className="muted">{upcoming.length} kommende opphold.</small>}
        </div>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Mine invitasjoner</h3><Link href="/medlem/invitasjoner" className="muted">Inviter →</Link></div>
          {invites.length === 0 ? <Empty>Du har ikke invitert noen ennå. Både du og den du inviterer får {terms.referrer} når vedkommende har fullført sitt første opphold.</Empty> : (
            <ul className="list">{invites.slice(0, 6).map(i => (
              <li key={i.id} className="row between"><span>{i.member_name ?? i.invitee_name ?? i.invitee_email}</span>
                <span className="row">{i.reward_ore ? <span style={{ color: 'var(--gold-2)' }}>+{nok(i.reward_ore)}</span> : null}<span className={`badge ${i.stage === 'qualified' ? 'b-ok' : i.stage === 'booked' ? 'b-clay' : i.stage === 'member_no_booking' ? 'b-warn' : ''}`}>{{ pending: 'Invitert', expired: 'Utløpt', revoked: 'Trukket', member_no_booking: 'Ikke booket', booked: 'Har booket', qualified: 'Bonus gitt' }[i.stage]}</span></span></li>))}</ul>)}
        </div>
      </div>
    </>
  );
}
