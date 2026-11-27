import Link from 'next/link';
import { fmtDate, todayOslo } from '@/lib/format';
import { Status } from './ui';
import type { Lang } from '@/lib/i18n/dict';
import { cleanDict } from '@/lib/i18n/cleaning';
import { fmtDateL } from '@/lib/i18n/format';

export function TaskCard({ t, lang = 'no' }: { t: any; lang?: Lang }) {
  const C = cleanDict[lang].card;
  const urgent = t.same_day && t.task_type === 'turnover';
  const sameDayLabel = t.date === todayOslo() ? C.today : C.sameDay;
  const cls = t.status === 'done' ? 'done' : t.status === 'not_needed' ? 'notneeded' : urgent ? 'urgent' : '';
  const guests = (t.next_adults ?? 0) + (t.next_children ?? 0);
  return (
    <Link href={`/renhold/oppgaver/${t.id}`} className={`task ${cls}`}>
      <div className="row between"><h3>{t.property_name}</h3><Status s={t.status} lang={lang} /></div>
      <div className="muted" style={{ fontSize: '.88rem' }}>{t.address}</div>
      <div className="row" style={{ marginTop: 10, gap: 18 }}>
        {t.task_type === 'turnover'
          ? <span>⬆ {C.checkout} <strong>{t.check_out_time}</strong>{t.checkout_guests ? ` · ${C.guests(t.checkout_guests)}` : ''}</span>
          : <span>{C.prep}</span>}
        {t.next_checkin && <span>⬇ {C.nextIn} <strong>{t.next_checkin === t.date ? `${sameDayLabel} ${t.check_in_time}` : fmtDateL(t.next_checkin, lang, true)}</strong>{guests ? ` · ${C.guests(guests)}` : ''}{t.next_infants ? ` ${C.infants(t.next_infants)}` : ''}</span>}
      </div>
      {urgent && t.status !== 'done' && <div style={{ marginTop: 8 }}><span className="badge b-danger">{C.shortTurn(t.check_in_time)}</span></div>}
      {t.next_add_ons && t.next_checkin && <div style={{ marginTop: 8, fontSize: '.88rem' }}>🧺 {lang === 'en' ? 'Have ready:' : 'Gjør klart:'} {t.next_add_ons}</div>}
      {t.own_linen && t.next_checkin && <div style={{ marginTop: 8, fontSize: '.88rem', color: 'var(--gold-2)' }}>🛏️ {(() => { const tot = (t.next_adults ?? 0) + (t.next_children ?? 0), own = Number(t.own_linen_persons ?? tot); return own >= tot ? (lang === 'en' ? 'Guests bring own bed linen – do not make up beds' : 'Gjestene tar med eget sengetøy – ikke re opp sengene') : (lang === 'en' ? `${own} of ${tot} bring own linen – see the bed plan` : `${own} av ${tot} tar med eget sengetøy – se sengeoppsettet`); })()}</div>}
      {(t.notes || t.comment_for_cleaner) && <div style={{ marginTop: 8, fontSize: '.88rem' }}>💬 {t.notes ?? t.comment_for_cleaner}</div>}
      <small className="muted">{t.channel_name}{t.assignee_name ? ` · ${t.assignee_name}` : ` · ${C.unassigned}`}</small>
    </Link>
  );
}
