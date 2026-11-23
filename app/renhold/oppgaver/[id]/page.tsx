import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { helperCanSeeTask, roomPlanForPreparation } from '@/lib/domain/cleaning';
import { one, q } from '@/lib/db';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format';
import { Flash, Status } from '@/components/ui';
import { RoomPlan } from '@/components/RoomPlan';
import { startTaskAction, completeTaskAction, roomDoneAction, reportAction, taskPhotoAction } from '../../../actions/cleaning';
import { ImageInput } from '@/components/forms/ImageInput';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser('cleaning_portal');
  if (!(await helperCanSeeTask(u as any, id))) notFound();
  // Deliberately selects NO guest names, contact details, prices or member data.
  const t = await one(`SELECT t.id, t.task_type, t.status, t.channel_name, to_char(t.checkout_date,'YYYY-MM-DD') AS date, to_char(t.next_checkin_date,'YYYY-MM-DD') AS next_checkin,
      t.deadline_at, t.checkout_guests, t.notes, t.started_at, t.completed_at, t.completion_notes, t.next_preparation_id, t.property_id,
      p.name AS property, p.address, to_char(p.check_in_time,'HH24:MI') AS cin, to_char(p.check_out_time,'HH24:MI') AS cout,
      sp.adults, sp.children, sp.infants, sp.comment_for_cleaner, to_char(sp.expected_arrival_time,'HH24:MI') AS arrival, hu.name AS assignee
    FROM cleaning_tasks t JOIN properties p ON p.id=t.property_id LEFT JOIN stay_preparations sp ON sp.id=t.next_preparation_id LEFT JOIN users hu ON hu.id=t.assigned_to_user_id WHERE t.id=$1`, [id]);
  if (!t) notFound();
  const plan = await roomPlanForPreparation(t.next_preparation_id, t.property_id);
  const done = new Set((await q<{ room_id: string }>(`SELECT room_id FROM room_preparation_status WHERE cleaning_task_id=$1 AND completed_at IS NOT NULL`, [id])).map(r => r.room_id));
  const reports = await q(`SELECT r.kind, r.description, r.created_at, r.resolved_at, (SELECT array_agg(ph.id) FROM photos ph WHERE ph.entity_type='cleaning_report' AND ph.entity_id=r.id) AS photos FROM cleaning_reports r WHERE r.cleaning_task_id=$1 ORDER BY r.created_at`, [id]);
  const photos = await q(`SELECT id FROM photos WHERE entity_type='cleaning_task' AND entity_id=$1 ORDER BY created_at`, [id]);
  const roomsToPrepare = plan.rooms.filter(r => r.beds.some(b => b.allocation));
  const open = ['open', 'assigned', 'in_progress'].includes(t.status);
  const KIND: Record<string, string> = { damage: 'Skade', missing_item: 'Mangler', issue: 'Avvik', comment: 'Kommentar' };
  const sameDay = t.next_checkin === t.date;
  return (
    <>
      <Link href="/renhold" className="muted">← Tilbake</Link>
      <div className="row between" style={{ margin: '12px 0' }}><h1 style={{ margin: 0 }}>{t.property}</h1><Status s={t.status} /></div>
      <p className="muted" style={{ marginTop: -6 }}>{t.address}</p>
      <Flash sp={sp} />
      <div className="card" style={{ padding: 18 }}>
        <dl className="dl" style={{ fontSize: '1rem' }}>
          <dt>Dato</dt><dd><strong>{fmtDate(t.date, true)}</strong></dd>
          <dt>Oppgave</dt><dd>{t.task_type === 'turnover' ? 'Utvask etter utsjekk' : 'Klargjøring før ankomst'} <small className="muted">({t.channel_name})</small></dd>
          {t.task_type === 'turnover' && <><dt>Utsjekk</dt><dd>kl. {t.cout}{t.checkout_guests ? ` · ${t.checkout_guests} gjester reiser` : ''}</dd></>}
          <dt>Neste ankomst</dt><dd>{t.next_checkin ? <>{sameDay ? <strong style={{ color: 'var(--gold-2)' }}>I DAG kl. {t.cin}</strong> : `${fmtDate(t.next_checkin, true)} kl. ${t.cin}`}{t.arrival ? ` (ventet ${t.arrival})` : ''}</> : 'Ingen planlagt'}</dd>
          {t.deadline_at && <><dt>Frist</dt><dd><strong>{fmtDateTime(t.deadline_at)}</strong></dd></>}
          {t.next_checkin && <><dt>Gjester</dt><dd>{t.adults != null && (t.adults + t.children + t.infants) > 0 ? `${t.adults} voksne${t.children ? `, ${t.children} barn` : ''}${t.infants ? `, ${t.infants} spedbarn` : ''}` : 'Ingen info om neste gjester ennå'}</dd></>}
          <dt>Ansvarlig</dt><dd>{t.assignee ?? 'Ikke tildelt'}</dd>
        </dl>
        {(t.notes || t.comment_for_cleaner) && <div className="note" style={{ marginTop: 14 }}>{t.notes && <div>📋 {t.notes}</div>}{t.comment_for_cleaner && <div>💬 {t.comment_for_cleaner}</div>}</div>}
      </div>

      {t.status === 'not_needed' && <p className="muted" style={{ marginTop: 16 }}>Ikke nødvendig – gjesten vasker selv.</p>}

      <h2 style={{ marginTop: 28 }}>Senger og rom {t.next_checkin && <small className="muted" style={{ fontSize: '.9rem' }}>– for neste gjester</small>}</h2>
      {plan.source === 'none' ? <p className="muted">Ingen informasjon om neste gjester ennå. Re opp etter standard eller spør administrator.</p> : (
        <>
          <p className="muted" style={{ fontSize: '.88rem' }}>{plan.source === 'admin_override' ? 'Soveplan satt av administrator.' : 'Automatisk forslag ut fra antall gjester og senger.'} {roomsToPrepare.length} rom skal gjøres klare · {done.size} ferdig.</p>
          <RoomPlan plan={plan} doneRooms={done} roomAction={open ? roomDoneAction : undefined} taskId={id} />
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Rapporter</h2>
      {reports.map((r, i) => <div key={i} className="card flat" style={{ padding: 14, marginBottom: 10 }}><span className="badge">{KIND[r.kind]}</span> <small className="muted">{fmtDateTime(r.created_at)}{r.resolved_at ? ' · løst' : ''}</small><p style={{ margin: '6px 0 0' }}>{r.description}</p>
        {r.photos && <div className="row" style={{ marginTop: 8 }}>{r.photos.map((ph: string) => <img key={ph} src={`/api/photos/${ph}`} alt="" style={{ width: 80, height: 64, objectFit: 'cover', borderRadius: 6 }} />)}</div>}</div>)}
      <details className="card flat" style={{ padding: 16 }}>
        <summary><strong>+ Rapporter skade, mangel eller kommentar</strong></summary>
        <form action={reportAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="taskId" value={id} />
          <div className="field"><label>Type</label><select name="kind"><option value="damage">Skade</option><option value="missing_item">Noe mangler</option><option value="issue">Annet avvik</option><option value="comment">Kommentar</option></select></div>
          <div className="field"><label>Beskrivelse</label><textarea name="description" required placeholder="Hva, hvor?" /></div>
          <div className="field"><label>Bilde (valgfritt)</label><ImageInput name="photo" capture="environment" /></div>
          <button className="btn block">Send</button>
        </form>
      </details>

      <h2 style={{ marginTop: 28 }}>Bilder</h2>
      <div className="row">{photos.map(p => <img key={p.id} src={`/api/photos/${p.id}`} alt="" style={{ width: 96, height: 76, objectFit: 'cover', borderRadius: 8 }} />)}</div>
      <form action={taskPhotoAction} className="row" style={{ marginTop: 10 }}><input type="hidden" name="taskId" value={id} /><ImageInput name="photo" capture="environment" required style={{ flex: 1 }} /><button className="btn ghost small">Last opp</button></form>

      {open && (
        <div className="sticky-actions">
          {t.status !== 'in_progress' && <form action={startTaskAction}><input type="hidden" name="taskId" value={id} /><button className="btn secondary block">Start renhold</button></form>}
          <form action={completeTaskAction} className="card" style={{ padding: 12 }}>
            <input type="hidden" name="taskId" value={id} />
            <input name="notes" placeholder="Notat til administrator (valgfritt)" style={{ marginBottom: 8 }} />
            <button className="btn ok block">✓ Marker som ferdig{roomsToPrepare.length > done.size ? ` (${roomsToPrepare.length - done.size} rom gjenstår)` : ''}</button>
          </form>
        </div>
      )}
      {t.status === 'done' && <p className="muted" style={{ marginTop: 20 }}>Ferdig {fmtDateTime(t.completed_at)}{t.completion_notes ? ` – «${t.completion_notes}»` : ''}.</p>}
    </>
  );
}
