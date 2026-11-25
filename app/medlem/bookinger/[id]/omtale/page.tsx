import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { getT } from '@/lib/i18n/lang';
import { reviewDict } from '@/lib/i18n/reviews';
import { one } from '@/lib/db';
import { reviewableBooking, CATEGORIES } from '@/lib/domain/reviews';
import { Flash } from '@/components/ui';
import { StarInput, Stars } from '@/components/forms/StarInput';
import { reviewAction } from '../../../../actions/member';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Omtale' };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser('request_booking');
  const { id } = await params; const sp = await searchParams;
  const { lang } = await getT();
  const R = reviewDict[lang];
  const b = await reviewableBooking(id, u.id);
  if (!b) notFound();
  const prop = (await one<{ name: string }>(`SELECT name FROM properties WHERE id=$1`, [b.property_id]))!.name;
  const mine = b.reviewed ? await one<{ rating: number; public_text: string | null }>(`SELECT rating, public_text FROM reviews WHERE booking_id=$1`, [id]) : null;
  return (
    <div style={{ maxWidth: 720 }}>
      <Link href={`/medlem/bookinger/${id}`} className="muted">{R.back}</Link>
      <div className="page-head"><div><span className="eyebrow">{R.eyebrow} · {b.reference}</span><h1>{sp.takk || mine ? R.thanks : R.title(prop)}</h1></div></div>
      <Flash sp={sp} lang={lang} />
      {mine ? (
        <div className="card"><p className="muted">{sp.takk ? R.thanksText : R.done}</p><Stars n={mine.rating} size="1.4rem" />{mine.public_text && <p className="review-quote">«{mine.public_text}»</p>}</div>
      ) : !b.open ? (
        <div className="card"><p className="muted">{R.notYet}</p></div>
      ) : (
        <form action={reviewAction} className="card">
          <input type="hidden" name="id" value={id} /><input type="hidden" name="lang" value={lang} />
          <p className="muted">{R.lead}</p>
          <StarInput name="rating" label={R.overall} required />
          <p className="muted" style={{ margin: '8px 0 6px', fontSize: '.88rem' }}>{R.categories}</p>
          <div className="review-cats">{CATEGORIES.map(c => <StarInput key={c} name={c} label={R.cats[c]} size="sm" />)}</div>
          <div className="field"><label htmlFor="public_text">{R.publicText}</label><textarea id="public_text" name="public_text" rows={5} maxLength={2000} placeholder={R.publicPh} /></div>
          <div className="field"><label htmlFor="private_feedback">{R.privateText}</label><textarea id="private_feedback" name="private_feedback" rows={3} maxLength={2000} placeholder={R.privatePh} /></div>
          <label className="check field"><input type="checkbox" name="consent_publish" defaultChecked /> <span>{R.consent}</span></label>
          <button className="btn block">{R.submit}</button>
        </form>
      )}
    </div>
  );
}
