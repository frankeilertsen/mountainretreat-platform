import { q } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { getStr } from '@/lib/settings';
import { Flash, Empty } from '@/components/ui';
import { inquiryStatusAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forespørsler fast leie' };
const ST: Record<string, [string, string]> = { new: ['Ny', 'b-warn'], contacted: ['Kontaktet', 'b-info'], closed: ['Avsluttet', ''] };

export default async function Inquiries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const to = await getStr('long_term_contact_email', '');
  const rows = await q(`SELECT i.*, to_char(i.move_in_date,'YYYY-MM-DD') AS move_in, p.name AS property FROM long_term_inquiries i LEFT JOIN properties p ON p.id=i.property_id ORDER BY (i.status='new') DESC, i.created_at DESC LIMIT 200`);
  return (
    <>
      <div className="page-head"><span className="eyebrow">Fra forsiden</span><h1>Forespørsler om fast leie</h1>
        <p className="muted">Hver forespørsel sendes på e-post til <strong>{to}</strong> (svar går direkte til avsender). Adressen endres under Innstillinger.</p></div>
      <Flash sp={sp} />
      {rows.length === 0 ? <div className="card"><Empty>Ingen forespørsler ennå.</Empty></div> : rows.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: 16 }}>
          <div className="row between"><div><h3 style={{ margin: 0 }}>{r.name}</h3><small className="muted">{fmtDateTime(r.created_at)}</small></div><span className={`badge ${ST[r.status][1]}`}>{ST[r.status][0]}</span></div>
          <dl className="dl" style={{ marginTop: 14 }}>
            <dt>E-post</dt><dd><a href={`mailto:${r.email}?subject=${encodeURIComponent('Fast leie – Mountain Retreat')}`}>{r.email}</a></dd>
            <dt>Telefon</dt><dd>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '–'}</dd>
            <dt>Bolig</dt><dd>{r.property ?? 'Uansett'}</dd>
            <dt>Innflytting</dt><dd>{r.move_in ? fmtDate(r.move_in) : '–'}</dd>
            <dt>Varighet</dt><dd>{r.duration ?? '–'}</dd>
            <dt>Personer</dt><dd>{r.persons ?? '–'}</dd>
          </dl>
          <p style={{ marginTop: 14, whiteSpace: 'pre-wrap' }}>{r.message}</p>
          <form action={inquiryStatusAction} className="row"><input type="hidden" name="id" value={r.id} />
            {r.status !== 'contacted' && <button className="btn ghost small" name="status" value="contacted">Marker kontaktet</button>}
            {r.status !== 'closed' && <button className="btn ghost small" name="status" value="closed">Avslutt</button>}
            {r.status !== 'new' && <button className="btn ghost small" name="status" value="new">Merk som ny</button>}</form>
        </div>
      ))}
    </>
  );
}
