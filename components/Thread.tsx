import type { MessageRow } from '@/lib/domain/messages';
import { ScrollToEnd } from './Chat';

/** Chat bubbles. `mine` decides which side is shown on the right. */
export function Thread({ messages, mine, label, fmt }: { messages: MessageRow[]; mine: 'member' | 'admin'; label: (m: MessageRow) => string; fmt: (iso: string) => string }) {
  return (
    <div className="thread">
      {messages.map(m => (
        <div key={m.id} className={`bubble ${m.sender_side === mine ? 'mine' : 'theirs'}`}>
          <div className="bubble-meta"><span>{label(m)}</span><time dateTime={new Date(m.created_at).toISOString()}>{fmt(m.created_at)}</time></div>
          <div className="bubble-body">{m.body}</div>
        </div>
      ))}
      <ScrollToEnd dep={messages.length} />
    </div>
  );
}
