'use client';
import { useState } from 'react';

/** Upload a backup archive and put missing photos/PDFs back. */
export function RestoreFilesForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem('archive') as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/backup/restore', { method: 'POST', body: file, headers: { 'Content-Type': 'application/gzip' } });
      const j = await r.json();
      setMsg(r.ok ? { ok: true, text: `Ferdig: ${j.restored} filer lagt tilbake, ${j.alreadyThere} fantes fra før, ${j.skipped} hoppet over.` } : { ok: false, text: j.error ?? 'Noe gikk galt.' });
    } catch { setMsg({ ok: false, text: 'Opplastingen feilet. Prøv igjen.' }); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="field"><label htmlFor="archive">Sikkerhetskopi (.tar.gz)</label><input id="archive" name="archive" type="file" accept=".gz,.tgz,application/gzip" required /></div>
      {msg && <div className={`flash ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</div>}
      <button className="btn secondary" disabled={busy}>{busy ? 'Legger tilbake …' : 'Legg tilbake manglende filer'}</button>
    </form>
  );
}
