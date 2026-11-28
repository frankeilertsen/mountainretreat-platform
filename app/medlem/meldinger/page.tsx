import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { memberConversations } from '@/lib/domain/messages';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, fmtDateTimeL } from '@/lib/i18n/format';
import { Flash, Empty } from '@/components/ui';
import { AutoRefresh, MessageBox, SendButton, AttachmentPicker } from '@/components/Chat';
import { memberStartConversationAction } from '../../actions/messages';
import { MSG_FILE_ACCEPT } from '@/lib/domain/messageFiles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meldinger' };

export default async function MemberMessages({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const M = t.msg;
  const list = await memberConversations(u.id);
  const bookings = await q<{ id: string; reference: string; property: string; start: string; end: string }>(
    `SELECT b.id, b.reference, p.name AS property, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end"
     FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.member_id=$1 AND b.end_date >= current_date - 90 ORDER BY b.start_date DESC LIMIT 20`, [u.id]);
  const preBooking = bookings.some(b => b.id === sp.booking) ? sp.booking : '';
  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="page-head"><span className="eyebrow">{M.eyebrow}</span><h1>{M.title}</h1><p className="muted" style={{ maxWidth: '62ch' }}>{M.lead}</p></div>
      <Flash sp={sp} lang={lang} />
      <div className="grid split-1-2" style={{ alignItems: 'start' }}>
        <form action={memberStartConversationAction} className="card">
          <h3>{M.newTitle}</h3>
          <div className="field"><label htmlFor="subject">{M.subject}</label><input id="subject" name="subject" required maxLength={160} placeholder={M.subjectPh} defaultValue={preBooking ? (bookings.find(b => b.id === preBooking)!.reference) : ''} /></div>
          {bookings.length > 0 && <div className="field"><label htmlFor="bookingId">{M.booking}</label>
            <select id="bookingId" name="bookingId" defaultValue={preBooking}><option value="">{M.noBooking}</option>
              {bookings.map(b => <option key={b.id} value={b.id}>{b.property} · {fmtDateL(b.start, lang)} – {fmtDateL(b.end, lang)} ({b.reference})</option>)}</select></div>}
          <div className="field"><label htmlFor="body">{M.message}</label><MessageBox id="body" name="body" rows={6} maxLength={5000} placeholder={M.messagePh} autoFocus={!!preBooking} />
          <AttachmentPicker accept={MSG_FILE_ACCEPT} lang={lang} /></div>
          <SendButton label={M.send} busy={M.sending} className="btn block" />
          <small className="muted" style={{ display: 'block', marginTop: 8 }}>{M.enterHint}</small>
        </form>
        <div className="card">
          <h3>{M.inbox}</h3>
          {list.length === 0 ? <Empty>{M.none}</Empty> : (
            <ul className="conv-list">{list.map(c => (
              <li key={c.id} className={c.unread ? 'unread' : ''}><Link href={`/medlem/meldinger/${c.id}`}>
                <span className="subj">{c.unread ? <span className="dot" aria-label={M.unread(c.unread)} /> : null}{c.subject}</span>
                <span className="when">{fmtDateTimeL(c.last_message_at, lang)}</span>
                <span className="pv">{c.last_message_by === 'admin' ? `${M.team}: ` : `${M.you}: `}{c.preview}</span>
                <span className="when">{c.status === 'closed' ? <span className="badge">{M.closedBadge}</span> : c.unread ? <span className="badge b-warn">{M.unread(c.unread)}</span> : c.last_message_by === 'member' ? <small>{M.waiting}</small> : <small>{M.answered}</small>}</span>
              </Link></li>))}</ul>)}
        </div>
      </div>
    </>
  );
}
