import { requireUser } from '@/lib/auth/current';
import { can } from '@/lib/auth/rbac';
import { q } from '@/lib/db';
import { backupSummary } from '@/lib/backup';
import { storageBackend } from '@/lib/storage';
import { fmtDateTime } from '@/lib/format';
import { RestoreFilesForm } from '@/components/forms/RestoreFiles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sikkerhetskopi' };
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

export default async function Backup() {
  const u = await requireUser('admin');
  const allowed = can(u as any, 'manage_admins');
  const sum = await backupSummary();
  const last = await q<{ created_at: string; name: string | null; action: string }>(
    `SELECT a.created_at, u.name, a.action FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.action LIKE 'backup.%' ORDER BY a.created_at DESC LIMIT 5`);
  const lastDownload = last.find(l => l.action === 'backup.downloaded');
  const daysSince = lastDownload ? Math.floor((Date.now() - new Date(lastDownload.created_at).getTime()) / 86400000) : null;
  return (
    <>
      <div className="page-head"><span className="eyebrow">Drift</span><h1>Sikkerhetskopi</h1>
        <p className="muted" style={{ maxWidth: '72ch' }}>Dataene er sikret i tre lag. De to første skjer automatisk hos Render. Det tredje er en kopi du selv laster ned og lagrer et annet sted, for eksempel i OneDrive eller på en minnepinne, slik at du har alt selv om noe skulle skje med Render-kontoen.</p></div>
      <div className="grid g3">
        <div className="card kpi-card"><span className="kpi-label">1 · Database</span><div className="kpi" style={{ fontSize: '1.4rem' }}>Automatisk</div><small>Render tar fortløpende backup av databasen og kan gjenopprette til et valgfritt tidspunkt de siste 3 dagene (7 dager med Pro-workspace). Render → databasen → <strong>Recovery</strong>.</small></div>
        <div className="card kpi-card"><span className="kpi-label">2 · Bilder og PDF-er</span><div className="kpi" style={{ fontSize: '1.4rem' }}>Automatisk</div><small>{storageBackend() === 'supabase' ? 'Lagret i Supabase Storage.' : 'Lagret på disken til nettsiden. Render tar øyeblikksbilder av disken: Render → nettsiden → Disks → Snapshots.'}</small></div>
        <div className="card kpi-card"><span className="kpi-label">3 · Din egen kopi</span><div className="kpi" style={{ fontSize: '1.4rem', color: daysSince === null || daysSince > 35 ? 'var(--warn, #d9a441)' : 'var(--gold-2)' }}>{daysSince === null ? 'Aldri' : daysSince === 0 ? 'I dag' : `${daysSince} d siden`}</div><small>Anbefalt: last ned én gang i måneden. Nå: {sum.files} filer ({mb(sum.bytes)}) + hele databasen.</small></div>
      </div>
      {!allowed ? <div className="note" style={{ marginTop: 24 }}>Kun hovedadministrator kan laste ned og legge tilbake sikkerhetskopier, fordi kopien inneholder alle persondata.</div> : (
        <div className="grid split-1-2" style={{ marginTop: 24, alignItems: 'start' }}>
          <div className="card">
            <h3>Last ned sikkerhetskopi</h3>
            <p className="muted">Én fil (.tar.gz) med alle bilder og PDF-er og en kopi av alle tabellene i databasen. Den inneholder persondata, så lagre den trygt og slett gamle kopier etter hvert. Nedlastingen logges.</p>
            <a className="btn" href="/api/admin/backup">Last ned nå</a>
          </div>
          <div className="card">
            <h3>Legg tilbake filer</h3>
            <p className="muted">Mangler bilder eller PDF-er (for eksempel etter at disken er byttet), kan du laste opp en sikkerhetskopi her. Bare filer som mangler, og som databasen kjenner til, legges tilbake. Ingenting overskrives. Databasen gjenopprettes i Render (lag 1).</p>
            <RestoreFilesForm />
          </div>
        </div>
      )}
      {last.length > 0 && <div className="card flat" style={{ marginTop: 24 }}><h3>Siste hendelser</h3><ul className="muted" style={{ margin: 0 }}>{last.map((l, i) => <li key={i}>{fmtDateTime(l.created_at)} · {l.action === 'backup.downloaded' ? 'lastet ned' : 'filer lagt tilbake'} av {l.name ?? 'ukjent'}</li>)}</ul></div>}
    </>
  );
}
