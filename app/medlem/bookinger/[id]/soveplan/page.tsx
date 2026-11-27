import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { memberPlanContext } from '@/lib/domain/sleepingPlan';
import { fmtDate } from '@/lib/format';
import { Flash } from '@/components/ui';
import { getLang } from '@/lib/i18n/lang';
import { saveSleepPlanAction, resetSleepPlanAction } from '../../../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hvem sover hvor?' };

const BED: Record<string, [string, string]> = {
  double: ['Dobbeltseng', 'Double bed'], single: ['Enkeltseng', 'Single bed'], bunk_lower: ['Køyeseng (nedre)', 'Bunk bed (lower)'], bunk_upper: ['Køyeseng (øvre)', 'Bunk bed (upper)'],
  sofa_bed: ['Sovesofa', 'Sofa bed'], extra_mattress: ['Ekstra madrass', 'Extra mattress'], cot: ['Barneseng', 'Cot'],
};

export default async function SleepingPlan({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser('request_booking');
  const { id } = await params; const sp = await searchParams;
  const lang = await getLang(); const en = lang === 'en';
  const { booking: b, plan, open, lockDate, ownLinen, guests } = await memberPlanContext(id, u.id);
  const all = ownLinen > 0 && guests > 0;
  const chosen = plan.source === 'member';
  return (
    <div className="narrow">
      <Link href={`/medlem/bookinger/${id}`} className="muted">← {en ? 'Back to the booking' : 'Tilbake til bookingen'}</Link>
      <h1 style={{ marginTop: 10 }}>{en ? 'Who sleeps where?' : 'Hvem sover hvor?'}</h1>
      <p className="muted">{fmtDate(b.start_date)} – {fmtDate(b.end_date)} · {b.adults} {en ? 'adults' : 'voksne'}{b.children ? `, ${b.children} ${en ? 'children' : 'barn'}` : ''}{b.infants ? `, ${b.infants} ${en ? 'infants' : 'spedbarn'}` : ''}</p>
      <Flash sp={sp} lang={lang} />
      <div className="card flat" style={{ marginBottom: 16 }}>
        <p style={{ margin: 0 }}>{en ? 'Tell us how you want to sleep, and the cleaner makes up the beds exactly like that. This is optional – if you skip it, we make up the beds based on the number of guests.' : 'Fortell oss hvordan dere vil sove, så reer renholderen opp akkurat slik. Dette er valgfritt – hopper du over, reer vi opp etter antall gjester.'}</p>
        {all && <p style={{ margin: '10px 0 0' }}>{en ? 'Everyone brings their own bed linen, so the beds will not be made up.' : 'Alle tar med eget sengetøy, så sengene blir ikke redd opp.'}</p>}
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '.85rem' }}>{open ? (en ? `You can change this until ${fmtDate(lockDate)}.` : `Du kan endre dette til og med ${fmtDate(lockDate)}.`) : plan.source === 'admin_override' ? (en ? 'The host has set up the beds for this stay. Contact us if something should be changed.' : 'Vertskapet har satt opp sengene for dette oppholdet. Ta kontakt hvis noe bør endres.') : (en ? 'The sleeping plan can no longer be changed. Contact us if something should be changed.' : 'Soveplanen kan ikke endres lenger. Ta kontakt hvis noe bør endres.')}</p>
      </div>
      <form action={saveSleepPlanAction}>
        <input type="hidden" name="id" value={id} />
        <div className="stack">
          {plan.rooms.filter(r => r.beds.length).map(r => (
            <div key={r.id} className="card sleep-room">
              {r.photo_id && <img src={`/api/photos/${r.photo_id}`} alt={r.name} loading="lazy" />}
              <div>
                <h3 style={{ margin: '0 0 8px' }}>{r.name}{r.floor ? <small className="muted"> · {r.floor}</small> : null}</h3>
                {r.beds.map(bd => (
                  <div key={bd.id} className="sleep-bed">
                    <div><strong>{bd.label}</strong><br /><small className="muted">{BED[bd.bed_type]?.[en ? 1 : 0] ?? bd.bed_type}{bd.width_cm ? ` · ${bd.width_cm} cm` : ''}{bd.children_only ? (en ? ' · children only' : ' · kun barn') : ''}</small></div>
                    <label className="sleep-count"><span className="muted">{en ? 'Sleeps here' : 'Sover her'}</span>
                      <select name={'bed_' + bd.id} defaultValue={String(bd.allocation?.persons ?? 0)} disabled={!open}>{Array.from({ length: bd.sleeps + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}</select></label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {open && <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
          <button className="btn">{chosen ? (en ? 'Save changes' : 'Lagre endringer') : (en ? 'Save sleeping plan' : 'Lagre soveplanen')}</button>
          {chosen && <button formAction={resetSleepPlanAction} className="btn ghost">{en ? 'Use the automatic suggestion' : 'Bruk det automatiske forslaget'}</button>}
        </div>}
      </form>
      <p className="muted" style={{ fontSize: '.85rem', marginTop: 14 }}>{en ? 'The numbers are pre-filled with our suggestion. Infants can sleep in the cot or with an adult.' : 'Tallene er fylt ut med vårt forslag. Spedbarn kan sove i barneseng eller sammen med en voksen.'}</p>
    </div>
  );
}
