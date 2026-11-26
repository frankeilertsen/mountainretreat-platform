import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { loadBenefits } from '@/lib/domain/benefits';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, nokL } from '@/lib/i18n/format';
import { Flash, PropertyMedia, Status, Empty } from '@/components/ui';
import { BenefitCards } from '@/components/Benefits';

export const dynamic = 'force-dynamic';

export default async function MemberHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const H = t.home;
  const nok = (o: number) => nokL(o, lang), fmtDate = (d: string) => fmtDateL(d, lang);
  const [props, history, benefits] = await Promise.all([
    q(`SELECT p.id, p.slug, p.name, p.short_description, p.max_guests,
              (SELECT ph.id FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=p.id ORDER BY ph.created_at LIMIT 1) AS photo_id,
              (CASE WHEN p.pricing_mode='airbnb' THEN (SELECT min(r.price_ore) FROM external_nightly_rates r WHERE r.property_id=p.id AND r.date BETWEEN current_date AND current_date + 90) ELSE (SELECT min(sc.price_per_night_ore) FROM season_categories sc WHERE sc.property_id=p.id AND sc.active) END)::int AS from_price
       FROM properties p WHERE p.active ORDER BY p.name`),
    q(`SELECT b.id, b.reference, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.price_total_ore, p.name AS property,
              (b.price_breakdown->'quote'->>'member_discount_pct')::numeric AS disc
       FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.member_id=$1 ORDER BY b.start_date DESC LIMIT 12`, [u.id]),
    loadBenefits(u.id, lang),
  ]);
  const { disc, invites, terms } = benefits;
  const upcoming = history.filter(b => ['pending_review', 'awaiting_payment', 'confirmed', 'cancellation_requested'].includes(b.status));
  return (
    <>
      <div className="page-head row between">
        <div><span className="eyebrow">{H.welcome}</span><h1 style={{ marginBottom: 0 }}>{H.hi(u.name.split(' ')[0])}</h1></div>
        <Link href="/medlem/fordeler" className="btn secondary small">{H.howBenefits}</Link>
      </div>
      <Flash sp={sp} lang={lang} />
      <BenefitCards {...benefits} lang={lang} />

      <h2 style={{ marginTop: 40 }}>{H.properties}</h2>
      <div className="prop-list">
        {props.map(p => (
          <Link key={p.id} href={`/medlem/boliger/${p.slug}`} className="card prop-row">
            <PropertyMedia photoId={p.photo_id} alt={p.name} />
            <div>
              <h3>{p.name}</h3>
              {p.short_description && <p className="muted">{p.short_description}</p>}
              <small>{H.upTo(p.max_guests)}{p.from_price ? <> · {H.fromPrice} <span style={{ color: 'var(--gold-2)' }}>{nok(p.from_price * (1 - disc.totalPct / 100))}</span> {H.withDiscount}</> : ''}</small>
              <div className="go">{lang === 'en' ? 'View and book →' : 'Se og book →'}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid g2" style={{ marginTop: 40, alignItems: 'start' }}>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>{H.history}</h3><Link href="/medlem/bookinger" className="muted">{t.common.all}</Link></div>
          {history.length === 0 ? <Empty>{H.noBookings}</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>{H.th.property}</th><th>{H.th.dates}</th><th>{H.th.discount}</th><th>{H.th.amount}</th><th>{H.th.status}</th></tr></thead><tbody>
              {history.map(b => <tr key={b.id}><td><Link href={`/medlem/bookinger/${b.id}`}>{b.property}</Link></td><td><small>{fmtDate(b.start)} – {fmtDate(b.end)}</small></td>
                <td><small>{b.disc != null ? `${Number(b.disc)} %` : '–'}</small></td><td>{nok(b.price_total_ore)}</td><td><Status s={b.status} lang={lang} /></td></tr>)}
            </tbody></table></div>)}
          {upcoming.length > 0 && <small className="muted">{H.upcomingCount(upcoming.length)}</small>}
        </div>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>{H.myInvites}</h3><Link href="/medlem/invitasjoner" className="muted">{H.invite}</Link></div>
          {invites.length === 0 ? <Empty>{H.noInvites(terms.referrer)}</Empty> : (
            <ul className="list">{invites.slice(0, 6).map(i => (
              <li key={i.id} className="row between"><span>{i.member_name ?? i.invitee_name ?? i.invitee_email}</span>
                <span className="row">{i.reward_ore ? <span style={{ color: 'var(--gold-2)' }}>+{nok(i.reward_ore)}</span> : null}<span className={`badge ${i.stage === 'qualified' ? 'b-ok' : i.stage === 'booked' ? 'b-clay' : i.stage === 'member_no_booking' ? 'b-warn' : ''}`}>{H.stageShort[i.stage]}</span></span></li>))}</ul>)}
        </div>
      </div>
    </>
  );
}
