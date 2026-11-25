'use server';
import { run, str, int, kr, date } from '@/lib/actions';
import { assertUser, clientIp } from '@/lib/auth/current';
import { actorFor, audit } from '@/lib/audit';
import { getPool, one, q, tx } from '@/lib/db';
import { DomainError, forbidden } from '@/lib/errors';
import { approveBooking, rejectBooking, adminCancel, decideCancellation, markInvoicePaid, processRefunds, markManualRefundDone, cancelAllForMember } from '@/lib/domain/bookings';
import { createInvitation, createHelperInvitation, revokeInvitation, decideLoyalty, setMemberStatus } from '@/lib/domain/invitations';
import { createManualBlock, deleteManualBlock } from '@/lib/domain/availability';
import { adjustRewards, revokeCredit } from '@/lib/domain/rewards';
import { assignTask, overrideSleepingPlan, updatePreparation, savePhoto, reconcileCleaningTasks, skipTask, reactivateTask, setBookingCleaningSelf } from '@/lib/domain/cleaning';
import { createConnection, rotateExportToken, syncConnection } from '@/lib/channels/sync';
import { runAllJobs } from '@/lib/jobs';
import { humanCode } from '@/lib/crypto';
import { revokeAllSessions } from '@/lib/auth/sessions';
import { appUrl } from '@/lib/notify';

async function admin() {
  const u = await assertUser('admin');
  return { u, actor: actorFor(u, await clientIp()) };
}

// ------------------------------------------------ bookings
export async function approveAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(str(f, 'back') || `/admin/bookinger/${id}`, async () => { const r = await approveBooking(id, actor); return r.status === 'confirmed' ? 'Godkjent og bekreftet (dekket av bonus).' : 'Godkjent. Medlemmet har fått betalingsinstruksjoner.'; });
}
export async function rejectAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/bookinger/${id}`, async () => { await rejectBooking(id, str(f, 'reason'), actor); return 'Forespørselen er avslått.'; });
}
export async function adminCancelAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/bookinger/${id}`, async () => { if (str(f, 'confirm') !== 'ja') throw new DomainError('confirm', 'Kryss av for å bekrefte.'); await adminCancel(id, actor); return 'Bookingen er kansellert og full refusjon er satt i gang.'; });
}
export async function decideCancellationAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/bookinger/${id}`, async () => { await decideCancellation(id, str(f, 'decision') === 'approve', actor); return 'Behandlet.'; });
}
export async function adminPreparationAction(f: FormData) {
  const { actor } = await admin(); const back = str(f, 'back');
  await run(back, async () => {
    await updatePreparation(str(f, 'prepId'), { adults: int(f, 'adults'), children: int(f, 'children'), infants: int(f, 'infants'), comment: str(f, 'comment'), arrival: str(f, 'arrival') || null }, actor);
    return 'Ankomstinfo lagret.';
  });
}
export async function sleepingPlanAction(f: FormData) {
  const { actor } = await admin(); const back = str(f, 'back');
  await run(back, async () => {
    if (str(f, 'reset') === '1') { await overrideSleepingPlan(str(f, 'prepId'), null, actor); return 'Tilbake til automatisk soveplan.'; }
    const plan: { bed_id: string; persons: number; guest_type: string }[] = [];
    for (const [k, v] of f.entries()) if (k.startsWith('bed_')) { const n = parseInt(String(v), 10); if (n > 0) plan.push({ bed_id: k.slice(4), persons: n, guest_type: String(f.get('type_' + k.slice(4)) || 'adult') }); }
    await overrideSleepingPlan(str(f, 'prepId'), plan, actor);
    return 'Soveplanen er overstyrt for dette oppholdet.';
  });
}

// ------------------------------------------------ payments
export async function markInvoicePaidAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/betalinger', async () => { const r = await markInvoicePaid(str(f, 'paymentId'), actor); return r === 'confirmed' ? 'Faktura markert betalt – bookingen er bekreftet.' : 'Registrert.'; });
}
export async function retryRefundAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/betalinger', async () => {
    await getPool().query(`UPDATE refunds SET status='pending' WHERE id=$1 AND status='failed'`, [str(f, 'id')]);
    await audit(null, actor, 'refund.retry', 'refund', str(f, 'id'));
    await processRefunds([str(f, 'id')]); return 'Refusjonen er forsøkt på nytt.';
  });
}
export async function manualRefundDoneAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/betalinger', async () => { await markManualRefundDone(str(f, 'id'), actor); return 'Markert som tilbakebetalt.'; });
}
export async function goodwillRefundAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'bookingId');
  await run(`/admin/bookinger/${id}`, async () => {
    const amount = kr(f, 'amount');
    if (!amount) throw new DomainError('bad_amount', 'Oppgi beløp.');
    const p = await one<{ id: string; remaining: number }>(`SELECT id, amount_ore - refunded_amount_ore AS remaining FROM payments WHERE booking_id=$1 AND status IN ('succeeded','partially_refunded') ORDER BY created_at LIMIT 1`, [id]);
    if (!p) throw new DomainError('no_payment', 'Ingen betaling å refundere.');
    if (amount > p.remaining) throw new DomainError('too_much', 'Beløpet er høyere enn det som er betalt.');
    const r = await one<{ id: string }>(`INSERT INTO refunds (payment_id, amount_ore, reason, initiated_by_user_id) VALUES ($1,$2,'goodwill',$3) RETURNING id`, [p.id, amount, actor.id]);
    await audit(null, actor, 'refund.goodwill', 'refund', r!.id, undefined, { amount });
    await processRefunds([r!.id]); return 'Refusjon sendt.';
  });
}
export async function registerVippsWebhookAction() {
  const { actor } = await admin();
  await run('/admin/innstillinger', async () => {
    const { registerVippsWebhook, vippsConfigured } = await import('@/lib/payments/vipps');
    if (!vippsConfigured()) throw new DomainError('vipps_unconfigured', 'Vipps-nøklene mangler i Render (VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN).');
    const r = await registerVippsWebhook().catch(e => { throw new DomainError('vipps_error', `Vipps svarte med feil: ${(e as Error).message.slice(0, 200)}`); });
    await audit(null, actor, 'settings.vipps_webhook_registered', 'payment_method', null, undefined, { url: r.url });
    return `Vipps-webhook registrert (${r.url}).`;
  });
}
export async function togglePaymentMethodAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/innstillinger', async () => {
    await getPool().query(`UPDATE payment_method_settings SET enabled = NOT enabled, updated_by_user_id=$2, updated_at=now() WHERE method=$1`, [str(f, 'method'), actor.id]);
    await audit(null, actor, 'settings.payment_method_toggled', 'payment_method', null, undefined, { method: str(f, 'method') });
    return 'Oppdatert.';
  });
}

// ------------------------------------------------ members
export async function adminInviteAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/medlemmer', async () => { const r = await createInvitation(u, { email: str(f, 'email'), name: str(f, 'name'), presentationId: (v => v === 'none' ? null : /^[0-9a-f-]{36}$/i.test(v) ? v : undefined)(str(f, 'presentationId')), lang: str(f, 'lang') === 'en' ? 'en' : 'no' }, actor); return `Invitasjon sendt. Lenke: ${r.link}`; });
}
export async function adminRevokeInviteAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/medlemmer', async () => { await revokeInvitation(str(f, 'id'), u as any, actor); return 'Invitasjonen er trukket tilbake.'; });
}
export async function loyaltyDecisionAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin', async () => { await decideLoyalty(str(f, 'id'), str(f, 'decision') === 'approve', actor); return 'Søknaden er behandlet.'; });
}
export async function memberStatusAction(f: FormData) {
  const { u, actor } = await admin();
  const id = str(f, 'id'), status = str(f, 'status') as 'active' | 'suspended' | 'revoked';
  await run(`/admin/medlemmer/${id}`, async () => {
    if (id === u.id) throw new DomainError('self', 'Du kan ikke endre din egen status.');
    await setMemberStatus(id, status, actor, c => cancelAllForMember(c, id, actor));
    return status === 'active' ? 'Medlemskapet er aktivert.' : status === 'suspended' ? 'Medlemskapet er suspendert.' : 'Medlemskapet er tilbakekalt og aktive bookinger kansellert.';
  });
}
export async function grantInviteRightsAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => {
    await getPool().query(`UPDATE users SET loyalty_status='approved' WHERE id=$1 AND system_role='member'`, [id]);
    await audit(null, actor, 'user.invite_rights_granted', 'user', id); return 'Medlemmet kan nå invitere.';
  });
}
export async function cleaningExemptionAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => {
    if (str(f, 'grant') === '1') await getPool().query(`INSERT INTO member_cleaning_exemptions (user_id, granted_by_user_id, notes) VALUES ($1,$2,$3)`, [id, actor.id, str(f, 'notes') || null]);
    else await getPool().query(`UPDATE member_cleaning_exemptions SET active=false WHERE user_id=$1 AND active`, [id]);
    await audit(null, actor, str(f, 'grant') === '1' ? 'user.cleaning_exemption_granted' : 'user.cleaning_exemption_revoked', 'user', id);
    return 'Oppdatert.';
  });
}
export async function invoiceAllowedAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id'); const on = str(f, 'on') === '1';
  await run(`/admin/medlemmer/${id}`, async () => {
    await getPool().query(`UPDATE users SET invoice_allowed=$2, updated_at=now() WHERE id=$1`, [id, on]);
    await audit(null, actor, on ? 'user.invoice_allowed' : 'user.invoice_disallowed', 'user', id);
    return on ? 'Medlemmet kan nå velge faktura.' : 'Faktura er slått av for medlemmet.';
  });
}
export async function invoiceSentAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/betalinger/faktura/${id}`, async () => {
    const nr = str(f, 'fiken_nr').trim().slice(0, 40);
    if (!nr) throw new DomainError('bad', 'Skriv inn fakturanummeret fra Fiken.');
    const kid = str(f, 'kid').replace(/\s/g, '').slice(0, 25) || null;
    const r = await one(`UPDATE invoices SET status='sent', fiken_invoice_number=$2, kid_number=COALESCE($3, kid_number), sent_at=now(), sent_by_user_id=$4 WHERE id=$1 AND status IN ('draft','sent','overdue') RETURNING id`, [id, nr, kid, actor.id]);
    if (!r) throw new DomainError('bad_state', 'Fakturaen kan ikke endres.');
    await audit(null, actor, 'invoice.sent_from_fiken', 'invoice', id, undefined, { fiken_invoice_number: nr, kid });
    return 'Registrert som sendt fra Fiken.';
  });
}
export async function revokeSessionsAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => { await revokeAllSessions(id); await audit(null, actor, 'auth.sessions_revoked', 'user', id); return 'Alle økter er logget ut.'; });
}
export async function resetTotpAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => {
    await getPool().query(`UPDATE users SET totp_secret_encrypted=NULL, totp_enrolled_at=NULL, recovery_codes_hashed=NULL, failed_totp_attempts=0, locked_until=NULL WHERE id=$1`, [id]);
    await revokeAllSessions(id); await audit(null, actor, 'auth.totp_reset', 'user', id);
    return 'Tofaktor er nullstilt. Brukeren setter det opp på nytt ved neste innlogging.';
  });
}
export async function createStaffAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/medlemmer', async () => {
    const role = str(f, 'role');
    if (!['helper', 'admin'].includes(role)) throw new DomainError('bad_role', 'Ugyldig rolle.');
    if (role === 'admin' && u.system_role !== 'super_admin') throw forbidden('Kun super-admin kan opprette administratorer.');
    const email = str(f, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('bad_email', 'Ugyldig e-post.');
    const exists = await one('SELECT 1 FROM users WHERE lower(email)=$1', [email]);
    if (exists) throw new DomainError('exists', 'E-posten er allerede i bruk.');
    const row = await one<{ id: string }>(`INSERT INTO users (email, name, phone, system_role, status, referral_code) VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`, [email, str(f, 'name'), str(f, 'phone') || null, role, humanCode(8)]);
    if (role === 'helper' && str(f, 'propertyId')) await getPool().query(`INSERT INTO helper_property_assignments (helper_user_id, property_id, assigned_by_user_id) VALUES ($1,$2,$3)`, [row!.id, str(f, 'propertyId'), actor.id]);
    await audit(null, actor, `user.${role}_created`, 'user', row!.id);
    return `Konto opprettet. ${str(f, 'name')} logger inn på ${appUrl('/login')} med e-postadressen sin.`;
  });
}
export async function helperAssignmentAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => {
    const pid = str(f, 'propertyId');
    if (str(f, 'remove') === '1') await getPool().query(`UPDATE helper_property_assignments SET active=false WHERE helper_user_id=$1 AND property_id=$2 AND active`, [id, pid]);
    else await getPool().query(`INSERT INTO helper_property_assignments (helper_user_id, property_id, assigned_by_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, pid, actor.id]);
    if (f.has('scope')) await getPool().query(`UPDATE users SET cleaning_scope=$2 WHERE id=$1 AND system_role='helper'`, [id, str(f, 'scope')]);
    await audit(null, actor, 'helper.assignment_changed', 'user', id, undefined, { pid, scope: str(f, 'scope') });
    return 'Oppdatert.';
  });
}
export async function helperScopeAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => {
    await getPool().query(`UPDATE users SET cleaning_scope=$2 WHERE id=$1 AND system_role='helper'`, [id, str(f, 'scope') === 'all' ? 'all' : 'assigned']);
    await audit(null, actor, 'helper.scope_changed', 'user', id, undefined, { scope: str(f, 'scope') }); return 'Tilgang oppdatert.';
  });
}

export async function inviteHelperAction(f: FormData) {
  const { u, actor } = await admin();
  await run('/admin/medlemmer', async () => {
    const r = await createHelperInvitation(u, { email: str(f, 'email'), name: str(f, 'name'), propertyId: str(f, 'propertyId') || null }, actor);
    return `Invitasjon sendt til renholder. Hun registrerer seg selv med navn og mobil. Lenke: ${r.link}`;
  });
}
export async function memberDiscountAction(f: FormData) {
  const { actor } = await admin(); const id = str(f, 'id');
  await run(`/admin/medlemmer/${id}`, async () => {
    const raw = str(f, 'pct').replace(',', '.');
    const v = raw === '' || f.get('reset') ? null : Number(raw);
    if (v !== null && !(v >= 0 && v <= 100)) throw new DomainError('bad', 'Rabatt må være mellom 0 og 100 %.');
    const before = await one('SELECT member_discount_override_pct FROM users WHERE id=$1', [id]);
    await getPool().query('UPDATE users SET member_discount_override_pct=$2, updated_at=now() WHERE id=$1', [id, v]);
    await audit(null, actor, 'user.discount_override', 'user', id, before, { member_discount_override_pct: v });
    return v === null ? 'Medlemmet følger nå standardrabatten.' : `Personlig grunnrabatt satt til ${v} %.`;
  });
}

export async function inquiryStatusAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/foresporsler', async () => {
    const status = str(f, 'status');
    if (!['new', 'contacted', 'closed'].includes(status)) throw new DomainError('bad', 'Ugyldig status.');
    await getPool().query('UPDATE long_term_inquiries SET status=$2 WHERE id=$1', [str(f, 'id'), status]);
    await audit(null, actor, 'inquiry.status_changed', 'long_term_inquiry', str(f, 'id'), undefined, { status });
    return 'Oppdatert.';
  });
}

// ------------------------------------------------ rewards
export async function adjustRewardAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/bonus', async () => {
    const amount = Math.round(Number(str(f, 'amount').replace(',', '.')) * 100);
    await adjustRewards(str(f, 'userId'), amount, str(f, 'note'), actor); return 'Bonus justert.';
  });
}
export async function revokeRewardAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/bonus', async () => { await revokeCredit(str(f, 'id'), actor); return 'Bonusen er trukket tilbake.'; });
}

// ------------------------------------------------ settings
const SETTING_KEYS = ['company_org_nr', 'company_address', 'company_phone', 'company_email', 'booking_hold_duration_hours', 'invoice_due_date_days', 'cancellation_approval_timeout_hours', 'ical_poll_interval_minutes', 'ical_failure_alert_threshold',
  'invitation_validity_days', 'referral_reward_type', 'referral_reward_referrer_ore', 'referral_reward_referred_ore', 'referral_reward_percentage', 'referral_reward_max_ore',
  'referral_reward_vesting_days', 'referral_reward_validity_days', 'referral_min_qualifying_amount_ore', 'audit_log_retention_days', 'notification_log_retention_days', 'short_turnaround_hours', 'invoice_bank_account', 'company_name', 'member_base_discount_pct', 'airbnb_guest_fee_pct', 'referral_reward_max_unused', 'member_loyalty_step_pct', 'member_loyalty_max_pct', 'cleaning_same_day_reminder_hour', 'long_term_contact_email', 'invitation_weekly_limit'];
export async function saveSettingsAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/innstillinger', async () => {
    await tx(async c => {
      for (const k of SETTING_KEYS) {
        if (!f.has(k)) continue;
        let v = str(f, k);
        if (k.endsWith('_ore')) v = String(Math.round(Number(v.replace(',', '.')) * 100));
        if (k === 'referral_reward_type' && !['fixed', 'percentage'].includes(v)) throw new DomainError('bad', 'Ugyldig bonustype.');
        if (k === 'long_term_contact_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new DomainError('bad', 'Ugyldig e-postadresse.');
        if (k === 'company_email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new DomainError('bad', 'Ugyldig e-postadresse.');
        if (k === 'company_org_nr' && v && !/^\d{3} ?\d{3} ?\d{3}$/.test(v)) throw new DomainError('bad', 'Organisasjonsnummer må være 9 siffer.');
        if (!['referral_reward_type', 'invoice_bank_account', 'company_name', 'long_term_contact_email', 'company_org_nr', 'company_address', 'company_phone', 'company_email'].includes(k) && (!Number.isFinite(Number(v)) || Number(v) < 0)) throw new DomainError('bad', `Ugyldig verdi for ${k}.`);
        const before = await one<{ value: string }>('SELECT value FROM platform_settings WHERE key=$1', [k], c);
        if (before?.value === v) continue;
        await c.query(`INSERT INTO platform_settings (key, value, updated_by_user_id, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_by_user_id=$3, updated_at=now()`, [k, v, actor.id]);
        await audit(c, actor, 'settings.changed', 'platform_setting', null, { key: k, value: before?.value }, { key: k, value: v });
      }
    });
    return 'Innstillingene er lagret.';
  });
}
export async function runJobsNowAction() {
  await admin();
  await run('/admin/innstillinger', async () => { await runAllJobs(); return 'Bakgrunnsjobbene er kjørt.'; });
}

// ------------------------------------------------ calendar
export async function manualBlockAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/kalender', async () => {
    const pid = str(f, 'propertyId');
    await createManualBlock(pid, date(f, 'start'), date(f, 'end'), str(f, 'reason'), actor);
    return 'Datoene er sperret og sendes til tilkoblede kanaler ved neste henting.';
  });
}
export async function removeBlockAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/kalender', async () => { await deleteManualBlock(str(f, 'id'), actor); return 'Sperringen er fjernet.'; });
}

// ------------------------------------------------ channels
export async function createConnectionAction(f: FormData) {
  const { actor } = await admin(); const pid = str(f, 'propertyId');
  await run(`/admin/kanaler`, async () => {
    const r = await createConnection({ propertyId: pid, channel: str(f, 'channel'), displayName: str(f, 'displayName'), mode: str(f, 'mode'), icalUrl: str(f, 'icalUrl') }, actor);
    if (r.exportToken) return { redirect: `/admin/kanaler?ny_eksport=${encodeURIComponent(appUrl('/api/ical/' + r.exportToken + '.ics'))}`, ok: 'Eksportfeed opprettet. Kopier lenken nå – den vises bare én gang.' };
    try { await syncConnection(r.id, actor); return 'Kanal koblet til og synkronisert.'; } catch { return 'Kanal lagt til, men første synk feilet – se status.'; }
  });
}
export async function syncNowAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/kanaler', async () => { const r: any = await syncConnection(str(f, 'id'), actor); return r.skipped ? 'Denne koblingen synkroniseres ikke fra vår side.' : `Synk OK: ${r.added} nye, ${r.removed} fjernet${r.conflicts ? `, ${r.conflicts} KONFLIKT(ER)` : ''}.`; });
}
export async function rotateTokenAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/kanaler', async () => { const t = await rotateExportToken(str(f, 'id'), actor); return { redirect: `/admin/kanaler?ny_eksport=${encodeURIComponent(appUrl('/api/ical/' + t + '.ics'))}`, ok: 'Ny lenke laget. Den gamle virker ikke lenger – oppdater den hos kanalen.' }; });
}
export async function toggleConnectionAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/kanaler', async () => {
    const r = await one<{ property_id: string; active: boolean }>(`UPDATE channel_connections SET active = NOT active WHERE id=$1 RETURNING property_id, active`, [str(f, 'id')]);
    if (r && !r.active) {
      // Deactivating an import removes its blocks (dates become bookable again)
      await tx(async c => {
        await c.query(`DELETE FROM availability_blocks WHERE source_connection_id=$1`, [str(f, 'id')]);
        await c.query(`UPDATE external_calendar_events SET sync_state='removed', removed_at=now() WHERE connection_id=$1 AND sync_state<>'removed'`, [str(f, 'id')]);
        await reconcileCleaningTasks(c, r.property_id);
      });
    }
    await audit(null, actor, 'channel.toggled', 'channel_connection', str(f, 'id'), undefined, { active: r?.active });
    return r?.active ? 'Koblingen er aktivert.' : 'Koblingen er deaktivert og dens sperringer fjernet.';
  });
}
export async function classifyEventAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/kanaler', async () => {
    const r = await one<{ property_id: string }>(`UPDATE external_calendar_events SET block_kind=$2 WHERE id=$1 RETURNING property_id`, [str(f, 'id'), str(f, 'kind')]);
    if (r) await tx(c => reconcileCleaningTasks(c, r.property_id));
    await audit(null, actor, 'channel.event_classified', 'external_calendar_event', str(f, 'id'), undefined, { kind: str(f, 'kind') });
    return 'Oppdatert.';
  });
}

// ------------------------------------------------ cleaning
export async function assignTaskAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/renhold', async () => { await assignTask(str(f, 'id'), str(f, 'helperId') || null, actor); return 'Oppgaven er tildelt.'; });
}
export async function skipTaskAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/renhold', async () => { await skipTask(str(f, 'id'), str(f, 'reason'), actor); return 'Vaskejobben er slått av. Renholderen er varslet.'; });
}
export async function reactivateTaskAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/renhold', async () => { await reactivateTask(str(f, 'id'), actor); return 'Vaskejobben er slått på igjen.'; });
}
export async function bookingCleaningSelfAction(f: FormData) {
  const { actor } = await admin();
  const id = str(f, 'id');
  await run(`/admin/bookinger/${id}`, async () => {
    const on = str(f, 'on') === '1';
    const r = await setBookingCleaningSelf(id, on, actor);
    if (!on) return 'Vanlig sluttrengjøring er satt tilbake.';
    return r.priceLocked
      ? 'Vaskejobben er slått av. Prisen var allerede låst – refunder sluttrengjøringen under Betalinger hvis gjesten ikke skal betale den.'
      : 'Gjesten vasker selv: sluttrengjøringen fjernes fra prisen når bookingen godkjennes, og det lages ingen vaskejobb.';
  });
}
export async function taskNotesAction(f: FormData) {
  const { actor } = await admin();
  await run(str(f, 'back') || '/admin/renhold', async () => {
    await getPool().query(`UPDATE cleaning_tasks SET notes=$2, updated_at=now() WHERE id=$1`, [str(f, 'id'), str(f, 'notes') || null]);
    await audit(null, actor, 'cleaning.notes_updated', 'cleaning_task', str(f, 'id')); return 'Instruksjon lagret.';
  });
}
export async function resolveReportAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/renhold', async () => {
    await getPool().query(`UPDATE cleaning_reports SET resolved_at=now(), resolved_by_user_id=$2 WHERE id=$1`, [str(f, 'id'), actor.id]);
    await audit(null, actor, 'cleaning.report_resolved', 'cleaning_report', str(f, 'id')); return 'Markert som løst.';
  });
}
export async function manualTaskAction(f: FormData) {
  const { actor } = await admin();
  await run('/admin/renhold', async () => {
    const r = await one<{ id: string }>(`INSERT INTO cleaning_tasks (property_id, source_type, channel_name, checkout_date, notes, assigned_to_user_id, status) VALUES ($1,'manual','Manuell',$2,$3,$4, CASE WHEN $4::uuid IS NULL THEN 'open' ELSE 'assigned' END) RETURNING id`,
      [str(f, 'propertyId'), date(f, 'date'), str(f, 'notes') || null, str(f, 'helperId') || null]);
    await audit(null, actor, 'cleaning.manual_task_created', 'cleaning_task', r!.id); return 'Oppgave opprettet.';
  });
}
