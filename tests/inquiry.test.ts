import { describe, it, expect } from 'vitest';
import { one, q } from '../lib/db';
import { submitLongTermInquiry } from '../lib/domain/inquiries';
import { createBuiltinChallenge, verifyChallenge } from '../lib/captcha';

/** A correctly solved verification code, issued 10 s ago (as if a person filled in the form). */
const solved = () => { const c = createBuiltinChallenge(Date.now() - 10_000); return { token: c.token, answer: c.answer.toLowerCase() }; };

describe('long-term rental enquiry', () => {
  it('stores the enquiry, e-mails the configured address with reply-to, and confirms to the sender', async () => {
    const r = await submitLongTermInquiry({ name: 'Per Leietaker', email: 'Per@Example.no', phone: '91234567', message: 'Vi ønsker å leie fra mars i ett år.', duration: '6–12 måneder', persons: 3, consent: true, captcha: solved() }, '10.1.1.1');
    expect(r.id).toBeTruthy();
    const mails = await q<{ to_address: string; payload: any; type: string }>(`SELECT to_address, payload, type FROM notifications WHERE type LIKE 'long_term_inquiry%' ORDER BY type`);
    expect(mails.map(m => m.to_address)).toEqual(['frank@mountainretreat.no', 'per@example.no']);
    expect(mails[0].payload.replyTo).toBe('per@example.no');
  });
  it('validates input, ignores bots (honeypot) and rate-limits', async () => {
    await expect(submitLongTermInquiry({ name: 'A', email: 'x@y.no', message: 'kort', consent: true, captcha: solved() }, '10.1.1.2')).rejects.toThrow(/navnet/);
    await expect(submitLongTermInquiry({ name: 'Ola', email: 'ola@y.no', message: 'En lang nok melding her', consent: false, captcha: solved() }, '10.1.1.2')).rejects.toThrow(/samtykke/);
    const bot = await submitLongTermInquiry({ name: 'Bot', email: 'bot@spam.no', message: 'Buy cheap stuff now!!!', consent: true, website: 'http://spam' }, '10.1.1.3');
    expect(bot.id).toBeNull();
    expect(await one(`SELECT 1 FROM long_term_inquiries WHERE email='bot@spam.no'`)).toBeNull();
    for (let i = 0; i < 3; i++) await submitLongTermInquiry({ name: 'Kari', email: 'kari@y.no', message: 'Hei, jeg lurer på langtidsleie.', consent: true, captcha: solved() }, `10.2.0.${i}`);
    await expect(submitLongTermInquiry({ name: 'Kari', email: 'kari@y.no', message: 'Hei, jeg lurer på langtidsleie.', consent: true, captcha: solved() }, '10.2.0.9')).rejects.toThrow(/For mange/);
  });
  it('requires a correct, fresh, single-use verification code', async () => {
    const base = { name: 'Lise', email: 'lise@y.no', message: 'Hei, jeg lurer på langtidsleie.', consent: true };
    // missing, wrong, too fast, expired
    await expect(submitLongTermInquiry({ ...base }, '10.3.0.1')).rejects.toThrow(/mangler/);
    const c = createBuiltinChallenge(Date.now() - 10_000);
    await expect(submitLongTermInquiry({ ...base, captcha: { token: c.token, answer: 'XXXXX' } }, '10.3.0.2')).rejects.toThrow(/Feil bekreftelseskode/);
    // the picture is burnt after one attempt, even with the right answer afterwards
    await expect(submitLongTermInquiry({ ...base, captcha: { token: c.token, answer: c.answer } }, '10.3.0.3')).rejects.toThrow(/allerede brukt/);
    const fast = createBuiltinChallenge();
    await expect(verifyChallenge({ token: fast.token, answer: fast.answer }, null)).rejects.toThrow(/for raskt/);
    const old = createBuiltinChallenge(Date.now() - 25 * 60_000);
    await expect(verifyChallenge({ token: old.token, answer: old.answer }, null)).rejects.toThrow(/utløpt/);
    // forged token (answer swapped into another signature) is rejected
    const a = createBuiltinChallenge(Date.now() - 10_000), b = createBuiltinChallenge(Date.now() - 10_000);
    const [n, t] = a.token.split('.'), forged = `${n}.${t}.${b.token.split('.')[2]}`;
    await expect(verifyChallenge({ token: forged, answer: b.answer }, null)).rejects.toThrow(/Feil/);
    // case and spaces don't matter for a person
    const ok = createBuiltinChallenge(Date.now() - 10_000);
    await expect(verifyChallenge({ token: ok.token, answer: ` ${ok.answer.toLowerCase().split('').join(' ')} ` }, null)).resolves.toBeUndefined();
    expect(await one(`SELECT 1 FROM long_term_inquiries WHERE email='lise@y.no'`)).toBeNull();
  });
});
