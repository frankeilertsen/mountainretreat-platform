import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { openConversation } from '@/lib/domain/messages';
import { DomainError } from '@/lib/errors';
import { getT } from '@/lib/i18n/lang';
import { fmtDateTimeL } from '@/lib/i18n/format';
import { Flash } from '@/components/ui';
import { AutoRefresh, MessageBox, RefreshOnce, SendButton, AttachmentPicker } from '@/components/Chat';
import { Thread } from '@/components/Thread';
import { replyAction } from '../../../actions/messages';
import { MSG_FILE_ACCEPT } from '@/lib/domain/messageFiles';

export const dynamic = 'force-dynamic';

export default async function MemberThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const M = t.msg;
  let data;
  try { data = await openConversation(u as any, id); } catch (e) { if (e instanceof DomainError) notFound(); throw e; }
  const { conv, messages, meta } = data;
  const first = (n: string) => n.split(' ')[0];
  return (
    <>
      <AutoRefresh seconds={15} />{data.hadUnread && <RefreshOnce />}
      <Link href="/medlem/meldinger" className="muted">{M.back}</Link>
      <div className="page-head row between" style={{ marginTop: 12 }}>
        <div><span className="eyebrow">{M.count(messages.length)}</span><h1 style={{ marginBottom: 0 }}>{conv.subject}</h1>
          {meta.booking_id && <small className="muted">{M.about}: <Link href={`/medlem/bookinger/${meta.booking_id}`}>{meta.property} · {meta.booking_ref}</Link></small>}</div>
        <span className={`badge ${conv.status === 'open' ? 'b-ok' : ''}`}>{conv.status === 'open' ? M.open : M.closedBadge}</span>
      </div>
      <Flash sp={sp} lang={lang} />
      <div className="card" style={{ maxWidth: 860 }}>
        <Thread messages={messages} mine="member" fmt={iso => fmtDateTimeL(iso, lang)}
          label={m => m.sender_side === 'member' ? M.you : `${first(m.sender_name)} · ${M.team}`} />
        {conv.status === 'closed' && <div className="note" style={{ marginTop: 14 }}>{M.closed}</div>}
        <form action={replyAction} style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
          <input type="hidden" name="conversationId" value={conv.id} />
          <label htmlFor="body">{M.reply}</label>
          <MessageBox id="body" name="body" rows={4} maxLength={5000} placeholder={M.replyPh} />
          <AttachmentPicker accept={MSG_FILE_ACCEPT} lang={lang} />
          <div className="row between" style={{ marginTop: 10 }}><small className="muted">{M.enterHint} · {M.autoUpdate}</small><SendButton label={M.sendReply} busy={M.sending} /></div>
        </form>
      </div>
    </>
  );
}
