import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { blocksForRange } from '@/lib/domain/availability';
import { quoteFor, Quote } from '@/lib/domain/pricing';
import { rewardBalance } from '@/lib/domain/rewards';
import { memberDiscount } from '@/lib/domain/memberDiscount';
import { addDays, fmtDate, fmtTime, nok, todayOslo } from '@/lib/format';
import { DomainError } from '@/lib/errors';
import { Flash, PropertyMedia } from '@/components/ui';
import { MonthCalendar } from '@/components/MonthCalendar';
import { requestBookingAction } from '../../../actions/member';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const p = await one(`SELECT id, name, address, description, amenities, house_rules, max_guests, to_char(check_in_time,'HH24:MI') AS cin, to_char(check_out_time,'HH24:MI') AS cout, cleaning_fee_ore,
     (SELECT ph.id FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=properties.id ORDER BY ph.created_at LIMIT 1) AS photo_id
     FROM properties WHERE slug=$1 AND active`, [slug]);
  if (!p) notFound();
  const today = todayOslo();
  const blocks = await blocksForRange(p.id, today, addDays(today, 400));
  const seasons = await q(`SELECT name, price_per_night_ore, min_nights, color FROM season_categories WHERE property_id=$1 AND active ORDER BY price_per_night_ore`, [p.id]);
  const addOns = await q(`SELECT id, name, description, price_type, unit_price_ore, mandatory FROM add_on_items WHERE (property_id=$1 OR property_id IS NULL) AND active ORDER BY mandatory DESC, name`, [p.id]);
  const bal = await rewardBalance(u.id);
  const disc = await memberDiscount(u.id);

  const fra = sp.fra, til = sp.til;
  const adults = Math.max(1, parseInt(sp.voksne ?? '2', 10) || 1), children = Math.max(0, parseInt(sp.barn ?? '0', 10) || 0), infants = Math.max(0, parseInt(sp.sped ?? '0', 10) || 0);
  const selected = addOns.filter(a => sp['a_' + a.id]).map(a => ({ id: a.id, quantity: Math.max(1, parseInt(sp['q_' + a.id] ?? '1', 10) || 1) }));
  let quote: Quote | null = null, quoteErr: string | null = null;
  if (fra && til) {
    try {
      if (blocks.some(b => b.start < til && b.end > fra)) throw new DomainError('unavailable', 'Noen av datoene er opptatt. Velg andre datoer.');
      quote = await quoteFor(p.id, u.id, fra, til, adults + children, selected);
    } catch (e) { quoteErr = e instanceof DomainError ? e.message : 'Kunne ikke beregne pris.'; }
  }
  const PT: Record<string, string> = { flat: 'per opphold', per_night: 'per natt', per_unit: 'per stk', per_guest: 'per gjest' };

  return (
    <>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <PropertyMedia photoId={p.photo_id} alt={p.name} />
          <div>
            <span className="eyebrow">{p.address}</span>
            <h1>{p.name}</h1>
            <p>{p.description}</p>
            <div className="row" style={{ gap: 6 }}>{(p.amenities as string[]).map(a => <span key={a} className="badge">{a}</span>)}</div>
          </div>
          <dl className="dl"><dt>Gjester</dt><dd>Opptil {p.max_guests}</dd><dt>Innsjekk</dt><dd>fra kl. {p.cin}</dd><dt>Utsjekk</dt><dd>innen kl. {p.cout}</dd><dt>Sluttrengjøring</dt><dd>{nok(p.cleaning_fee_ore)}</dd></dl>
          {p.house_rules && <p className="muted"><strong>Husregler:</strong> {p.house_rules}</p>}
          <div className="card flat">
            <h3>Priser</h3>
            {seasons.map(s => <div key={s.name} className="row between"><span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color ?? '#ccc', marginRight: 8 }} />{s.name} <small>· min. {s.min_nights} netter</small></span><span><small className="muted" style={{ textDecoration: 'line-through', marginRight: 8 }}>{nok(s.price_per_night_ore)}</small>{nok(s.price_per_night_ore * (1 - disc.totalPct / 100))} <small>/ natt</small></span></div>)}
            <small className="muted">Din medlemsrabatt på <strong style={{ color: 'var(--gold-2)' }}>{disc.totalPct} %</strong> er trukket fra{disc.atMax ? '' : ` – neste booking gir ${disc.nextTotalPct} %`}. Lengre opphold gir ekstra rabatt.</small>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 84 }}>
          <h2>Send forespørsel</h2>
          <Flash sp={sp} />
          <form method="get">
            <div className="fields">
              <div><label>Innsjekk</label><input type="date" name="fra" min={today} defaultValue={fra} required /></div>
              <div><label>Utsjekk</label><input type="date" name="til" min={addDays(today, 1)} defaultValue={til} required /></div>
            </div>
            <div className="fields" style={{ marginTop: 14 }}>
              <div><label>Voksne</label><input type="number" name="voksne" min={1} max={p.max_guests} defaultValue={adults} /></div>
              <div><label>Barn (2–17)</label><input type="number" name="barn" min={0} max={p.max_guests} defaultValue={children} /></div>
              <div><label>Spedbarn</label><input type="number" name="sped" min={0} max={4} defaultValue={infants} /></div>
            </div>
            {addOns.length > 0 && <div style={{ marginTop: 14 }}><label>Tillegg</label>
              {addOns.map(a => (
                <div key={a.id} className="row" style={{ marginBottom: 6 }}>
                  <label className="check" style={{ margin: 0, flex: 1 }}><input type="checkbox" name={'a_' + a.id} defaultChecked={a.mandatory || !!sp['a_' + a.id]} disabled={a.mandatory} /> {a.name} <small className="muted">{nok(a.unit_price_ore)} {PT[a.price_type]}{a.mandatory ? ' · obligatorisk' : ''}</small></label>
                  {a.price_type === 'per_unit' && <input type="number" name={'q_' + a.id} min={1} max={20} defaultValue={sp['q_' + a.id] ?? 1} style={{ width: 70 }} />}
                </div>))}
            </div>}
            <button className="btn secondary block" style={{ marginTop: 10 }}>Beregn pris</button>
          </form>

          {quoteErr && <div className="flash err" style={{ marginTop: 16 }}>{quoteErr}</div>}
          {quote && (
            <form action={requestBookingAction} style={{ marginTop: 20 }}>
              <div className="price-lines">
                <div className="row"><span>{quote.nights} netter, ordinær pris</span><span>{nok(quote.stay_ore + quote.member_discount_ore)}</span></div>
                {quote.member_discount_ore > 0 && <div className="row" style={{ color: 'var(--gold-2)' }}><span>Medlemsrabatt {quote.member_discount_pct} %</span><span>−{nok(quote.member_discount_ore)}</span></div>}
                {quote.nightLines.some(n => n.los_discount_pct > 0) && <div className="row muted"><span>inkl. langtidsrabatt {quote.nightLines[0].los_discount_pct} %</span><span></span></div>}
                <div className="row"><span>Sluttrengjøring</span><span>{nok(quote.cleaning_fee_ore)}</span></div>
                {quote.add_ons.map(a => <div key={a.id} className="row"><span>{a.name}{a.quantity > 1 ? ` × ${a.quantity}` : ''}</span><span>{nok(a.total_ore)}</span></div>)}
                <div className="row price-total"><span>Totalt</span><span>{nok(quote.subtotal_ore)}</span></div>
              </div>
              <p className="muted" style={{ fontSize: '.82rem' }}>{fmtDate(fra!, true)} – {fmtDate(til!, true)}. Endelig pris låses når forespørselen godkjennes.</p>
              <input type="hidden" name="propertyId" value={p.id} /><input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="fra" value={fra} /><input type="hidden" name="til" value={til} />
              <input type="hidden" name="voksne" value={adults} /><input type="hidden" name="barn" value={children} /><input type="hidden" name="sped" value={infants} />
              <input type="hidden" name="addons" value={JSON.stringify(selected)} />
              <input type="hidden" name="idem" value={crypto.randomUUID()} />
              {bal.available > 0 && <label className="check field"><input type="checkbox" name="useRewards" defaultChecked /> Bruk bonus ({nok(Math.min(bal.available, quote.subtotal_ore))} av {nok(bal.available)})</label>}
              <div className="field"><label>Kommentar / spesielle ønsker</label><textarea name="requests" maxLength={2000} placeholder="F.eks. forventet ankomsttid, barneseng, allergier…" /></div>
              <button className="btn block">Send forespørsel</button>
            </form>
          )}
        </div>
      </div>
      <hr className="divider" />
      <div className="row between"><h2>Tilgjengelighet</h2><div className="legend"><span><i style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)' }} />Ledig</span><span><i style={{ background: '#121210', border: '1px solid #2c2b26' }} />Opptatt</span></div></div>
      <MonthCalendar blocks={blocks} months={6} selStart={fra} selEnd={til} />
      <p className="muted" style={{ marginTop: 12, fontSize: '.85rem' }}>Innsjekk fra kl. {fmtTime(p.cin)}. Kalenderen oppdateres fortløpende fra alle kanaler.</p>
    </>
  );
}
