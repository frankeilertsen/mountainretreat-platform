import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { tasksForHelper, roomPlanForPreparation } from '@/lib/domain/cleaning';
import { q } from '@/lib/db';
import { addDays, todayOslo } from '@/lib/format';
import { Status, Empty } from '@/components/ui';
import { RoomPlan } from '@/components/RoomPlan';
import { PrintButton, GeneratedAt } from '@/components/Print';
import { getLang } from '@/lib/i18n/lang';
import { cleanDict } from '@/lib/i18n/cleaning';
import { fmtDateL } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Utskrift – vaskejobber' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Printable list of all cleaning jobs in a period: a summary table, then each job with full details and bed setup. */
export default async function CleaningPrint({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('cleaning_portal');
  const lang = await getLang();
  const en = lang === 'en';
  const C = cleanDict[lang];
  const T = C.task;
  const today = todayOslo();
  const from = ISO.test(sp.fra ?? '') ? sp.fra! : today;
  let to = ISO.test(sp.til ?? '') ? sp.til! : addDays(from, 13);
  if (to < from) to = from;
  if (to > addDays(from, 92)) to = addDays(from, 92);
  const detailed = sp.detaljer !== '0';
  const tasks = (await tasksForHelper(u as any, from, to)).filter(t => sp.alle === '1' || t.status !== 'not_needed');
  const plans = detailed ? await Promise.all(tasks.map(t => q<{ next_preparation_id: string | null }>(`SELECT next_preparation_id FROM cleaning_tasks WHERE id=$1`, [t.id])
    .then(r => roomPlanForPreparation(r[0]?.next_preparation_id ?? null, t.property_id)))) : [];
  const guestsOf = (t: any) => (t.next_adults ?? 0) + (t.next_children ?? 0);
  const linenText = (t: any) => t.own_linen && t.next_checkin ? (en ? 'Guests bring own linen – do not make up beds' : 'Gjestene tar med eget sengetøy – ikke re opp sengene') : null;
  const fmt = (d: string) => fmtDateL(d, lang, true);

  return (
    <>
      <div className="no-print">
        <Link href="/renhold" className="muted">{T.back}</Link>
        <h1 style={{ marginTop: 10 }}>{en ? 'Print cleaning jobs' : 'Skriv ut vaskejobber'}</h1>
        <form method="get" className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}><label>{en ? 'From' : 'Fra'}</label><input type="date" name="fra" defaultValue={from} /></div>
            <div className="field" style={{ margin: 0 }}><label>{en ? 'To' : 'Til'}</label><input type="date" name="til" defaultValue={to} /></div>
            <div className="field" style={{ margin: 0 }}><label>{en ? 'Content' : 'Innhold'}</label><select name="detaljer" defaultValue={detailed ? '1' : '0'}><option value="1">{en ? 'List + each job with bed setup' : 'Liste + hver jobb med sengeoppsett'}</option><option value="0">{en ? 'Short list only' : 'Kun kort liste'}</option></select></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="btn secondary small">{en ? 'Show' : 'Vis'}</button><PrintButton label={en ? 'Print' : 'Skriv ut'} className="btn small" /></div>
        </form>
      </div>

      <h1 className="print-only" style={{ marginBottom: 2 }}>{en ? 'Cleaning jobs' : 'Vaskejobber'}</h1>
      <p style={{ marginTop: 0 }}><strong>{fmt(from)} – {fmt(to)}</strong> · {tasks.length} {tasks.length === 1 ? (en ? 'job' : 'jobb') : (en ? 'jobs' : 'jobber')}</p>

      {tasks.length === 0 ? <Empty>{C.cal.noTasks}</Empty> : (
        <div className="table-wrap card" style={{ padding: 10 }}><table>
          <thead><tr><th>{T.date}</th><th>{en ? 'Property' : 'Bolig'}</th><th>{T.job}</th><th>{T.nextArrival}</th><th>{T.guests}</th><th>{en ? 'Notes' : 'Merknader'}</th><th>{T.responsible}</th><th>Status</th><th className="print-only">✓</th></tr></thead>
          <tbody>{tasks.map(t => (
            <tr key={t.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt(t.date)}</td>
              <td>{t.property_name}</td>
              <td>{t.task_type === 'turnover' ? `${T.turnover} ${t.check_out_time ?? ''}` : T.preparation}<br /><small className="muted">{t.channel_name}</small></td>
              <td>{t.next_checkin ? `${t.next_checkin === t.date ? (en ? 'Same day' : 'Samme dag') : fmt(t.next_checkin)} ${t.check_in_time ?? ''}${t.expected_arrival ? ` (~${t.expected_arrival})` : ''}` : '–'}</td>
              <td>{t.next_checkin ? (guestsOf(t) || '–') : '–'}{t.next_infants ? ` + ${t.next_infants} ${en ? 'inf.' : 'sped.'}` : ''}</td>
              <td><small>{[t.next_checkin && t.next_add_ons ? `🧺 ${t.next_add_ons}` : null, linenText(t) ? `🛏️ ${linenText(t)}` : null, t.notes ? `📋 ${t.notes}` : null, t.comment_for_cleaner ? `💬 ${t.comment_for_cleaner}` : null].filter(Boolean).join(' · ') || ''}</small></td>
              <td><small>{t.assignee_name ?? T.notAssigned}</small></td>
              <td><Status s={t.status} lang={lang} /></td>
              <td className="print-only">☐</td>
            </tr>))}
          </tbody></table></div>
      )}

      {detailed && tasks.map((t, i) => (
        <section key={t.id} className="print-page" style={{ marginTop: 28 }}>
          <div className="print-only print-generated-row"><span>Retreat Club · {en ? 'Cleaning job' : 'Vaskejobb'} {i + 1}/{tasks.length}</span><GeneratedAt lang={lang} /></div>
          <div className="row between"><h2 style={{ margin: 0 }}>{t.property_name}</h2><Status s={t.status} lang={lang} /></div>
          <p className="muted" style={{ margin: '2px 0 10px' }}>{t.address}</p>
          <div className="card" style={{ padding: 16 }}>
            <dl className="dl">
              <dt>{T.date}</dt><dd><strong>{fmt(t.date)}</strong></dd>
              <dt>{T.job}</dt><dd>{t.task_type === 'turnover' ? T.turnover : T.preparation} <small className="muted">({t.channel_name})</small></dd>
              {t.task_type === 'turnover' && <><dt>{T.checkout}</dt><dd>{T.at(t.check_out_time)}{t.checkout_guests ? ` · ${T.leaving(t.checkout_guests)}` : ''}</dd></>}
              <dt>{T.nextArrival}</dt><dd>{t.next_checkin ? `${fmt(t.next_checkin)} ${T.at(t.check_in_time)}${t.expected_arrival ? ` ${T.expected(t.expected_arrival)}` : ''}` : T.nonePlanned}</dd>
              {t.next_checkin && <><dt>{T.guests}</dt><dd>{t.next_adults != null && guestsOf(t) + (t.next_infants ?? 0) > 0 ? T.guestList(t.next_adults, t.next_children, t.next_infants) : T.noGuestInfo}</dd></>}
              <dt>{T.responsible}</dt><dd>{t.assignee_name ?? T.notAssigned}</dd>
            </dl>
            {t.next_add_ons && t.next_checkin && <div className="note" style={{ marginTop: 10 }}>🧺 <strong>{en ? 'Have ready:' : 'Gjør klart:'}</strong> {t.next_add_ons}</div>}
            {linenText(t) && <div className="note" style={{ marginTop: 10 }}>🛏️ <strong>{linenText(t)}</strong></div>}
            {(t.notes || t.comment_for_cleaner) && <div className="note" style={{ marginTop: 10 }}>{t.notes && <div>📋 {t.notes}</div>}{t.comment_for_cleaner && <div>💬 {t.comment_for_cleaner}</div>}</div>}
          </div>
          {plans[i] && plans[i].source !== 'none' && <>
            <h3 style={{ marginTop: 16 }}>{T.bedsTitle}</h3>
            <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>{plans[i].source === 'admin_override' ? T.planAdmin : plans[i].source === 'member' ? T.planMember : T.planAuto}</p>
            <RoomPlan plan={plans[i]} lang={lang} />
          </>}
          <p className="print-only" style={{ marginTop: 14 }}>{en ? 'Done' : 'Utført'}: ☐ &nbsp; {en ? 'Signature' : 'Signatur'}: ______________________ &nbsp; {en ? 'Notes' : 'Merknad'}: ______________________________</p>
        </section>
      ))}
    </>
  );
}
