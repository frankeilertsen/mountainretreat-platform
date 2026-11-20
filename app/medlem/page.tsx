import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { rewardBalance } from '@/lib/domain/rewards';
import { fmtDate, nok } from '@/lib/format';
import { Flash, PropertyMedia, Status, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MemberHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const [props, upcoming, bal] = await Promise.all([
    q(`SELECT p.id, p.slug, p.name, p.short_description, p.max_guests,
              (SELECT ph.id FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=p.id ORDER BY ph.created_at LIMIT 1) AS photo_id,
              (SELECT min(sc.price_per_night_ore * (1 - sc.member_discount_percentage/100)) FROM season_categories sc WHERE sc.property_id=p.id AND sc.active)::int AS from_price
       FROM properties p WHERE p.active ORDER BY p.name`),
    q(`SELECT b.id, b.reference, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", p.name AS property
       FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.member_id=$1 AND b.end_date >= current_date AND b.status IN ('pending_review','awaiting_payment','confirmed','cancellation_requested') ORDER BY b.start_date`, [u.id]),
    rewardBalance(u.id),
  ]);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Velkommen</span>
        <h1>Hei, {u.name.split(' ')[0]}</h1>
      </div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ marginBottom: 36 }}>
        <div className="card">
          <h3>Dine kommende opphold</h3>
          {upcoming.length === 0 ? <Empty>Ingen kommende opphold. Velg en bolig under for å sende en forespørsel.</Empty> : (
            <ul className="list">{upcoming.map(b => (
              <li key={b.id} className="row between">
                <Link href={`/medlem/bookinger/${b.id}`}>{b.property}<br /><small>{fmtDate(b.start, true)} – {fmtDate(b.end, true)}</small></Link>
                <Status s={b.status} />
              </li>))}</ul>
          )}
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Bonuslommebok</span>
          <div className="kpi" style={{ color: 'var(--gold-2)' }}>{nok(bal.available)}</div>
          <p className="muted">tilgjengelig{bal.pending > 0 ? ` · ${nok(bal.pending)} opptjenes` : ''}</p>
          <Link className="btn ghost small" href="/medlem/invitasjoner">Inviter og få bonus</Link>
        </div>
      </div>
      <h2>Boliger</h2>
      <div className="grid g3">
        {props.map(p => (
          <Link key={p.id} href={`/medlem/boliger/${p.slug}`} className="card" style={{ textDecoration: 'none', padding: 14 }}>
            <PropertyMedia photoId={p.photo_id} alt={p.name} />
            <div style={{ padding: '14px 6px 4px' }}>
              <h3 style={{ marginBottom: 4 }}>{p.name}</h3>
              <p className="muted" style={{ marginBottom: 8 }}>{p.short_description}</p>
              <small>Opptil {p.max_guests} gjester{p.from_price ? ` · fra ${nok(p.from_price)} / natt` : ''}</small>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
