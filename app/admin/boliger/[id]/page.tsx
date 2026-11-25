import Link from 'next/link';
import { notFound } from 'next/navigation';
import { one, q } from '@/lib/db';
import { addDays, fmtDate, nok, todayOslo } from '@/lib/format';
import { BED_LABELS } from '@/lib/domain/beds';
import { sleepingPlaces, BED_SIZES } from '@/lib/domain/capacity';
import { Flash } from '@/components/ui';
import * as A from '../../../actions/properties';
import { ImageInput } from '@/components/forms/ImageInput';
import { ValueButton } from '@/components/ValueButton';

export const dynamic = 'force-dynamic';
const TABS: [string, string][] = [['', 'Detaljer'], ['rom', 'Rom og senger'], ['priser', 'Priser og regler']];
const WDS = ['sø', 'ma', 'ti', 'on', 'to', 'fr', 'lø'];
const WD = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

export default async function PropertyAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.fane ?? '';
  const p = await one(`SELECT *, to_char(check_in_time,'HH24:MI') AS cin, to_char(check_out_time,'HH24:MI') AS cout FROM properties WHERE id=$1`, [id]);
  if (!p) notFound();
  return (
    <>
      <Link href="/admin/boliger" className="muted">← Boliger</Link>
      <div className="page-head row between" style={{ marginTop: 10 }}><h1 style={{ marginBottom: 0 }}>{p.name}</h1>
        <Link className="btn ghost small" href={`/admin/kanaler?bolig=${id}`}>Kanaler og synk →</Link></div>
      <div className="nav" style={{ marginBottom: 24 }}>{TABS.map(([k, l]) => <Link key={k} href={`/admin/boliger/${id}${k ? '?fane=' + k : ''}`} className={tab === k ? 'active' : ''}>{l}</Link>)}</div>
      <Flash sp={sp} />
      {tab === '' && <Details p={p} />}
      {tab === 'rom' && <Rooms pid={id} />}
      {tab === 'priser' && <Pricing pid={id} mode={p.pricing_mode} minNights={p.default_min_nights} />}
    </>
  );
}

async function Details({ p }: { p: any }) {
  const cap = await sleepingPlaces(p.id);
  const photos = await q(`SELECT id FROM photos WHERE entity_type='property' AND entity_id=$1 ORDER BY created_at`, [p.id]);
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <form action={A.updatePropertyAction} className="card">
        <input type="hidden" name="id" value={p.id} />
        <div className="field"><label>Navn</label><input name="name" defaultValue={p.name} required /></div>
        <div className="field"><label>Adresse (vises for renholdere og bekreftede gjester)</label><input name="address" defaultValue={p.address ?? ''} /></div>
        <div className="field"><label>Kort beskrivelse</label><input name="short_description" defaultValue={p.short_description ?? ''} /></div>
        <div className="field"><label>Beskrivelse</label><textarea name="description" defaultValue={p.description ?? ''} rows={5} /></div>
        <div className="field"><label>Airbnb-annonse (vises på forsiden under «Book via Airbnb»)</label><input name="airbnb_listing_url" type="url" placeholder="https://www.airbnb.no/rooms/…" defaultValue={p.airbnb_listing_url ?? ''} /></div>
        <div className="field"><label>Fasiliteter (kommaseparert)</label><input name="amenities" defaultValue={(p.amenities ?? []).join(', ')} /></div>
        <div className="field"><label>Husregler</label><textarea name="house_rules" defaultValue={p.house_rules ?? ''} /></div>
        <div className="fields">
          <div><label>Innsjekk fra</label><input type="time" name="check_in_time" defaultValue={p.cin} /></div>
          <div><label>Utsjekk innen</label><input type="time" name="check_out_time" defaultValue={p.cout} /></div>
          <div><label>Sluttrengjøring (kr)</label><input name="cleaning_fee" defaultValue={p.cleaning_fee_ore / 100} /></div>
        </div>
        <h4 style={{ marginTop: 20 }}>Maks personer</h4>
        <p className="muted" style={{ fontSize: '.85rem', margin: '0 0 10px' }}>Boligen har <strong style={{ color: 'var(--gold-2)' }}>{cap.total} sengeplasser</strong> fra {cap.rooms.length} rom (se fanen Rom og senger). Spedbarn i barneseng telles ikke.</p>
        <div className="fields">
          <div><label>Beregning</label><select name="max_guests_mode" defaultValue={p.max_guests_mode}><option value="auto">Lik antall sengeplasser</option><option value="manual">Sett manuelt (maks {cap.total || '–'})</option></select></div>
          <div><label>Maks personer (ved manuelt)</label><input type="number" name="max_guests" min={1} max={cap.total || undefined} defaultValue={p.max_guests} /></div>
          <div><label>Gjeldende maks</label><input value={`${p.max_guests} personer`} disabled /></div>
        </div>
        <h4 style={{ marginTop: 20 }}>Gjester inkludert i prisen</h4>
        <div className="fields">
          <div><label>Personer inkl. i prisen</label><input type="number" name="included_guests" min={1} defaultValue={p.included_guests} /></div>
          <div><label>Ekstra person (kr)</label><input name="extra_guest_fee" defaultValue={p.extra_guest_fee_ore / 100} /></div>
          <div><label>Beregnes</label><select name="extra_guest_fee_basis" defaultValue={p.extra_guest_fee_basis}><option value="per_stay">per opphold</option><option value="per_night">per natt</option></select></div>
        </div>
        <div className="field" style={{ marginTop: 12 }}><label>Ekstra person inkluderer</label><input name="extra_guest_fee_includes" defaultValue={p.extra_guest_fee_includes ?? ''} /></div>
        <label className="check" style={{ margin: '16px 0' }}><input type="checkbox" name="active" defaultChecked={p.active} /> Aktiv (synlig for medlemmer)</label>
        <button className="btn">Lagre</button>
      </form>
      <div className="card">
        <h3>Bilder</h3>
        <div className="grid g3">{photos.map(ph => (
          <div key={ph.id}><img src={`/api/photos/${ph.id}`} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 8 }} />
            <form action={A.deletePhotoAction}><input type="hidden" name="id" value={ph.id} /><input type="hidden" name="propertyId" value={p.id} /><button className="btn ghost small">Fjern</button></form></div>))}</div>
        <form action={A.uploadPhotoAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="entity" value="property" /><input type="hidden" name="entityId" value={p.id} /><input type="hidden" name="propertyId" value={p.id} />
          <ImageInput name="photo" accept="image/jpeg,image/png,image/webp" required /><button className="btn secondary small" style={{ marginTop: 8 }}>Last opp</button>
        </form>
        <small className="muted">JPEG/PNG/WebP, maks 10 MB. Første bilde brukes som forsidebilde.</small>
      </div>
    </div>
  );
}

async function Rooms({ pid }: { pid: string }) {
  const cap = await sleepingPlaces(pid);
  const prop = await one<{ max_guests: number; max_guests_mode: string }>('SELECT max_guests, max_guests_mode FROM properties WHERE id=$1', [pid]);
  const rooms = await q(`SELECT r.*, (SELECT ph.id FROM photos ph WHERE ph.entity_type='room' AND ph.entity_id=r.id ORDER BY ph.created_at DESC LIMIT 1) AS photo_id FROM rooms r WHERE property_id=$1 AND active ORDER BY sort_order, name`, [pid]);
  const beds = await q(`SELECT * FROM beds WHERE property_id=$1 AND active ORDER BY allocation_priority`, [pid]);
  return (
    <>
      <div className="grid g3" style={{ marginBottom: 20 }}>
        <div className="card kpi-card"><span className="kpi-label">Sengeplasser</span><div className="kpi" style={{ color: 'var(--gold-2)' }}>{cap.total}</div><small>{cap.rooms.length} rom · {beds.filter(b => b.bed_type !== 'cot').length} senger</small></div>
        <div className="card kpi-card"><span className="kpi-label">Maks personer</span><div className="kpi">{prop?.max_guests}</div><small>{prop?.max_guests_mode === 'auto' ? 'Følger sengeplassene automatisk' : 'Satt manuelt'} · endres under Detaljer</small></div>
        <div className="card kpi-card"><span className="kpi-label">Barnesenger</span><div className="kpi">{beds.filter(b => b.bed_type === 'cot').length}</div><small>For spedbarn (teller ikke som person)</small></div>
      </div>
      <p className="muted">Definer hvert rom med senger, type og størrelse. Sengeplassene bestemmer maks antall personer, og brukes til å beregne hvilke senger som skal redes for hver booking. Lavere prioritet fylles først – sett sovesofa og ekstramadrass høyt så de bare brukes ved behov.</p>
      {rooms.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: 16 }}>
          <div className="grid g2">
            <form action={A.saveRoomAction}>
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="propertyId" value={pid} />
              {(() => { const c = cap.rooms.find(x => x.id === r.id); return c ? <p style={{ margin: '0 0 10px', fontSize: '.88rem' }}><span className="badge b-warn">{c.places} sengeplasser</span>{c.limitedByRoom && <small className="muted"> · sengene har {c.bed_places} plasser, men rommet er begrenset til {r.max_capacity}</small>}</p> : null; })()}
              <div className="fields"><div><label>Rom</label><input name="name" defaultValue={r.name} /></div><div><label>Etasje</label><input name="floor" defaultValue={r.floor ?? ''} /></div>
                <div><label>Maks personer</label><input type="number" name="max_capacity" defaultValue={r.max_capacity} min={0} /></div><div><label>Rekkefølge</label><input type="number" name="sort_order" defaultValue={r.sort_order} /></div></div>
              <div className="field" style={{ marginTop: 10 }}><label>Beskrivelse</label><input name="description" defaultValue={r.description ?? ''} /></div>
              <div className="field"><label>Standard sengeinstruks</label><input name="bedding_instructions" defaultValue={r.bedding_instructions ?? ''} /></div>
              <button className="btn secondary small">Lagre rom</button>
            </form>
            <div>
              {r.photo_id ? <img src={`/api/photos/${r.photo_id}`} alt={r.name} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8 }} /> : <p className="muted">Ingen bilde av rommet.</p>}
              <form action={A.uploadPhotoAction} className="row" style={{ marginTop: 8 }}><input type="hidden" name="entity" value="room" /><input type="hidden" name="entityId" value={r.id} /><input type="hidden" name="propertyId" value={pid} />
                <ImageInput name="photo" required style={{ flex: 1 }} /><button className="btn ghost small">Last opp</button></form>
            </div>
          </div>
          <table style={{ marginTop: 14 }}><thead><tr><th>Seng</th><th>Type</th><th>Plasser</th><th>Prioritet</th><th>Størrelse (cm)</th><th>Kun barn</th><th></th></tr></thead><tbody>
            {beds.filter(b => b.room_id === r.id).map(b => (
              <tr key={b.id}><td colSpan={7} style={{ padding: 0 }}>
                <form action={A.saveBedAction} className="row" style={{ padding: 8, gap: 8, flexWrap: 'nowrap' }}>
                  <input type="hidden" name="id" value={b.id} /><input type="hidden" name="propertyId" value={pid} />
                  <input name="label" defaultValue={b.label} style={{ width: 140 }} />
                  <select name="bed_type" defaultValue={b.bed_type} style={{ width: 160 }}>{Object.entries(BED_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input type="number" name="sleeps" defaultValue={b.sleeps} min={1} max={4} style={{ width: 64 }} />
                  <input type="number" name="allocation_priority" defaultValue={b.allocation_priority} style={{ width: 70 }} />
                  <select name="size" defaultValue={b.width_cm ? `${b.width_cm}x${b.length_cm}` : ''} style={{ width: 150 }}><option value="">Størrelse</option>{BED_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}{b.width_cm && !BED_SIZES.some(([v]) => v === `${b.width_cm}x${b.length_cm}`) && <option value={`${b.width_cm}x${b.length_cm}`}>{b.width_cm} × {b.length_cm}</option>}</select>
                  <input type="checkbox" name="children_only" defaultChecked={b.children_only} />
                  <button className="btn ghost small">Lagre</button>
                  <button className="btn ghost small" formAction={A.deactivateBedAction}>Fjern</button>
                </form></td></tr>))}
            <tr><td colSpan={7} style={{ padding: 0 }}>
              <form action={A.saveBedAction} className="row" style={{ padding: 8, gap: 8, flexWrap: 'nowrap' }}>
                <input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="propertyId" value={pid} />
                <input name="label" placeholder="Ny seng" style={{ width: 140 }} />
                <select name="bed_type" style={{ width: 160 }}>{Object.entries(BED_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input type="number" name="sleeps" placeholder="plasser" min={1} max={4} style={{ width: 64 }} /><input type="number" name="allocation_priority" placeholder="prio" style={{ width: 70 }} />
                <select name="size" style={{ width: 150 }}><option value="">Størrelse</option>{BED_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><input type="checkbox" name="children_only" />
                <button className="btn small">Legg til</button>
              </form></td></tr>
          </tbody></table>
          <form action={A.deactivateRoomAction} style={{ marginTop: 8 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="propertyId" value={pid} /><button className="btn ghost small">Fjern rom</button></form>
        </div>
      ))}
      <form action={A.saveRoomAction} className="card flat" style={{ borderStyle: 'dashed' }}>
        <h3>Nytt rom</h3><input type="hidden" name="propertyId" value={pid} />
        <div className="fields"><div><label>Navn</label><input name="name" required /></div><div><label>Etasje</label><input name="floor" /></div><div><label>Maks personer</label><input type="number" name="max_capacity" defaultValue={2} /></div><div><label>Rekkefølge</label><input type="number" name="sort_order" defaultValue={rooms.length + 1} /></div></div>
        <button className="btn" style={{ marginTop: 12 }}>Legg til rom</button>
      </form>
    </>
  );
}

async function Pricing({ pid, mode, minNights }: { pid: string; mode: string; minNights: number }) {
  const cats = await q(`SELECT id, kind, name, price_per_night_ore, min_nights, max_nights, color FROM season_categories WHERE property_id=$1 ORDER BY price_per_night_ore`, [pid]);
  const periods = await q(`SELECT pp.*, to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e, sc.name AS cat, sc.color FROM pricing_periods pp JOIN season_categories sc ON sc.id=pp.season_category_id WHERE pp.property_id=$1 AND pp.active ORDER BY start_date`, [pid]);
  const los = await q(`SELECT l.id, l.min_nights, l.discount_percentage::float AS pct, sc.name AS cat FROM length_of_stay_discounts l LEFT JOIN season_categories sc ON sc.id=l.season_category_id WHERE l.property_id=$1 AND l.active ORDER BY min_nights`, [pid]);
  const addOns = await q(`SELECT * FROM add_on_items WHERE (property_id=$1 OR property_id IS NULL) AND active ORDER BY name`, [pid]);
  // Yearly overview strip (next 365 days)
  const today = todayOslo();
  const strip = Array.from({ length: 365 }, (_, i) => {
    const d = addDays(today, i);
    const p = periods.filter(x => x.s <= d && x.e >= d).sort((a, b) => b.priority - a.priority)[0];
    return { d, color: p?.color ?? null, name: p?.name };
  });
  const unpriced = strip.filter(s => !s.color).length;
  const rates = await q<{ d: string; price_ore: number; updated_at: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS d, price_ore, updated_at FROM external_nightly_rates WHERE property_id=$1 AND date >= current_date AND date < current_date + 365 ORDER BY date`, [pid]);
  const rateMap = new Map(rates.map(r => [r.d, r.price_ore]));
  const missing = strip.filter(s => !rateMap.has(s.d)).length;
  const lastUpdate = rates.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
  const fee = Number((await q<{ value: string }>(`SELECT value FROM platform_settings WHERE key='airbnb_guest_fee_pct'`))[0]?.value ?? 15);
  const next60 = strip.slice(0, 63);
  return (
    <div className="stack">
      <div className="card" style={{ borderColor: 'var(--gold-line)' }}>
        <div className="row between"><h3 style={{ margin: 0 }}>Prismodell</h3><span className="badge b-warn">{mode === 'airbnb' ? 'Følger Airbnb' : 'Egne priser'}</span></div>
        <form action={A.pricingModeAction} className="row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
          <input type="hidden" name="propertyId" value={pid} />
          <label className="check" style={{ margin: 0 }}><input type="radio" name="mode" value="airbnb" defaultChecked={mode === 'airbnb'} /> Følg Airbnb-prisene (standard)</label>
          <label className="check" style={{ margin: 0 }}><input type="radio" name="mode" value="manual" defaultChecked={mode === 'manual'} /> Sett prisene individuelt (sesongpriser)</label>
          <div style={{ width: 150 }}><label>Min. netter (standard)</label><input type="number" name="default_min_nights" min={1} defaultValue={minNights} /></div>
          <button className="btn small">Lagre</button>
        </form>
        <p className="muted" style={{ fontSize: '.85rem', marginTop: 12 }}>Med Airbnb-prising er utgangspunktet overnattingsprisen på Airbnb. Medlemmene slipper Airbnbs serviceavgift ({fee} %) og får i tillegg medlemsrabatt og lojalitetsrabatt. Sesongperiodene under brukes da kun for regler (min. netter, hel periode, byttedag).</p>
      </div>
      {mode === 'airbnb' && (
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Airbnb-priser</h3><small className="muted">{lastUpdate ? `Sist oppdatert ${new Date(lastUpdate).toLocaleDateString('nb-NO')}` : 'Ingen priser lagt inn'}</small></div>
          <p className="muted" style={{ fontSize: '.85rem' }}>Airbnb tilbyr ikke prisene via iCal eller åpent API. Legg dem inn fra Airbnb-kalenderen (periode eller lim inn), eller koble til en channel manager (Guesty/Hostaway) senere for automatisk synk. Datoer uten pris kan ikke bookes.</p>
          {missing > 0 && <p style={{ color: 'var(--danger)', fontSize: '.88rem' }}>{missing} av de neste 365 nettene mangler Airbnb-pris.</p>}
          <div className="cal" style={{ gridTemplateColumns: 'repeat(9, 1fr)', marginBottom: 18 }}>
            {next60.map(s => (<div key={s.d} className={`day ${rateMap.has(s.d) ? '' : 'urgent'}`} style={{ aspectRatio: 'auto', padding: '6px 2px' }} title={s.d}>
              <small style={{ color: 'var(--muted)' }}>{WDS[new Date(s.d + 'T12:00:00Z').getUTCDay()]} {Number(s.d.slice(8))}.{Number(s.d.slice(5, 7))}</small>
              <span style={{ fontSize: '.78rem', color: rateMap.has(s.d) ? 'var(--ink)' : 'var(--danger)' }}>{rateMap.has(s.d) ? nok(rateMap.get(s.d)!).replace(/\s?kr/, '') : '–'}</span></div>))}
          </div>
          <div className="grid g2">
            <form action={A.airbnbRangeAction}>
              <input type="hidden" name="propertyId" value={pid} />
              <h4>Sett pris for en periode</h4>
              <div className="fields"><div><label>Fra natt</label><input type="date" name="start" required /></div><div><label>Til og med natt</label><input type="date" name="end" required /></div></div>
              <div className="fields" style={{ marginTop: 10 }}><div><label>Pris søn–tor (kr)</label><input name="weekday" required /></div><div><label>Pris fre–lør (kr)</label><input name="weekend" placeholder="samme" /></div></div>
              <button className="btn small" style={{ marginTop: 12 }}>Lagre priser</button>
            </form>
            <form action={A.airbnbPasteAction}>
              <input type="hidden" name="propertyId" value={pid} />
              <h4>Lim inn priser</h4>
              <textarea name="rates" rows={5} placeholder={'2027-01-10;1890\n11.01.2027 1 890'} />
              <button className="btn small secondary" style={{ marginTop: 8 }}>Importer</button>
            </form>
          </div>
        </div>
      )}
      <div className="card">
        <h3>Årsoversikt – sesongperioder (neste 12 måneder)</h3>
        <div style={{ display: 'flex', height: 34, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {strip.map(s => <span key={s.d} title={`${fmtDate(s.d)}: ${s.name ?? 'IKKE PRISSATT'}`} style={{ flex: 1, background: s.color ?? 'var(--danger)' }} />)}
        </div>
        <div className="row between" style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 4 }}>{[0, 3, 6, 9, 12].map(m => <span key={m}>{fmtDate(addDays(today, Math.min(364, m * 30)))}</span>)}</div>
        {unpriced > 0 && mode === 'manual' && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{unpriced} dager har ingen periode og kan ikke bookes (rødt).</p>}
      </div>
      <div className="card">
        <h3>Sesonggrupper {mode === 'airbnb' && <small className="muted" style={{ fontSize: '.8rem' }}>(brukes kun ved egne priser)</small>}</h3><p className="muted" style={{ fontSize: '.88rem' }}>Ordinær pris per natt (før medlemsrabatt). Medlemsrabatten styres under Medlemsfordeler. Perioder under knytter datoer til en gruppe og kan overstyre enkeltverdier.</p>
        {cats.map(c => (
          <form key={c.id} action={A.saveCategoryAction} className="row" style={{ marginBottom: 8, flexWrap: 'nowrap', gap: 8 }}>
            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="propertyId" value={pid} />
            <input type="color" name="color" defaultValue={c.color ?? '#cccccc'} style={{ width: 44, padding: 2 }} />
            <input name="name" defaultValue={c.name} style={{ width: 140 }} />
            <label style={{ margin: 0 }}>kr/natt</label><input name="price" defaultValue={c.price_per_night_ore / 100} style={{ width: 100 }} />
            <label style={{ margin: 0 }}>min</label><input type="number" name="min_nights" defaultValue={c.min_nights} style={{ width: 64 }} />
            <label style={{ margin: 0 }}>maks</label><input type="number" name="max_nights" defaultValue={c.max_nights ?? ''} style={{ width: 64 }} />
            <button className="btn ghost small">Lagre</button>
          </form>))}
      </div>
      <div className="card">
        <h3>Perioder</h3>
        <div className="table-wrap"><table><thead><tr><th>Navn</th><th>Datoer (siste natt)</th><th>Gruppe</th><th>Overstyring</th><th>Regel</th><th>Prio</th><th></th></tr></thead><tbody>
          {periods.map(p => (
            <tr key={p.id}><td>{p.name}</td><td>{fmtDate(p.s)} – {fmtDate(p.e)}</td><td><i style={{ display: 'inline-block', width: 10, height: 10, background: p.color, borderRadius: 2 }} /> {p.cat}</td>
              <td><small>{p.price_per_night_ore != null ? nok(p.price_per_night_ore) + '/natt ' : ''}{p.min_nights ? `min ${p.min_nights} ` : ''}</small></td>
              <td><small>{p.booking_mode === 'whole_period' ? 'Hel periode' : p.booking_mode === 'fixed_changeover_day' ? `Byttedag ${WD[p.changeover_weekday]}` : 'Fleksibel'}</small></td><td>{p.priority}</td>
              <td><form action={A.deletePeriodAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="propertyId" value={pid} /><button className="btn ghost small">Fjern</button></form></td></tr>))}
        </tbody></table></div>
        <form action={A.savePeriodAction} style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <input type="hidden" name="propertyId" value={pid} />
          <div className="fields">
            <div><label>Navn</label><input name="name" required placeholder="Påske 2028" /></div>
            <div><label>Første natt</label><input type="date" name="start_date" required /></div>
            <div><label>Siste natt</label><input type="date" name="end_date" required /></div>
            <div><label>Gruppe</label><select name="season_category_id">{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label>Pris/natt (valgfri)</label><input name="price" placeholder="arv" /></div>
            <div><label>Min netter</label><input type="number" name="min_nights" placeholder="arv" /></div>
            <div><label>Maks netter</label><input type="number" name="max_nights" placeholder="arv" /></div>
            <div><label>Regel</label><select name="booking_mode"><option value="flexible">Fleksibel</option><option value="whole_period">Hel periode</option><option value="fixed_changeover_day">Fast byttedag</option></select></div>
            <div><label>Byttedag</label><select name="changeover_weekday" defaultValue="6">{WD.slice(1).map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</select></div>
            <div><label>Prioritet</label><input type="number" name="priority" defaultValue={10} /></div>
          </div>
          <button className="btn" style={{ marginTop: 12 }}>Legg til periode</button>
        </form>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>Langtidsrabatt</h3>
          <ul className="list">{los.map(l => <li key={l.id} className="row between"><span>{l.min_nights}+ netter: {l.pct} % <small>{l.cat ?? 'alle sesonger'}</small></span>
            <form action={A.saveLosAction}><input type="hidden" name="propertyId" value={pid} /><input type="hidden" name="delete" value={l.id} /><button className="btn ghost small">Fjern</button></form></li>)}</ul>
          <form action={A.saveLosAction} className="row" style={{ marginTop: 10 }}><input type="hidden" name="propertyId" value={pid} />
            <input type="number" name="min_nights" placeholder="netter" style={{ width: 90 }} /><input name="pct" placeholder="%" style={{ width: 70 }} />
            <select name="season_category_id" style={{ width: 150 }}><option value="">Alle sesonger</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="btn small">Legg til</button></form>
        </div>
        <div className="card">
          <h3>Tillegg</h3>
          {addOns.map(a => (
            <form key={a.id} action={A.saveAddOnAction} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
              <input type="hidden" name="propertyId" value={pid} /><input type="hidden" name="id" value={a.id} />
              <div className="fields">
                <div><label>Navn{a.property_id ? '' : ' (alle boliger)'}</label><input name="name" defaultValue={a.name} /></div>
                <div><label>Pris (kr)</label><input name="price" defaultValue={a.unit_price_ore / 100} /></div>
                <div><label>Pristype</label><select name="price_type" defaultValue={a.price_type}><option value="flat">Per opphold</option><option value="per_night">Per natt</option><option value="per_guest">Per gjest</option><option value="per_unit">Per stk/sett</option></select></div>
              </div>
              <div className="field" style={{ marginTop: 8 }}><label>Innhold / beskrivelse</label><input name="description" defaultValue={a.description ?? ''} /></div>
              <div className="row"><label className="check" style={{ margin: 0 }}><input type="checkbox" name="mandatory" defaultChecked={a.mandatory} /> Obligatorisk</label>
                <button className="btn ghost small">Lagre</button><ValueButton className="btn ghost small" name="deactivate" value={a.id}>Fjern</ValueButton></div>
            </form>))}
          <form action={A.saveAddOnAction} style={{ marginTop: 10 }}><input type="hidden" name="propertyId" value={pid} />
            <h4>Nytt tillegg</h4>
            <div className="fields"><div><label>Navn</label><input name="name" required /></div><div><label>Pris (kr)</label><input name="price" required /></div>
              <div><label>Pristype</label><select name="price_type"><option value="flat">Per opphold</option><option value="per_night">Per natt</option><option value="per_guest">Per gjest</option><option value="per_unit">Per stk/sett</option></select></div></div>
            <div className="field" style={{ marginTop: 8 }}><label>Innhold / beskrivelse</label><input name="description" /></div>
            <div className="row" style={{ margin: '10px 0' }}><label className="check" style={{ margin: 0 }}><input type="checkbox" name="mandatory" /> Obligatorisk</label><label className="check" style={{ margin: 0 }}><input type="checkbox" name="global" /> Gjelder alle boliger</label></div>
            <button className="btn small">Legg til</button></form>
        </div>
      </div>
    </div>
  );
}
