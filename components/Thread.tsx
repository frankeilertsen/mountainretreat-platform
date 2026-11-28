import type { MessageRow } from '@/lib/domain/messages';
import { INLINE_IMAGE, fileSizeText } from '@/lib/domain/messageFiles';
import { ScrollToEnd } from './Chat';

/** Chat bubbles. `mine` decides which side is shown on the right. */
export function Thread({ messages, mine, label, fmt }: { messages: MessageRow[]; mine: 'member' | 'admin'; label: (m: MessageRow) => string; fmt: (iso: string) => string }) {
  return (
    <div className="thread">
      {messages.map(m => (
        <div key={m.id} className={`bubble ${m.sender_side === mine ? 'mine' : 'theirs'}`}>
          <div className="bubble-meta"><span>{label(m)}</span><time dateTime={new Date(m.created_at).toISOString()}>{fmt(m.created_at)}</time></div>
          {m.body !== '📎' && <div className="bubble-body">{m.body}</div>}
          {m.attachments?.length > 0 && <div className="bubble-files">
            {m.attachments.filter(a => INLINE_IMAGE.has(a.mime_type)).map(a => (
              <a key={a.id} href={`/api/meldinger/vedlegg/${a.id}`} target="_blank" rel="noopener" className="bubble-img"><img src={`/api/meldinger/vedlegg/${a.id}`} alt={a.filename} loading="lazy" /></a>))}
            {m.attachments.filter(a => !INLINE_IMAGE.has(a.mime_type)).map(a => (
              <a key={a.id} href={`/api/meldinger/vedlegg/${a.id}?last_ned=1`} className="attach-chip">📄 {a.filename} <small>({fileSizeText(a.size_bytes)})</small></a>))}
          </div>}
        </div>
      ))}
      <ScrollToEnd dep={messages.length} />
    </div>
  );
}
