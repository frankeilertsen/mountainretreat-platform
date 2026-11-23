import Link from 'next/link';
import { adminConversations, AdminFilter } from '@/lib/domain/messages';
import { one } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { Flash, Empty } from '@/components/ui';
import { AutoRefresh } from '@/components/Chat';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meldinger' };
const FILTERS: [AdminFilter, string][] = [['unanswered', 'Venter på svar'], ['open', 'Åpne'], ['closed', 'Avsluttede'], ['all', 'Alle']];

export default async function AdminInbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filter = (FILTERS.find(f => f[0] === sp.vis)?.[0] ?? 'unanswered') as AdminFilter;
  const search = (sp.sok ?? '').trim().slice(0, 100);
  const memberId = /^[0-9a-f-]{36}$/i.test(sp.medlem ?? '') ? sp.medlem : undefined;
  const member = memberId ? await one<{ name: string }>(`SELECT name FROM users WHERE id=$1`, [memberId]) : null;
  const list = await adminConversations(memberId || search ? 'all' : filter, { search: search || undefined, memberId });
  const counts = await one<{ unanswered: number; open: number }>(`SELECT count(*) FILTER (WHERE status='open' AND last_message_by='member')::int AS unanswered, count(*) FILTER (WHERE status='open')::int AS open FROM conversations`);
  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="page-head row between">
        <div><span className="eyebrow">Medlemmer</span><h1 style={{ marginBottom: 0 }}>Meldinger</h1>
          <p className="muted">Felles innboks for alle administratorer. Medlemmet får e-post når dere svarer, og dere får e-post når et medlem skriver.</p></div>
        <Link href="/admin/meldinger/ny" className="btn">Ny melding til medlem</Link>
      </div>
      <Flash sp={sp} />
      <div className="row between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div className="nav">
          {FILTERS.map(([k, l]) => <Link key={k} href={`/admin/meldinger?vis=${k}`} className={!search && !memberId && filter === k ? 'active' : ''}>{l}{k === 'unanswered' && counts?.unanswered ? ` (${counts.unanswered})` : k === 'open' && counts?.open ? ` (${counts.open})` : ''}</Link>)}
        </div>
        <form className="row" method="get"><input name="sok" defaultValue={search} placeholder="Søk i navn, emne, tekst, ref." style={{ width: 260 }} /><button className="btn ghost small">Søk</button></form>
      </div>
      {(member || search) && <p className="muted">Viser {member ? <>samtaler med <strong>{member.name}</strong></> : <>treff for «{search}»</>} · <Link href="/admin/meldinger">Nullstill</Link></p>}
      <div className="card">
        {list.length === 0 ? <Empty>{filter === 'unanswered' && !search && !memberId ? 'Ingen meldinger venter på svar.' : 'Ingen samtaler.'}</Empty> : (
          <ul className="conv-list">{list.map(c => (
            <li key={c.id} className={c.unread ? 'unread' : ''}><Link href={`/admin/meldinger/${c.id}`}>
              <span className="subj">{c.unread ? <span className="dot" /> : null}{c.member_name} – {c.subject}{c.booking_ref ? <small className="muted"> · {c.booking_ref}</small> : null}</span>
              <span className="when">{fmtDateTime(c.last_message_at)}</span>
              <span className="pv">{c.last_message_by === 'admin' ? 'Dere: ' : ''}{c.preview}</span>
              <span className="when">{c.status === 'closed' ? <span className="badge">Avsluttet</span> : c.last_message_by === 'member' ? <span className="badge b-warn">{c.unread ? `${c.unread} ulest${c.unread === 1 ? '' : 'e'}` : 'Venter på svar'}</span> : <span className="badge b-ok">Besvart</span>}</span>
            </Link></li>))}</ul>)}
      </div>
    </>
  );
}
