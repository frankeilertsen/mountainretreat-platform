import Link from 'next/link';
import { getT } from '@/lib/i18n/lang';
import { LangSwitch } from '@/components/LangSwitch';
import { q, one } from '@/lib/db';
import { getStr, getNum } from '@/lib/settings';
import { termsSections } from '@/lib/i18n/terms';

export const metadata = { title: 'Salgsvilkår' };
export const dynamic = 'force-dynamic';

/** Public terms of sale (required by Vipps MobilePay and the consumer rules). Figures follow the live settings. */
export default async function Terms() {
  const { lang, t } = await getT();
  const [company, orgNr, address, phone, email, holdHours, cancelTimeoutHours] = await Promise.all([
    getStr('company_name', 'FKE Property AS'), getStr('company_org_nr', ''), getStr('company_address', ''), getStr('company_phone', ''),
    getStr('company_email', 'post@mountainretreat.no'), getNum('booking_hold_duration_hours', 48), getNum('cancellation_approval_timeout_hours', 48),
  ]);
  const tiers = (await q<{ min: number; max: number | null; pct: string; approval: boolean }>(
    `SELECT days_before_checkin_min AS min, days_before_checkin_max AS max, refund_percentage AS pct, requires_admin_approval AS approval
     FROM cancellation_policy_tiers WHERE active AND property_id IS NULL ORDER BY days_before_checkin_min DESC`)).map(r => ({ ...r, pct: Number(r.pct) }));
  const times = await one<{ cin: string; cout: string }>(`SELECT to_char(check_in_time,'HH24:MI') AS cin, to_char(check_out_time,'HH24:MI') AS cout FROM properties ORDER BY created_at LIMIT 1`);
  const feePct = await getNum('cancellation_payment_fee_pct', 2.99), feeFixedKr = Math.round(await getNum('cancellation_payment_fee_fixed_ore', 200) / 100);
  const T = termsSections(lang, { company, orgNr, address, phone, email, holdHours, cancelTimeoutHours, feePct, feeFixedKr, tiers, checkIn: times?.cin ?? '15:00', checkOut: times?.cout ?? '11:00' });
  return (
    <div className="narrow terms" style={{ position: 'relative' }}>
      <LangSwitch lang={lang} className="lang-corner" />
      <Link href="/" className="btn ghost small" style={{ marginBottom: 28 }}>{t.common.home}</Link>
      <span className="eyebrow">{company}</span>
      <h1>{T.title}</h1>
      <p className="muted">{T.updated}</p>
      <p>{T.lead}</p>
      {T.sections.map(s => (
        <section key={s.h} style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: '1.35rem' }}>{s.h}</h2>
          {s.p.map((p, i) => Array.isArray(p)
            ? <ul key={i}>{p.map((li, j) => <li key={j}>{li}</li>)}</ul>
            : <p key={i}>{p}</p>)}
        </section>
      ))}
      <p className="muted" style={{ marginTop: 32, fontSize: '.85rem' }}><Link href="/personvern">{t.common.privacy}</Link></p>
    </div>
  );
}
