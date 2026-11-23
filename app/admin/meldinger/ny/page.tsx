import Link from 'next/link';
import { q } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { Flash } from '@/components/ui';
import { MessageBox, SendButton } from '@/components/Chat';
import { adminStartConversationAction } from '../../../actions/messages';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ny melding' };

export default async function AdminNewMessage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const members = await q<{ id: string; name: string; email: string }>(`SELECT id, name, email FROM users WHERE system_role='member' AND status='active' ORDER BY name`);
  const memberId = members.some(m => m.id === sp.medlem) ? sp.medlem : '';
  const bookings = memberId ? await q<{ id: string; reference: string; property: string; start: string }>(
    `SELECT b.id, b.reference, p.name AS property, to_char(b.start_date,'YYYY-MM-DD') AS start FROM bookings b JOIN properties p ON p.id=b.property_id
     WHERE b.member_id=$1 ORDER BY b.start_date DESC LIMIT 30`, [memberId]) : [];
  return (
    <>
      <Link href="/admin/meldinger" className="muted">← Meldinger</Link>
      <div className="page-head" style={{ marginTop: 10 }}><h1>Ny melding til medlem</h1><p className="muted">Medlemmet får e-post med lenke til samtalen, på språket medlemmet har valgt.</p></div>
      <Flash sp={sp} />
      {!memberId ? (
        <form method="get" className="card" style={{ maxWidth: 560 }}>
          <div className="field"><label htmlFor="medlem">Medlem</label><select id="medlem" name="medlem" required defaultValue=""><option value="" disabled>Velg medlem</option>{members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}</select></div>
          <button className="btn">Fortsett</button>
        </form>
      ) : (
        <form action={adminStartConversationAction} className="card" style={{ maxWidth: 720 }}>
          <input type="hidden" name="memberId" value={memberId} />
          <p>Til: <strong>{members.find(m => m.id === memberId)!.name}</strong> · <Link href="/admin/meldinger/ny" className="muted">bytt</Link></p>
          <div className="field"><label htmlFor="subject">Emne</label><input id="subject" name="subject" required maxLength={160} /></div>
          {bookings.length > 0 && <div className="field"><label htmlFor="bookingId">Gjelder booking (valgfritt)</label>
            <select id="bookingId" name="bookingId" defaultValue={bookings.some(b => b.id === sp.booking) ? sp.booking : ''}><option value="">Ingen bestemt booking</option>{bookings.map(b => <option key={b.id} value={b.id}>{b.reference} · {b.property} · {fmtDate(b.start)}</option>)}</select></div>}
          <div className="field"><label htmlFor="body">Melding</label><MessageBox id="body" name="body" required rows={7} maxLength={5000} /></div>
          <SendButton label="Send melding" busy="Sender …" />
        </form>
      )}
    </>
  );
}
