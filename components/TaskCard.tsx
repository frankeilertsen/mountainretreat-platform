import Link from 'next/link';
import { fmtDate, todayOslo } from '@/lib/format';
import { Status } from './ui';

export function TaskCard({ t, shortHours = 6 }: { t: any; shortHours?: number }) {
  const urgent = t.same_day && t.task_type === 'turnover';
  const sameDayLabel = t.date === todayOslo() ? 'i dag' : 'samme dag';
  const cls = t.status === 'done' ? 'done' : t.status === 'not_needed' ? 'notneeded' : urgent ? 'urgent' : '';
  const guests = (t.next_adults ?? 0) + (t.next_children ?? 0);
  return (
    <Link href={`/renhold/oppgaver/${t.id}`} className={`task ${cls}`}>
      <div className="row between"><h3>{t.property_name}</h3><Status s={t.status} /></div>
      <div className="muted" style={{ fontSize: '.88rem' }}>{t.address}</div>
      <div className="row" style={{ marginTop: 10, gap: 18 }}>
        {t.task_type === 'turnover'
          ? <span>⬆ Utsjekk <strong>{t.check_out_time}</strong>{t.checkout_guests ? ` · ${t.checkout_guests} gjester` : ''}</span>
          : <span>Klargjøring før ankomst</span>}
        {t.next_checkin && <span>⬇ Neste inn <strong>{t.next_checkin === t.date ? `${sameDayLabel} ${t.check_in_time}` : fmtDate(t.next_checkin, true)}</strong>{guests ? ` · ${guests} gjester` : ''}{t.next_infants ? ` + ${t.next_infants} sped.` : ''}</span>}
      </div>
      {urgent && t.status !== 'done' && <div style={{ marginTop: 8 }}><span className="badge b-danger">Kort snutid – ferdig før kl. {t.check_in_time}</span></div>}
      {(t.notes || t.comment_for_cleaner) && <div style={{ marginTop: 8, fontSize: '.88rem' }}>💬 {t.notes ?? t.comment_for_cleaner}</div>}
      <small className="muted">{t.channel_name}{t.assignee_name ? ` · ${t.assignee_name}` : ' · ikke tildelt'}</small>
    </Link>
  );
}
