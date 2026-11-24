import { q } from '@/lib/db';
import { listPresentations } from '@/lib/domain/presentations';
import { fmtDate } from '@/lib/format';
import { Flash, Empty } from '@/components/ui';
import { updatePresentationAction } from '../../actions/presentations';
import { PresentationUploadForm } from '@/components/forms/PresentationUpload';
import { ValueButton } from '@/components/ValueButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Presentasjoner (PDF)' };
const size = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(b / 1024)} KB`;

export default async function Presentations({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const list = await listPresentations();
  const props = await q<{ id: string; name: string }>(`SELECT id, name FROM properties WHERE active ORDER BY name`);
  return (
    <>
      <div className="page-head"><span className="eyebrow">Medlemmer</span><h1>Presentasjoner (PDF)</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>Last opp en PDF med bilder, informasjon om boligen og medlemsfordelene. Den som sender en invitasjon kan legge den ved – den sendes som vedlegg i e-posten og kan åpnes fra invitasjonssiden. Innloggede medlemmer finner aktive presentasjoner under Medlemsfordeler. Standardpresentasjonen er forhåndsvalgt på invitasjonsskjemaet.</p></div>
      <Flash sp={sp} />
      <div className="grid split-1-2" style={{ alignItems: 'start' }}>
        <PresentationUploadForm>
          <h3>Last opp ny</h3>
          <div className="field"><label htmlFor="title">Tittel</label><input id="title" name="title" required maxLength={120} placeholder="F.eks. Velkommen til Mountain Retreat" /></div>
          <div className="field"><label htmlFor="file">PDF-fil (maks 20 MB)</label><input id="file" name="file" type="file" accept="application/pdf,.pdf" required /></div>
          <div className="field"><label htmlFor="propertyId">Gjelder bolig (valgfritt)</label><select id="propertyId" name="propertyId" defaultValue=""><option value="">Alle / generell</option>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <label className="check field"><input type="checkbox" name="makeDefault" defaultChecked={list.filter(p => p.active).length === 0} /> <span>Bruk som standard ved invitasjoner</span></label>
          <small className="muted" style={{ display: 'block', margin: '0 0 12px' }}>Tips: hold filen under 15 MB, så sendes den som vedlegg. Større filer sendes som lenke. Lag den f.eks. i Canva eller PowerPoint og eksporter som PDF.</small>
        </PresentationUploadForm>
        <div className="card">
          <h3>Presentasjoner</h3>
          {list.length === 0 ? <Empty>Ingen presentasjoner lastet opp ennå.</Empty> : (
            <table><thead><tr><th>Tittel</th><th>Fil</th><th>Brukt</th><th></th></tr></thead><tbody>
              {list.map(p => (
                <tr key={p.id} style={p.active ? undefined : { opacity: .55 }}>
                  <td>
                    <strong>{p.title}</strong>{p.is_default && <span className="badge b-ok" style={{ marginLeft: 8 }}>Standard</span>}{!p.active && <span className="badge" style={{ marginLeft: 8 }}>Skjult</span>}
                    <br /><small className="muted">{p.property_name ?? 'Generell'} · lastet opp {fmtDate(p.created_at)} av {p.uploaded_by}</small>
                  </td>
                  <td><a href={`/api/presentasjoner/${p.id}`} target="_blank" rel="noopener">{p.original_filename}</a><br /><small className="muted">{size(p.size_bytes)}{p.size_bytes > 15 * 1024 * 1024 ? ' · sendes som lenke' : ''}</small></td>
                  <td>{p.times_sent} invitasjon{p.times_sent === 1 ? '' : 'er'}</td>
                  <td>
                    <form action={updatePresentationAction} className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <input type="hidden" name="id" value={p.id} />
                      {p.active && !p.is_default && <ValueButton className="btn ghost small" name="op" value="default">Gjør til standard</ValueButton>}
                      {p.active ? <ValueButton className="btn ghost small" name="op" value="deactivate">Skjul</ValueButton> : <ValueButton className="btn ghost small" name="op" value="activate">Aktiver</ValueButton>}
                    </form>
                  </td>
                </tr>))}
            </tbody></table>)}
          <p className="muted" style={{ fontSize: '.82rem', marginTop: 12 }}>Skjulte presentasjoner kan ikke legges ved nye invitasjoner, men lenker i invitasjoner som allerede er sendt virker fortsatt så lenge invitasjonen er gyldig. Vil du bytte ut en presentasjon, last opp den nye som standard og skjul den gamle.</p>
        </div>
      </div>
    </>
  );
}
