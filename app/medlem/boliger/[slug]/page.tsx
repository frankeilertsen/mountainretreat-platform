import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current';
import { one, q } from '@/lib/db';
import { blocksForRange } from '@/lib/domain/availability';
import { quoteFor, Quote } from '@/lib/domain/pricing';
import { rewardBalance } from '@/lib/domain/rewards';
import { memberDiscount } from '@/lib/domain/memberDiscount';
import { addDays, fmtTime, todayOslo } from '@/lib/format';
import { getT } from '@/lib/i18n/lang';
import { fmtDateL, nokL } from '@/lib/i18n/format';
import { translateMessage } from '@/lib/i18n/messages';
import { DomainError } from '@/lib/errors';
import { Flash, PropertyMedia } from '@/components/ui';
import { PropertyGallery } from '@/components/PropertyGallery';
import { MonthCalendar } from '@/components/MonthCalendar';
import { SavingsBreakdown } from '@/components/Savings';
import { BED_LABELS } from '@/lib/domain/beds';

const BED_LABELS_EN: Record<string, string> = { double: 'Double bed', single: 'Single bed', bunk_lower: 'Bunk bed (lower)', bunk_upper: 'Bunk bed (upper)', sofa_bed: 'Sofa bed', extra_mattress: 'Extra mattress', cot: 'Cot' };
import { requestBookingAction } from '../../../actions/member';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const u = await requireUser('request_booking');
  const { lang, t } = await getT();
  const T = t.property;
  const nok = (o: number) => nokL(o, lang), fmtDate = (d: string, w?: boolean) => fmtDateL(d, lang, w);
  const bedLabel = (k: string) => lang === 'en' ? (BED_LABELS_EN[k] ?? k) : (BED_LABELS[k] ?? k);
  const p = await one(`SELECT id, name, address, description, pricing_mode, included_guests, extra_guest_fee_ore, extra_guest_fee_basis, extra_guest_fee_includes, amenities, house_rules, max_guests, to_char(check_in_time,'HH24:MI') AS cin, to_char(check_out_time,'HH24:MI') AS cout, cleaning_fee_ore, own_linen_discount_ore,
     (SELECT ph.id FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=properties.id ORDER BY ph.created_at LIMIT 1) AS photo_id
     FROM properties WHERE slug=$1 AND active`, [slug]);
  if (!p) notFound();
  const gallery = await q<{ id: string; caption: string | null }>(`SELECT ph.id, NULL::text AS caption, 0 AS grp, ph.created_at, 0 AS so FROM photos ph WHERE ph.entity_type='property' AND ph.entity_id=$1
    UNION ALL SELECT ph.id, r.name, 1, ph.created_at, r.sort_order FROM photos ph JOIN rooms r ON r.id=ph.entity_id AND r.active WHERE ph.entity_type='room' AND r.property_id=$1
    ORDER BY 3, 5, 4`, [p.id]);
  const today = todayOslo();
  const blocks = await blocksForRange(p.id, today, addDays(today, 400));
  const seasons = await q(`SELECT name, price_per_night_ore, weekend_price_per_night_ore AS wk, min_nights, color FROM season_categories WHERE property_id=$1 AND active ORDER BY price_per_night_ore`, [p.id]);
  const addOns = await q(`SELECT id, name, description, price_type, unit_price_ore, mandatory FROM add_on_items WHERE (property_id=$1 OR property_id IS NULL) AND active ORDER BY mandatory DESC, name`, [p.id]);
  const bal = await rewardBalance(u.id);
  const sleeping = await q<{ room: string; beds: string }>(`SELECT r.name AS room, string_agg(b.bed_type || '|' || COALESCE(b.width_cm::text,''), ',' ORDER BY b.allocation_priority) AS beds
    FROM rooms r JOIN beds b ON b.room_id=r.id AND b.active WHERE r.property_id=$1 AND r.active GROUP BY r.id, r.name, r.sort_order ORDER BY r.sort_order`, [p.id]);
  const disc = await memberDiscount(u.id);
  const airbnbFee = Number((await one<{ value: string }>(`SELECT value FROM platform_settings WHERE key='airbnb_guest_fee_pct'`))?.value ?? 15);
  const rateStats = p.pricing_mode === 'airbnb' ? await one<{ min: number; avg: number }>(`SELECT min(price_ore)::int AS min, avg(price_ore)::int AS avg FROM external_nightly_rates WHERE property_id=$1 AND date BETWEEN current_date AND current_date + 90`, [p.id]) : null;

  const fra = sp.fra, til = sp.til;
  const adults = Math.max(1, parseInt(sp.voksne ?? '2', 10) || 1), children = Math.max(0, parseInt(sp.barn ?? '0', 10) || 0), infants = Math.max(0, parseInt(sp.sped ?? '0', 10) || 0);
  const selected = addOns.filter(a => sp['a_' + a.id]).map(a => ({ id: a.id, quantity: Math.max(1, parseInt(sp['q_' + a.id] ?? '1', 10) || 1) }));
  const ownLinen = p.own_linen_discount_ore > 0 && sp.eget_sengetoy === '1';
  let quote: Quote | null = null, quoteErr: string | null = null;
  if (fra && til) {
    try {
      if (blocks.some(b => b.start < til && b.end > fra)) throw new DomainError('unavailable', T.datesBusy);
      quote = await quoteFor(p.id, u.id, fra, til, adults + children, selected, undefined, null, ownLinen);
    } catch (e) { quoteErr = e instanceof DomainError ? translateMessage(e.message, lang) : T.quoteFailed; }
  }
  const PT = T.priceTypes;

  return (
    <>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {gallery.length ? <PropertyGallery photos={gallery} alt={p.name} labels={{ all: lang === 'en' ? 'Show all {n} photos' : 'Vis alle {n} bilder', close: lang === 'en' ? 'Close' : 'Lukk', prev: lang === 'en' ? 'Previous' : 'Forrige', next: lang === 'en' ? 'Next' : 'Neste' }} /> : <PropertyMedia photoId={null} alt={p.name} />}
          <div>
            <span className="eyebrow">{p.address}</span>
            <h1>{p.name}</h1>
            <p>{p.description}</p>
            <div className="row" style={{ gap: 6 }}>{(p.amenities as string[]).map(a => <span key={a} className="badge">{a}</span>)}</div>
          </div>
          <dl className="dl"><dt>{T.guests}</dt><dd>{T.upTo(p.max_guests)}</dd>{sleeping.length > 0 && <><dt>{T.bedrooms}</dt><dd>{sleeping.map(s => <div key={s.room}>{s.room}: <span className="muted">{s.beds.split(',').map(x => { const [t, w] = x.split('|'); return `${bedLabel(t)}${w ? ` ${w} cm` : ''}`; }).join(', ')}</span></div>)}</dd></>}<dt>{T.checkIn}</dt><dd>{T.from(p.cin)}</dd><dt>{T.checkOut}</dt><dd>{T.by(p.cout)}</dd><dt>{T.cleaning}</dt><dd>{nok(p.cleaning_fee_ore)}</dd><dt>{T.included}</dt><dd>{T.priceFor(p.included_guests)}</dd>{p.extra_guest_fee_ore > 0 && <><dt>{T.extraPerson}</dt><dd>{nok(p.extra_guest_fee_ore)} {T.perPerson(p.extra_guest_fee_basis)}{p.extra_guest_fee_includes ? <><br /><small className="muted">{p.extra_guest_fee_includes}</small></> : null}</dd></>}</dl>
          {p.house_rules && <p className="muted"><strong>{T.houseRules}</strong> {p.house_rules}</p>}
          <div className="card flat">
            <h3>{T.prices}</h3>
            {p.pricing_mode === 'airbnb' ? (
              rateStats?.min ? <>
                <div className="row between"><span>{T.airbnb3m}</span><span>{T.fromP} {nok(rateStats.min)} <small>{t.common.perNight}</small></span></div>
                <div className="row between" style={{ color: 'var(--gold-2)' }}><span>{T.yourPrice}</span><span>{T.fromP} {nok(rateStats.min * (1 - disc.totalPct / 100))} <small>{t.common.perNight}</small></span></div>
                <small className="muted">{T.followsAirbnb(airbnbFee, disc.totalPct, disc.loyaltyPct)} <a href="/medlem/fordeler">{T.howCalc}</a></small>
              </> : <p className="muted">{T.notEntered}</p>
            ) : <>
              {seasons.map(s => <div key={s.name} className="row between"><span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color ?? '#ccc', marginRight: 8 }} />{s.name} <small>· {T.minNights(s.min_nights)}</small></span><span><small className="muted" style={{ textDecoration: 'line-through', marginRight: 8 }}>{nok(s.price_per_night_ore)}</small>{nok(s.price_per_night_ore * (1 - disc.totalPct / 100))} <small>{t.common.perNight}</small>{s.wk != null && s.wk !== s.price_per_night_ore && <><br /><small className="muted">{lang === 'en' ? 'Fri–Sat' : 'fre–lør'} {nok(s.wk * (1 - disc.totalPct / 100))}</small></>}</span></div>)}
              <small className="muted">{T.discountApplied(disc.totalPct, disc.atMax ? null : disc.nextTotalPct)}</small>
            </>}
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 84 }}>
          <h2>{T.request}</h2>
          <Flash sp={sp} lang={lang} />
          <form method="get">
            <div className="fields">
              <div><label>{T.checkInDate}</label><input type="date" name="fra" min={today} defaultValue={fra} required /></div>
              <div><label>{T.checkOutDate}</label><input type="date" name="til" min={addDays(today, 1)} defaultValue={til} required /></div>
            </div>
            <div className="fields" style={{ marginTop: 14 }}>
              <div><label>{T.adults}</label><input type="number" name="voksne" min={1} max={p.max_guests} defaultValue={adults} /></div>
              <div><label>{T.children}</label><input type="number" name="barn" min={0} max={p.max_guests} defaultValue={children} /></div>
              <div><label>{T.infants}</label><input type="number" name="sped" min={0} max={4} defaultValue={infants} /></div>
            </div>
            {addOns.length > 0 && <div style={{ marginTop: 14 }}><label>{T.addOns}</label>
              {addOns.map(a => (
                <div key={a.id} className="row" style={{ marginBottom: 6 }}>
                  <label className="check" style={{ margin: 0, flex: 1 }}><input type="checkbox" name={'a_' + a.id} defaultChecked={a.mandatory || !!sp['a_' + a.id]} disabled={a.mandatory} /> <span>{a.name} <small className="muted">{nok(a.unit_price_ore)} {PT[a.price_type]}{a.mandatory ? ` · ${T.mandatory}` : ''}</small>{a.description && <><br /><small className="muted">{a.description}</small></>}</span></label>
                  {a.price_type === 'per_unit' && <input type="number" name={'q_' + a.id} min={1} max={20} defaultValue={sp['q_' + a.id] ?? 1} style={{ width: 70 }} />}
                </div>))}
            </div>}
            {p.own_linen_discount_ore > 0 && <label className="check" style={{ marginTop: 12 }}><input type="checkbox" name="eget_sengetoy" value="1" defaultChecked={ownLinen} /> <span>{lang === 'en' ? `We bring our own bed linen and towels` : `Vi tar med eget sengetøy og håndklær`} <small className="muted">{lang === 'en' ? `−${nok(p.own_linen_discount_ore)} per person` : `−${nok(p.own_linen_discount_ore)} per person`}</small></span></label>}
            <button className="btn secondary block" style={{ marginTop: 10 }}>{T.calc}</button>
          </form>

          {quoteErr && <div className="flash err" style={{ marginTop: 16 }}>{quoteErr}</div>}
          {quote && (
            <form action={requestBookingAction} style={{ marginTop: 20 }}>
              <SavingsBreakdown quote={quote} rewardOre={bal.next ? Math.min(bal.next.amount, quote.subtotal_ore) : 0} rewardEstimated lang={lang} />
              <p className="muted" style={{ fontSize: '.82rem' }}>{fmtDate(fra!, true)} – {fmtDate(til!, true)}. {T.lockNote}</p>
              <input type="hidden" name="propertyId" value={p.id} /><input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="fra" value={fra} /><input type="hidden" name="til" value={til} />
              <input type="hidden" name="voksne" value={adults} /><input type="hidden" name="barn" value={children} /><input type="hidden" name="sped" value={infants} />
              <input type="hidden" name="addons" value={JSON.stringify(selected)} />{ownLinen && <input type="hidden" name="eget_sengetoy" value="1" />}
              <input type="hidden" name="idem" value={crypto.randomUUID()} />
              {bal.next && <label className="check field"><input type="checkbox" name="useRewards" defaultChecked /> {T.useBonus(nok(Math.min(bal.next.amount, quote.subtotal_ore)), fmtDate(bal.next.expiresAt), bal.unused)}</label>}
              <div className="field"><label>{T.comment}</label><textarea name="requests" maxLength={2000} placeholder={T.commentPh} /></div>
              <button className="btn block">{T.request}</button>
            </form>
          )}
        </div>
      </div>
      <hr className="divider" />
      <div className="row between"><h2>{T.availability}</h2><div className="legend"><span><i style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)' }} />{T.free}</span><span><i style={{ background: '#121210', border: '1px solid #2c2b26' }} />{T.busy}</span></div></div>
      <MonthCalendar blocks={blocks} months={6} selStart={fra} selEnd={til} lang={lang} />
      <p className="muted" style={{ marginTop: 12, fontSize: '.85rem' }}>{T.calNote(fmtTime(p.cin))}</p>
    </>
  );
}
