import Link from 'next/link';
import { requireUser } from '@/lib/auth/current';
import { q } from '@/lib/db';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, nokL } from '@/lib/i18n/format';
import { Flash, Status, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mine bookinger' };

export default async function MyBookings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const T = t.bookings;
  const nok = (o: number) => nokL(o, lang), fmtDate = (d: string) => fmtDateL(d, lang);
  const rows = await q(`SELECT b.id, b.reference, b.status, to_char(b.start_date,'YYYY-MM-DD') AS start, to_char(b.end_date,'YYYY-MM-DD') AS "end", b.price_total_ore, p.name AS property,
      b.end_date < current_date AS past FROM bookings b JOIN properties p ON p.id=b.property_id WHERE b.member_id=$1 ORDER BY b.start_date DESC`, [u.id]);
  const upcoming = rows.filter(r => !r.past && !['cancelled', 'rejected', 'expired'].includes(r.status));
  const other = rows.filter(r => !upcoming.includes(r));
  const Table = ({ list }: { list: typeof rows }) => (
    <div className="table-wrap"><table><thead><tr><th>{T.th.property}</th><th>{T.th.dates}</th><th>{T.th.ref}</th><th>{T.th.amount}</th><th>{T.th.status}</th></tr></thead><tbody>
      {list.map(b => <tr key={b.id}><td><Link href={`/medlem/bookinger/${b.id}`}>{b.property}</Link></td><td>{fmtDate(b.start)} – {fmtDate(b.end)}</td><td><small>{b.reference}</small></td><td>{nok(b.price_total_ore)}</td><td><Status s={b.status} lang={lang} /></td></tr>)}
    </tbody></table></div>);
  return (
    <>
      <div className="page-head"><h1>{T.title}</h1></div>
      <Flash sp={sp} lang={lang} />
      {sp.betalt && <div className="flash ok">{T.paidNote}</div>}
      <div className="card"><h3>{T.upcoming}</h3>{upcoming.length ? <Table list={upcoming} /> : <Empty>{T.none}</Empty>}</div>
      <div className="card" style={{ marginTop: 20 }}><h3>{T.past}</h3>{other.length ? <Table list={other} /> : <Empty>{T.noneYet}</Empty>}</div>
    </>
  );
}
