import Link from 'next/link';
import { q } from '@/lib/db';
import { nok } from '@/lib/format';
import { Flash, PropertyMedia } from '@/components/ui';
import { createPropertyAction } from '../../actions/properties';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Boliger' };

export default async function Properties({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const props = await q(`SELECT p.id, p.name, p.address, p.active, p.max_guests, p.cleaning_fee_ore,
      (SELECT count(*) FROM rooms r WHERE r.property_id=p.id AND r.active)::int AS rooms,
      (SELECT COALESCE(sum(sleeps),0) FROM beds b WHERE b.property_id=p.id AND b.active AND b.bed_type<>'cot')::int AS places,
      (SELECT count(*) FROM channel_connections c WHERE c.property_id=p.id AND c.active)::int AS channels,
      (SELECT ph.id FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=p.id ORDER BY ph.created_at LIMIT 1) AS photo_id
    FROM properties p ORDER BY p.active DESC, p.name`);
  return (
    <>
      <div className="page-head"><h1>Boliger</h1></div>
      <Flash sp={sp} />
      <div className="grid g3">
        {props.map(p => (
          <Link key={p.id} href={`/admin/boliger/${p.id}`} className="card" style={{ textDecoration: 'none', padding: 14, opacity: p.active ? 1 : .55 }}>
            <PropertyMedia photoId={p.photo_id} alt={p.name} />
            <div style={{ padding: '12px 6px 4px' }}><h3 style={{ marginBottom: 4 }}>{p.name}</h3><small className="muted">{p.address}</small><br />
              <small>{p.rooms} rom · {p.places} soveplasser · maks {p.max_guests} · {p.channels} kanaler · vask {nok(p.cleaning_fee_ore)}</small>{!p.active && <><br /><span className="badge">Inaktiv</span></>}</div>
          </Link>
        ))}
        <div className="card flat" style={{ borderStyle: 'dashed' }}>
          <h3>Ny bolig</h3>
          <form action={createPropertyAction}>
            <div className="field"><label>Navn</label><input name="name" required /></div>
            <div className="field"><label>Adresse</label><input name="address" /></div>
            <div className="field"><label>Maks gjester</label><input name="max_guests" type="number" min={1} defaultValue={4} /></div>
            <button className="btn">Opprett</button>
          </form>
        </div>
      </div>
    </>
  );
}
