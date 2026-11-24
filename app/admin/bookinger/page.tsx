import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDate, nok } from '@/lib/format';
import { Flash, Status, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bookinger' };
const FILTERS: [string, string][] = [['aktive', 'Aktive'], ['pending_review', 'Venter godkjenning'], ['awaiting_payment', 'Venter betaling'], ['confirmed', 'Bekreftet'], ['completed', 'Fullført'], ['avsluttet', 'Avslått/kansellert'], ['eksterne', 'Eksterne'], ['alle', 'Alle']];

export default async function AdminBookings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const f = sp.status ?? 'aktive';
  const search = (sp.q ?? '').trim();
  if (f === 'eksterne') {
    const ext = await q(`SELECT e.id, to_char(e.start_date,'YYYY-MM-DD') AS start, to_char(e.end_date,'YYYY-MM-DD') AS "end", e.sync_state, e.block_kind, e.raw_summary, cc.display_name, p.name AS property
      FROM external_calendar_events e JOIN channel_connections cc ON cc.id=e.connection_id JOIN properties p ON p.id=e.property_id WHERE e.sync_state <> 'removed' AND e.end_date >= current_date - 30 ORDER BY e.start_date`);
    return (<><Head f={f} search={search} sp={sp} />
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Kanal</th><th>Bolig</th><th>Datoer</th><th>Type</th><th>Status</th></tr></thead><tbody>
        {ext.map(e => <tr key={e.id}><td>{e.display_name}</td><td>{e.property}</td><td>{fmtDate(e.start)} – {fmtDate(e.end)}</td><td><small>{({ reservation: 'Booking', owner_block: 'Stengt (ingen vask)', unknown: 'Ukjent (behandles som booking)' } as Record<string, string>)[e.block_kind] ?? e.block_kind} · {e.raw_summary}</small></td><td><Status s={e.sync_state === 'active' ? 'success' : e.sync_state} /></td></tr>)}
      </tbody></table></div>{ext.length === 0 && <Empty>Ingen eksterne bookinger.</Empty>}</div></>);
  }
  const where = f === 'aktive' ? `b.status IN ('pending_review','awaiting_payment','confirmed','cancellation_requested')` : f === 'avsluttet' ? `b.status IN ('rejected','cancelled','expired')` : f === 'alle' ? 'true' : `b.status = $2`;
  const params: unknown[] = [search ? `%${search}%` : null];
  if (!['aktive', 'avsluttet', 'alle'].includes(f)) params.push(f);
  const rows = await q(`SELECT b.id, b.reference, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.price_total_ore, b.adults+b.children AS guests, u.name AS member, p.name AS property
    FROM bookings b JOIN users u ON u.id=b.member_id JOIN properties p ON p.id=b.property_id
    WHERE ${where} AND ($1::text IS NULL OR u.name ILIKE $1 OR b.reference ILIKE $1 OR u.email ILIKE $1) ORDER BY b.start_date ${f === 'aktive' ? 'ASC' : 'DESC'} LIMIT 300`, params);
  return (
    <>
      <Head f={f} search={search} sp={sp} />
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Ref.</th><th>Medlem</th><th>Bolig</th><th>Datoer</th><th>Gjester</th><th>Beløp</th><th>Status</th></tr></thead><tbody>
        {rows.map(b => <tr key={b.id}><td><Link href={`/admin/bookinger/${b.id}`}>{b.reference}</Link></td><td>{b.member}</td><td>{b.property}</td><td>{fmtDate(b.start)} – {fmtDate(b.end)}</td><td>{b.guests}</td><td>{nok(b.price_total_ore)}</td><td><Status s={b.status} /></td></tr>)}
      </tbody></table></div>{rows.length === 0 && <Empty>Ingen bookinger.</Empty>}</div>
    </>
  );
}
function Head({ f, search, sp }: { f: string; search: string; sp: Record<string, string> }) {
  return (<>
    <div className="page-head row between"><h1>Bookinger</h1>
      <form className="row" method="get"><input type="hidden" name="status" value={f} /><input name="q" defaultValue={search} placeholder="Søk navn, e-post, ref." style={{ width: 240 }} /></form></div>
    <Flash sp={sp} />
    <div className="nav" style={{ marginBottom: 20 }}>{FILTERS.map(([k, l]) => <Link key={k} href={`/admin/bookinger?status=${k}`} className={k === f ? 'active' : ''}>{l}</Link>)}</div>
  </>);
}
