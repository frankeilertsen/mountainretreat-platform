import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { openConversation } from '@/lib/domain/messages';
import { DomainError } from '@/lib/errors';
import { fmtDateTime } from '@/lib/format';
import { Flash } from '@/components/ui';
import { AutoRefresh, MessageBox, RefreshOnce, SendButton } from '@/components/Chat';
import { Thread } from '@/components/Thread';
import { replyAction, setConversationStatusAction } from '../../../actions/messages';

export const dynamic = 'force-dynamic';

export default async function AdminThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser('admin');
  let data;
  try { data = await openConversation(u as any, id); } catch (e) { if (e instanceof DomainError) notFound(); throw e; }
  const { conv, messages, meta } = data;
  return (
    <>
      <AutoRefresh seconds={15} />{data.hadUnread && <RefreshOnce />}
      <Link href="/admin/meldinger" className="muted">← Meldinger</Link>
      <div className="page-head row between" style={{ marginTop: 10 }}>
        <div><span className="eyebrow">{meta.member_name}</span><h1 style={{ marginBottom: 0 }}>{conv.subject}</h1></div>
        <form action={setConversationStatusAction} className="row">
          <input type="hidden" name="conversationId" value={conv.id} />
          <span className={`badge ${conv.status === 'open' ? 'b-ok' : ''}`}>{conv.status === 'open' ? 'Åpen' : 'Avsluttet'}</span>
          {conv.status === 'open'
            ? <button className="btn ghost small" name="status" value="closed">Avslutt samtale</button>
            : <button className="btn ghost small" name="status" value="open">Åpne igjen</button>}
        </form>
      </div>
      <Flash sp={sp} />
      <div className="grid split-2-1" style={{ alignItems: 'start' }}>
        <div className="card">
          <Thread messages={messages} mine="admin" fmt={iso => fmtDateTime(iso)} label={m => m.sender_name} />
          {conv.status === 'closed' ? <div className="note" style={{ marginTop: 14 }}>Samtalen er avsluttet. Åpne den igjen for å svare. Hvis medlemmet svarer, åpnes den automatisk.</div> : (
            <form action={replyAction} style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
              <input type="hidden" name="conversationId" value={conv.id} /><input type="hidden" name="area" value="admin" />
              <label htmlFor="body">Svar til {meta.member_name.split(' ')[0]}</label>
              <MessageBox id="body" name="body" required rows={4} maxLength={5000} placeholder="Skriv et svar … (medlemmet får e-post)" autoFocus />
              <div className="row between" style={{ marginTop: 10 }}><small className="muted">Ctrl/⌘ + Enter sender · oppdateres automatisk</small><SendButton label="Send svar" busy="Sender …" /></div>
            </form>)}
        </div>
        <div className="card flat">
          <h3>Medlem</h3>
          <dl className="dl">
            <dt>Navn</dt><dd><Link href={`/admin/medlemmer/${conv.member_id}`}>{meta.member_name}</Link></dd>
            <dt>E-post</dt><dd><a href={`mailto:${meta.member_email}`}>{meta.member_email}</a></dd>
            <dt>Telefon</dt><dd>{meta.member_phone ? <a href={`tel:${meta.member_phone}`}>{meta.member_phone}</a> : '–'}</dd>
            {meta.booking_id && <><dt>Booking</dt><dd><Link href={`/admin/bookinger/${meta.booking_id}`}>{meta.booking_ref}</Link><br /><small className="muted">{meta.property}</small></dd></>}
            <dt>Startet</dt><dd>{fmtDateTime(conv.created_at)}<br /><small className="muted">av {conv.started_by === 'admin' ? 'administrasjonen' : 'medlemmet'}</small></dd>
          </dl>
          <Link href={`/admin/meldinger?medlem=${conv.member_id}`} className="muted">Alle samtaler med medlemmet →</Link>
        </div>
      </div>
    </>
  );
}
