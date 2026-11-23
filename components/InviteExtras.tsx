import type { Presentation } from '@/lib/domain/presentations';

type L = { attach: string; noAttach: string; attachHelp: string; preview: string; language: string };
const fmtSize = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(b / 1024)} KB`;

/** Extra fields on the invitation form: which PDF presentation to attach, and the language of the invitation. */
export function InviteExtras({ presentations, labels, lang }: { presentations: Presentation[]; labels: L; lang: 'no' | 'en' }) {
  const def = presentations.find(p => p.is_default);
  return (
    <>
      {presentations.length > 0 && (
        <div className="field">
          <label htmlFor="presentationId">{labels.attach}</label>
          <select id="presentationId" name="presentationId" defaultValue={def?.id ?? 'none'}>
            {presentations.map(p => <option key={p.id} value={p.id}>{p.title}{p.property_name ? ` – ${p.property_name}` : ''} ({fmtSize(p.size_bytes)})</option>)}
            <option value="none">{labels.noAttach}</option>
          </select>
          <small className="muted">{labels.attachHelp} {presentations.map((p, i) => <span key={p.id}>{i > 0 ? ' · ' : ''}<a href={`/api/presentasjoner/${p.id}`} target="_blank" rel="noopener">{labels.preview}{presentations.length > 1 ? ` «${p.title}»` : ''}</a></span>)}</small>
        </div>
      )}
      <div className="field">
        <label htmlFor="inviteLang">{labels.language}</label>
        <select id="inviteLang" name="lang" defaultValue={lang}><option value="no">Norsk</option><option value="en">English</option></select>
      </div>
    </>
  );
}
