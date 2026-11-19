import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Revisjonslogg' };

export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filter = (sp.q ?? '').trim();
  const rows = await q(`SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE ($1::text IS NULL OR a.action ILIKE $1 OR a.entity_type ILIKE $1 OR u.name ILIKE $1) ORDER BY a.created_at DESC LIMIT 300`, [filter ? `%${filter}%` : null]);
  return (
    <>
      <div className="page-head row between"><h1>Revisjonslogg</h1><form><input name="q" defaultValue={filter} placeholder="Filtrer: booking, payment, Kari …" style={{ width: 280 }} /></form></div>
      <p className="muted">Kun lesetilgang. Loggen kan ikke endres eller slettes (håndheves i databasen).</p>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Tid</th><th>Hvem</th><th>Handling</th><th>Objekt</th><th>Detaljer</th></tr></thead><tbody>
        {rows.map(r => (
          <tr key={r.id}><td><small>{fmtDateTime(r.created_at)}</small></td><td>{r.name ?? r.actor_type}{r.ip_address && <><br /><small className="muted">{r.ip_address}</small></>}</td><td><code>{r.action}</code></td>
            <td><small>{r.entity_type === 'booking' && r.entity_id ? <Link href={`/admin/bookinger/${r.entity_id}`}>{r.entity_type}</Link> : r.entity_type}</small></td>
            <td>{(r.before_state || r.after_state) && <details><summary><small>vis</small></summary><pre style={{ fontSize: '.72rem', whiteSpace: 'pre-wrap', maxWidth: 420 }}>{JSON.stringify({ før: r.before_state, etter: r.after_state }, null, 1)}</pre></details>}</td></tr>))}
      </tbody></table></div></div>
    </>
  );
}
