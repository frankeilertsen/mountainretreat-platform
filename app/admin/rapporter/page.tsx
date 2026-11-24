import { q } from '@/lib/db';
import { nok } from '@/lib/format';
import { BarChart } from '@/components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rapporter' };
const M = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

export default async function Reports() {
  const revenue = await q(`SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(sum(p.amount_ore - p.refunded_amount_ore),0)::bigint AS amount
    FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
    LEFT JOIN payments p ON date_trunc('month', p.created_at) = m AND p.status IN ('succeeded','partially_refunded','refunded') GROUP BY m ORDER BY m`);
  const nights = await q(`SELECT to_char(m,'YYYY-MM') AS month,
      COALESCE(sum(CASE WHEN ab.block_type='platform_booking' THEN upper(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) - lower(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) END),0)::int AS own,
      COALESCE(sum(CASE WHEN ab.block_type='external_sync' THEN upper(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) - lower(ab.date_range * daterange(m::date,(m+interval '1 month')::date)) END),0)::int AS external
    FROM generate_series(date_trunc('month', now()) - interval '2 months', date_trunc('month', now()) + interval '9 months', interval '1 month') m
    LEFT JOIN availability_blocks ab ON ab.date_range && daterange(m::date,(m+interval '1 month')::date) GROUP BY m ORDER BY m`);
  const props = await q(`SELECT count(*)::int AS n FROM properties WHERE active`);
  const funnel = await q(`SELECT status, count(*)::int AS n FROM bookings WHERE requested_at > now() - interval '12 months' GROUP BY status ORDER BY n DESC`);
  const refs = await q(`SELECT (SELECT count(*) FROM invitations WHERE created_at > now() - interval '12 months')::int AS sent, (SELECT count(*) FROM invitations WHERE status='accepted' AND created_at > now() - interval '12 months')::int AS accepted, (SELECT count(*) FROM referrals WHERE status='qualified')::int AS qualified`);
  const cap = (props[0]?.n || 1) * 30;
  return (
    <>
      <div className="page-head"><h1>Rapporter</h1></div>
      <div className="report-grid" style={{ alignItems: 'start' }}>
        <div className="card"><h3>Innbetalt per måned (netto)</h3><small className="muted">Siste 12 måneder · totalt {nok(revenue.reduce((t, r) => t + Number(r.amount), 0))}</small>
          <BarChart money data={revenue.map(r => ({ label: M[Number(r.month.slice(5)) - 1], value: Number(r.amount) }))} /></div>
        <div className="card"><h3>Belegg per måned (alle boliger)</h3><small className="muted">Netter · kapasitet {cap} per måned</small>
          <BarChart data={nights.map(r => ({ label: M[Number(r.month.slice(5)) - 1], value: r.own, value2: r.external }))} />
          <div className="legend"><span><i style={{ background: 'var(--gold)' }} />Retreat Club</span><span><i style={{ background: '#6f8a9b' }} />Eksterne kanaler</span></div></div>
        <div className="card"><h3>Forespørsler siste 12 mnd</h3><ul className="list">{funnel.map(f => <li key={f.status} className="row between"><span>{f.status}</span><strong>{f.n}</strong></li>)}</ul></div>
        <div className="card"><h3>Verving</h3><dl className="dl"><dt>Invitasjoner sendt</dt><dd>{refs[0].sent}</dd><dt>Akseptert</dt><dd>{refs[0].accepted}</dd><dt>Kvalifiserte vervinger</dt><dd>{refs[0].qualified}</dd></dl></div>
      </div>
    </>
  );
}
