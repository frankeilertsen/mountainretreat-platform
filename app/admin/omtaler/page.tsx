import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { Flash } from '@/components/ui';
import { Stars } from '@/components/forms/StarInput';
import { reviewStats, CATEGORIES } from '@/lib/domain/reviews';
import { addAirbnbReviewAction, updateReviewAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Omtaler' };
const CAT: Record<string, string> = { cleanliness: 'Renhold', accuracy: 'Som beskrevet', checkin: 'Innsjekk', communication: 'Kommunikasjon', location: 'Beliggenhet', value: 'Verdi' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const month = (m: string | null) => m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '';

export default async function Reviews({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser('admin');
  const sp = await searchParams;
  const filter = ['retreat_club', 'airbnb', 'featured', 'low'].includes(sp.vis) ? sp.vis : 'alle';
  const where = filter === 'retreat_club' ? `r.source='retreat_club'` : filter === 'airbnb' ? `r.source='airbnb'` : filter === 'featured' ? 'r.featured' : filter === 'low' ? 'r.rating <= 3' : 'true';
  const reviews = await q<any>(`SELECT r.*, to_char(r.stay_month,'YYYY-MM') AS month, u.name AS member, b.reference, b.id AS bid, p.name AS property
    FROM reviews r LEFT JOIN users u ON u.id=r.member_id LEFT JOIN bookings b ON b.id=r.booking_id LEFT JOIN properties p ON p.id=r.property_id
    WHERE ${where} ORDER BY r.featured DESC, r.featured_order, r.created_at DESC LIMIT 200`);
  const s = await reviewStats();
  const cats = await q<{ k: string; avg: string }>(`SELECT k, round(avg(v)::numeric, 1)::text AS avg FROM reviews, LATERAL (VALUES
      ('cleanliness', rating_cleanliness), ('accuracy', rating_accuracy), ('checkin', rating_checkin), ('communication', rating_communication), ('location', rating_location), ('value', rating_value)) x(k, v)
    WHERE source='retreat_club' AND status='published' AND v IS NOT NULL GROUP BY k`);
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties ORDER BY name`);
  const tabs: [string, string][] = [['alle', 'Alle'], ['retreat_club', 'Retreat Club'], ['airbnb', 'Airbnb'], ['featured', 'På forsiden'], ['low', '3 stjerner eller lavere']];
  return (
    <>
      <div className="page-head"><div><span className="eyebrow">Medlemmer</span><h1>Omtaler</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>Medlemmene får spørsmål om omtale på e-post to dager etter utsjekk (og én påminnelse en uke senere). Velg hvilke omtaler som skal vises på forsiden – fra Retreat Club (bare de som har samtykket) og Airbnb.</p></div></div>
      <Flash sp={sp} />
      <div className="grid g4" style={{ marginBottom: 20 }}>
        <div className="card kpi-card"><span className="kpi-label">Snitt (alle)</span><div className="kpi">{s?.avg ? s.avg.replace('.', ',') : '–'}</div><small>{s?.n ?? 0} omtaler</small></div>
        <div className="card kpi-card"><span className="kpi-label">Retreat Club</span><div className="kpi">{s?.rc_avg ? s.rc_avg.replace('.', ',') : '–'}</div><small>{s?.rc ?? 0} omtaler</small></div>
        <div className="card kpi-card"><span className="kpi-label">Fra Airbnb</span><div className="kpi">{s?.airbnb ?? 0}</div><small>lagt inn</small></div>
        <div className="card kpi-card"><span className="kpi-label">På forsiden</span><div className="kpi">{s?.featured ?? 0}</div><small>vises maks 6</small></div>
      </div>
      {cats.length > 0 && <div className="card flat" style={{ marginBottom: 20 }}><small className="muted">Snitt per kategori (Retreat Club):</small> {CATEGORIES.map(c => { const a = cats.find(x => x.k === c); return a ? <span key={c} style={{ marginRight: 16 }}>{CAT[c]} <strong>{a.avg.replace('.', ',')}</strong></span> : null; })}</div>}
      <div className="grid split-2-1" style={{ alignItems: 'start' }}>
        <div>
          <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>{tabs.map(([k, l]) => <Link key={k} href={`/admin/omtaler${k === 'alle' ? '' : `?vis=${k}`}`} className={`btn small ${filter === k ? '' : 'ghost'}`}>{l}</Link>)}</div>
          {reviews.length === 0 && <div className="card"><p className="muted">Ingen omtaler her ennå.</p></div>}
          <div className="stack">{reviews.map(r => {
            const canFeature = r.status === 'published' && !!r.public_text && (r.source === 'airbnb' || r.consent_publish);
            return (
              <div key={r.id} className="card" style={r.status === 'hidden' ? { opacity: .55 } : r.featured ? { borderColor: 'var(--gold)' } : undefined}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div><Stars n={r.rating} size="1.15rem" /> <span className="badge">{r.source === 'airbnb' ? 'Airbnb' : 'Retreat Club'}</span> {r.featured && <span className="badge b-ok">På forsiden</span>} {r.status === 'hidden' && <span className="badge">Skjult</span>}
                    <div style={{ marginTop: 4 }}><strong>{r.author_name}</strong>{r.member && r.member !== r.author_name ? <small className="muted"> ({r.member})</small> : null} <small className="muted">· {month(r.month) || fmtDate(r.created_at)}{r.property ? ` · ${r.property}` : ''}{r.reference ? <> · <Link href={`/admin/bookinger/${r.bid}`}>{r.reference}</Link></> : null}</small></div></div>
                </div>
                {r.public_text ? <p className="review-quote">«{r.public_text}»</p> : <p className="muted">(ingen offentlig tekst)</p>}
                {r.private_feedback && <div className="note" style={{ marginBottom: 10 }}><small className="muted">Til dere (ikke offentlig):</small><br />{r.private_feedback}</div>}
                {r.source === 'retreat_club' && <small className="muted">{CATEGORIES.filter(c => r[`rating_${c}`]).map(c => `${CAT[c]} ${r[`rating_${c}`]}`).join(' · ')}{!r.consent_publish ? ' · Ikke samtykke til visning på nettsiden' : ''}</small>}
                <details style={{ marginTop: 10 }}><summary className="muted">Rediger</summary>
                  <form action={updateReviewAction} style={{ marginTop: 10 }}><input type="hidden" name="id" value={r.id} />
                    <div className="fields"><div><label>Navn som vises</label><input name="author_name" defaultValue={r.author_name} /></div><div><label>Rekkefølge på forsiden</label><input name="featured_order" type="number" defaultValue={r.featured_order} /></div></div>
                    <div className="field"><label>Svar fra oss (vises under omtalen)</label><textarea name="host_reply" rows={2} defaultValue={r.host_reply ?? ''} /></div>
                    <button className="btn small">Lagre</button></form>
                </details>
                <div className="row" style={{ marginTop: 10 }}>
                  {canFeature && <form action={updateReviewAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="featured" value={r.featured ? '0' : '1'} /><button className={`btn small ${r.featured ? 'ghost' : ''}`}>{r.featured ? 'Fjern fra forsiden' : 'Vis på forsiden'}</button></form>}
                  <form action={updateReviewAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={r.status === 'hidden' ? 'published' : 'hidden'} /><input type="hidden" name="featured" value="0" /><button className="btn ghost small">{r.status === 'hidden' ? 'Vis igjen' : 'Skjul'}</button></form>
                </div>
              </div>
            );
          })}</div>
        </div>
        <div className="card">
          <h3>Legg til omtale fra Airbnb</h3>
          <p className="muted" style={{ fontSize: '.88rem' }}>Airbnb har ikke en åpen kobling for omtaler, så kopier dem inn her fra Airbnb (Meny → Omtaler).</p>
          <form action={addAirbnbReviewAction}>
            <div className="field"><label>Navn (som på Airbnb)</label><input name="author_name" required maxLength={80} /></div>
            <div className="fields"><div><label>Stjerner</label><select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}</select></div><div><label>Måned for oppholdet</label><input name="stay_month" type="month" /></div></div>
            {props.length > 1 && <div className="field"><label>Bolig</label><select name="property_id">{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
            {props.length === 1 && <input type="hidden" name="property_id" value={props[0].id} />}
            <div className="field"><label>Språk</label><select name="lang" defaultValue="no"><option value="no">Norsk</option><option value="en">Engelsk</option></select></div>
            <div className="field"><label>Teksten fra Airbnb</label><textarea name="public_text" rows={6} required /></div>
            <label className="check field"><input type="checkbox" name="featured" value="1" /> <span>Vis på forsiden med en gang</span></label>
            <button className="btn block">Legg til</button>
          </form>
        </div>
      </div>
    </>
  );
}
