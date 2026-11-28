import { q } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { fmtDateTime } from '@/lib/format';
import { Flash, Status } from '@/components/ui';
import { saveSettingsAction, toggleAutoApproveAction, togglePaymentMethodAction, runJobsNowAction, registerVippsWebhookAction } from '../../actions/admin';
import { vippsConfigured, vippsEnv, vippsWebhookInfo } from '@/lib/payments/vipps';
import { stripeProvider } from '@/lib/domain/payments';
import { saveCancellationTierAction } from '../../actions/properties';
import { hoursText } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Innstillinger' };
const FIELDS: [string, string][] = [
  ['company_name', 'Firmanavn'], ['company_org_nr', 'Organisasjonsnummer'], ['company_address', 'Forretningsadresse'], ['company_phone', 'Telefon'], ['company_email', 'E-post for kunder'],
  ['booking_hold_duration_hours', 'Betalingsfrist etter booking/godkjenning (timer)'],
  ['cancellation_approval_timeout_hours', 'Frist for å behandle kansellering (timer)'],
  ['cancellation_payment_fee_pct', 'Betalingsgebyr som trekkes ved avbestilling (%)'], ['cancellation_payment_fee_fixed_ore', 'Betalingsgebyr, fast del (i øre – 200 = 2 kr)'], ['invitation_validity_days', 'Invitasjon gyldig (dager)'],
  ['ical_poll_interval_minutes', 'Hent kanalkalendere hvert (minutt)'], ['ical_failure_alert_threshold', 'Varsle etter antall feilede synker'],
  ['short_turnaround_hours', 'Kort snutid – varsle renhold (timer)'], ['cleaning_same_day_reminder_hour', 'Påminnelse til renholder samme dag (klokkeslett, time)'], ['audit_log_retention_days', 'Revisjonslogg lagres (dager)'],
  ['notification_log_retention_days', 'Varsellogg lagres (dager)'], ['long_term_contact_email', 'E-post for forespørsler om fast leie'],
];

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const s = await getSettings();
  const methods = await q(`SELECT method, enabled FROM payment_method_settings WHERE method <> 'invoice' ORDER BY method`);
  const vippsHook = vippsConfigured() ? await vippsWebhookInfo() : null;
  const ready: Record<string, boolean> = { stripe_card: stripeProvider.configured(), vipps: vippsConfigured() && !!vippsHook };
  const tiers = await q(`SELECT * FROM cancellation_policy_tiers WHERE active AND property_id IS NULL ORDER BY days_before_checkin_min DESC`);
  const jobs = await q(`SELECT DISTINCT ON (job) job, status, started_at, detail FROM job_runs ORDER BY job, started_at DESC`);
  return (
    <>
      <div className="page-head"><h1>Innstillinger</h1></div>
      <Flash sp={sp} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <form action={saveSettingsAction} className="card">
          <h3>Plattform</h3>
          {FIELDS.map(([k, l]) => <div key={k} className="field"><label>{l}</label><input name={k} defaultValue={s[k]} /></div>)}
          <button className="btn">Lagre</button>
        </form>
        <div className="stack">
          <div className="card"><h3>Bookinggodkjenning</h3>
            {(() => { const auto = s.booking_auto_approve === '1'; return (
              <form action={toggleAutoApproveAction} className="row between" style={{ gap: 12 }}>
                <span>{auto ? <><strong>Direktebooking</strong><br /><small className="muted">Medlemmer booker selv. Prisen låses og datoene holdes av i {hoursText(Number(s.booking_hold_duration_hours ?? 1))} mens de betaler. Du får e-post om hver booking.</small></>
                  : <><strong>Forhåndsgodkjenning</strong><br /><small className="muted">Hver booking venter på at du godkjenner den før medlemmet kan betale.</small></>}</span>
                <span className="row"><span className={`badge ${auto ? 'b-ok' : 'b-warn'}`}>{auto ? 'Direkte' : 'Godkjenning'}</span><input type="hidden" name="on" value={auto ? '0' : '1'} /><button className="btn ghost small">{auto ? 'Krev godkjenning' : 'Slå på direktebooking'}</button></span>
              </form>); })()}
            <small className="muted" style={{ display: 'block', marginTop: 8 }}>Gjelder nye bookinger. Bookinger som allerede venter på godkjenning, behandler du som før.</small>
          </div>
          <div className="card"><h3>Betalingsmåter</h3>{methods.map(m => (
            <form key={m.method} action={togglePaymentMethodAction} className="row between" style={{ padding: '6px 0' }}><span>{{ stripe_card: 'Kort (Stripe)', vipps: 'Vipps' }[m.method as string]}<br /><small className="muted">{ready[m.method as string] ? 'Koblet til' : m.method === 'stripe_card' ? 'Mangler Stripe-nøkler (testbetaling brukes)' : !vippsConfigured() ? 'Mangler Vipps-nøkler – vises ikke for medlemmer' : 'Webhook ikke registrert'}</small></span>
              <span className="row"><span className={`badge ${m.enabled ? 'b-ok' : ''}`}>{m.enabled ? 'På' : 'Av'}</span><input type="hidden" name="method" value={m.method} /><button className="btn ghost small">{m.enabled ? 'Slå av' : 'Slå på'}</button></span></form>))}
            {vippsConfigured() && <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
              <small className="muted">Vipps: {vippsEnv() === 'production' ? 'produksjon' : 'testmiljø'}{vippsHook ? ` · webhook registrert ${fmtDateTime(vippsHook.registered_at)}` : ' · webhook ikke registrert'}</small>
              <form action={registerVippsWebhookAction} style={{ marginTop: 6 }}><button className="btn ghost small">{vippsHook ? 'Registrer webhook på nytt' : 'Registrer Vipps-webhook'}</button></form>
            </div>}</div>
          <div className="card"><h3>Kanselleringsvilkår</h3>
            <ul className="list">{tiers.map(t => <li key={t.id} className="row between"><span>{t.days_before_checkin_min}{t.days_before_checkin_max != null ? `–${t.days_before_checkin_max}` : '+'} dager før: <strong>{Number(t.refund_percentage)} %</strong> refusjon{t.requires_admin_approval ? ' · må godkjennes' : ''}</span>
              <form action={saveCancellationTierAction}><input type="hidden" name="deactivate" value={t.id} /><button className="btn ghost small">Fjern</button></form></li>)}</ul>
            <form action={saveCancellationTierAction} className="row" style={{ marginTop: 10 }}><input name="min" type="number" placeholder="fra dag" style={{ width: 80 }} required /><input name="max" type="number" placeholder="til dag" style={{ width: 80 }} /><input name="pct" placeholder="%" style={{ width: 60 }} required />
              <label className="check" style={{ margin: 0 }}><input type="checkbox" name="approval" /> godkjenning</label><button className="btn small">Legg til</button></form></div>
          <div className="card"><h3>Bakgrunnsjobber</h3>
            <ul className="list">{jobs.map(j => <li key={j.job} className="row between"><span>{j.job}<br /><small className="muted">{fmtDateTime(j.started_at)}</small></span><Status s={j.status} /></li>)}</ul>
            {jobs.length === 0 && <p className="muted">Ingen kjøringer ennå. Sett opp cron mot /api/cron (se README).</p>}
            <form action={runJobsNowAction}><button className="btn ghost small">Kjør alle nå</button></form></div>
        </div>
      </div>
    </>
  );
}
