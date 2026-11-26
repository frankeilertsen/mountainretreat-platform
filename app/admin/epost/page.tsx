import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Flash } from '@/components/ui';
import { newMailingAction } from '../../actions/mailings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'E-post til medlemmer' };

export default async function Mailings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser('admin');
  const sp = await searchParams;
  const rows = await q<any>(`SELECT m.id, m.subject, m.kind, m.status, m.recipient_count, m.sent_at, m.updated_at,
      (SELECT count(*) FROM notifications n WHERE n.type='mailing' AND n.payload->>'mailingId' = m.id::text AND n.status='failed')::int AS failed
    FROM mailings m ORDER BY (m.status='draft') DESC, COALESCE(m.sent_at, m.updated_at) DESC LIMIT 200`);
  return (
    <>
      <div className="page-head"><div><span className="eyebrow">Medlemmer</span><h1>E-post til medlemmer</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>Send nyheter, tilbud eller viktig informasjon – med bilder og vedlegg – til alle medlemmer, utvalgte medlemmer eller hele invitasjonsledd.</p></div>
        <form action={newMailingAction}><button className="btn">+ Ny e-post</button></form></div>
      <Flash sp={sp} />
      <div className="card">
        {rows.length === 0 ? <p className="muted">Ingen utsendelser ennå. Trykk «Ny e-post» for å lage den første.</p> : (
          <div className="table-wrap"><table><thead><tr><th>Emne</th><th>Type</th><th>Status</th><th>Mottakere</th><th></th></tr></thead><tbody>
            {rows.map(r => <tr key={r.id}>
              <td><Link href={`/admin/epost/${r.id}`}>{r.subject || <span className="muted">(uten emne)</span>}</Link></td>
              <td><small>{r.kind === 'news' ? 'Nyhet / tilbud' : 'Viktig informasjon'}</small></td>
              <td>{r.status === 'sent' ? <span className="badge b-ok">Sendt {fmtDateTime(r.sent_at)}</span> : <span className="badge">Utkast</span>}</td>
              <td>{r.recipient_count ?? '–'}{r.failed ? <small style={{ color: 'var(--danger)' }}> · {r.failed} feilet</small> : null}</td>
              <td><Link href={`/admin/epost/${r.id}`} className="btn ghost small">{r.status === 'sent' ? 'Vis' : 'Rediger'}</Link></td>
            </tr>)}
          </tbody></table></div>)}
      </div>
    </>
  );
}
