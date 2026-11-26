import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Flash } from '@/components/ui';
import { getStr } from '@/lib/settings';
import { appUrl } from '@/lib/notify';
import { getMailing, invitationChains, mailingStats, renderMailingHtml, resolveRecipients, LIMITS } from '@/lib/domain/mailings';
import { deleteMailingAction, removeMailingFileAction, saveMailingAction } from '../../../actions/mailings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'E-post til medlemmer' };
const kb = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(n / 1024)} KB`;

export default async function MailingEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser('admin');
  const { id } = await params; const sp = await searchParams;
  const { mailing: m, images, attachments } = await getMailing(id);
  const sent = m.status === 'sent';
  const members = await q<{ id: string; name: string; email: string; consent: boolean; inviter: string | null }>(
    `SELECT u.id, u.name, u.email, u.marketing_consent AS consent, iu.name AS inviter FROM users u LEFT JOIN users iu ON iu.id=u.invited_by_user_id
     WHERE u.status='active' AND u.system_role IN ('member','admin','super_admin') ORDER BY u.name`);
  const chains = await invitationChains();
  const { recipients, withoutConsent } = await resolveRecipients(m.kind, m.audience);
  const stats = sent ? await mailingStats(id) : null;
  const company = await getStr('company_name', 'FKE Property AS');
  const preview = renderMailingHtml(m, m.subject || '(emne)', m.body || '(tekst)', images, attachments, { firstName: u.name.split(' ')[0], lang: 'no', unsubscribeUrl: m.kind === 'news' ? '#' : null, company });
  const sel = new Set(m.audience.userIds), lead = new Set(m.audience.leaderIds);
  const dis = sent || undefined;
  return (
    <>
      <div className="page-head"><div><span className="eyebrow"><Link href="/admin/epost">E-post til medlemmer</Link></span><h1>{m.subject || 'Ny e-post'}</h1>
        {sent && <p className="muted">Sendt {fmtDateTime(m.sent_at)} til {m.recipient_count} mottakere{stats ? ` · ${stats.sent} levert${stats.queued ? `, ${stats.queued} i kø` : ''}${stats.failed ? `, ${stats.failed} feilet` : ''}` : ''}.</p>}</div>
        {!sent && <form action={deleteMailingAction}><input type="hidden" name="id" value={id} /><button className="btn ghost small">Slett utkast</button></form>}</div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <form action={saveMailingAction} className="stack">
          <input type="hidden" name="id" value={id} />
          <div className="card">
            <h3>1. Innhold</h3>
            <div className="field"><label>Type</label>
              <select name="kind" defaultValue={m.kind} disabled={dis}><option value="news">Nyhet / tilbud – bare til medlemmer som har sagt ja til nyheter</option><option value="info">Viktig informasjon – til alle valgte medlemmer</option></select>
              <small className="muted">Nyheter og tilbud er markedsføring og får automatisk en «Meld deg av»-lenke. Bruk «Viktig informasjon» bare for nødvendig informasjon om medlemskapet eller oppholdene.</small></div>
            <div className="field"><label>Emne</label><input name="subject" defaultValue={m.subject} maxLength={200} required disabled={dis} placeholder="F.eks. Lanseringstilbud i desember" /></div>
            <div className="field"><label>Tekst</label><textarea name="body" rows={12} defaultValue={m.body} disabled={dis} placeholder={'Hei {navn}!\n\nVi har gleden av å …\n\n[bilde 1]\n\n[knapp: Book nå | https://mountainretreat.no/medlem]'} />
              <small className="muted">Tom linje = nytt avsnitt · **fet tekst** · lenker blir klikkbare · linjer som starter med «- » blir punktliste · <code>{'{navn}'}</code> = medlemmets fornavn · <code>[bilde 2]</code> plasserer bilde 2 · <code>[knapp: Tekst | https://…]</code> lager en knapp. Bilder som ikke er plassert, vises etter teksten.</small></div>
            <details><summary className="muted">Engelsk versjon (valgfri – sendes til medlemmer som bruker engelsk)</summary>
              <div className="field" style={{ marginTop: 10 }}><label>Emne (engelsk)</label><input name="subject_en" defaultValue={m.subject_en ?? ''} maxLength={200} disabled={dis} /></div>
              <div className="field"><label>Tekst (engelsk)</label><textarea name="body_en" rows={8} defaultValue={m.body_en ?? ''} disabled={dis} /></div>
            </details>
          </div>

          <div className="card">
            <h3>2. Bilder og vedlegg</h3>
            {images.length > 0 && <div className="mail-thumbs">{images.map((f, i) => <div key={f.id} className="mail-thumb">
              <img src={`/api/epost/bilde/${f.public_token}`} alt="" /><small>[bilde {i + 1}] · {kb(f.size_bytes)}</small>
              {!sent && <button formAction={removeMailingFileAction} name="fileId" value={f.id} className="btn ghost small" formNoValidate>Fjern</button>}</div>)}</div>}
            {attachments.length > 0 && <ul className="list">{attachments.map(f => <li key={f.id} className="row between"><span>📎 {f.filename} <small className="muted">{kb(f.size_bytes)}</small></span>
              {!sent && <button formAction={removeMailingFileAction} name="fileId" value={f.id} className="btn ghost small" formNoValidate>Fjern</button>}</li>)}</ul>}
            {!sent && <>
              <div className="field"><label>Legg til bilder (JPG, PNG, WEBP, GIF – maks {LIMITS.imageBytes / 1024 / 1024} MB per bilde, maks {LIMITS.images} bilder)</label><input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/gif" multiple /></div>
              <div className="field"><label>Legg til vedlegg (f.eks. PDF – maks 10 MB per fil, 20 MB til sammen)</label><input type="file" name="attachments" multiple /></div>
              <small className="muted">Filene lastes opp når du trykker «Lagre».</small></>}
          </div>

          <div className="card">
            <h3>3. Mottakere</h3>
            <label className="check"><input type="radio" name="mode" value="all" defaultChecked={m.audience.mode === 'all'} disabled={dis} /> <span>Alle aktive medlemmer</span></label>
            <label className="check"><input type="radio" name="mode" value="selected" defaultChecked={m.audience.mode === 'selected'} disabled={dis} /> <span>Utvalgte medlemmer og/eller invitasjonsledd</span></label>
            <details open={m.audience.mode === 'selected'} style={{ marginTop: 10 }}><summary className="muted">Velg medlemmer ({sel.size} valgt)</summary>
              <div className="pick-list">{members.map(p => <label key={p.id} className="check"><input type="checkbox" name="userIds" value={p.id} defaultChecked={sel.has(p.id)} disabled={dis} />
                <span>{p.name} <small className="muted">{p.email}{!p.consent ? ' · ikke ja til nyheter' : ''}</small></span></label>)}</div></details>
            <details open={lead.size > 0} style={{ marginTop: 10 }}><summary className="muted">Velg hele invitasjonsledd ({lead.size} valgt)</summary>
              <p className="muted" style={{ fontSize: '.85rem', margin: '8px 0' }}>Et invitasjonsledd er medlemmet selv og alle som er invitert av det medlemmet – og videre nedover i alle ledd.</p>
              {chains.length === 0 ? <p className="muted">Ingen medlemmer har invitert noen ennå.</p>
                : <div className="pick-list">{chains.map(c => <label key={c.id} className="check"><input type="checkbox" name="leaderIds" value={c.id} defaultChecked={lead.has(c.id)} disabled={dis} />
                  <span>{c.name} <small className="muted">+ {c.total} invitert ({c.direct} direkte)</small></span></label>)}</div>}</details>
            <div className="note" style={{ marginTop: 12 }}><strong>{recipients.length} mottaker{recipients.length === 1 ? '' : 'e'}</strong> med lagrede valg{withoutConsent.length ? ` · ${withoutConsent.length} valgt${withoutConsent.length === 1 ? '' : 'e'} medlem${withoutConsent.length === 1 ? '' : 'mer'} har ikke sagt ja til nyheter og får den ikke` : ''}.
              {recipients.length > 0 && recipients.length <= 30 && <><br /><small className="muted">{recipients.map(r => r.name).join(', ')}</small></>}</div>
          </div>

          {!sent && <div className="card">
            <h3>4. Lagre, test og send</h3>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button name="intent" value="save" className="btn secondary">Lagre</button>
              <button name="intent" value="test" className="btn secondary">Lagre og send test til meg</button>
            </div>
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
              <label className="check"><input type="checkbox" name="confirm" value="ja" /> <span>Jeg har sjekket teksten og mottakerne</span></label>
              <button name="intent" value="send" className="btn" style={{ marginTop: 8 }}>Send nå</button>
              <small className="muted" style={{ display: 'block', marginTop: 6 }}>Mottakerne regnes ut på nytt når du sender. En sendt e-post kan ikke endres eller trekkes tilbake.</small>
            </div>
          </div>}
        </form>

        <div className="card mail-preview-card" style={{ position: 'sticky', top: 16 }}>
          <h3>Forhåndsvisning</h3>
          <p className="muted" style={{ fontSize: '.82rem' }}>Slik ser e-posten ut (med ditt fornavn). Lagre for å oppdatere.</p>
          <div className="mail-preview" dangerouslySetInnerHTML={{ __html: preview.split(appUrl('')).join('') }} />
        </div>
      </div>
    </>
  );
}
