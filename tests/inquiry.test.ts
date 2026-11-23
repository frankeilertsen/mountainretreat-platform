import { describe, it, expect } from 'vitest';
import { one, q } from '../lib/db';
import { submitLongTermInquiry } from '../lib/domain/inquiries';

describe('long-term rental enquiry', () => {
  it('stores the enquiry, e-mails the configured address with reply-to, and confirms to the sender', async () => {
    const r = await submitLongTermInquiry({ name: 'Per Leietaker', email: 'Per@Example.no', phone: '91234567', message: 'Vi ønsker å leie fra mars i ett år.', duration: '6–12 måneder', persons: 3, consent: true }, '10.1.1.1');
    expect(r.id).toBeTruthy();
    const mails = await q<{ to_address: string; payload: any; type: string }>(`SELECT to_address, payload, type FROM notifications WHERE type LIKE 'long_term_inquiry%' ORDER BY type`);
    expect(mails.map(m => m.to_address)).toEqual(['frank@mountainretreat.no', 'per@example.no']);
    expect(mails[0].payload.replyTo).toBe('per@example.no');
  });
  it('validates input, ignores bots (honeypot) and rate-limits', async () => {
    await expect(submitLongTermInquiry({ name: 'A', email: 'x@y.no', message: 'kort', consent: true }, '10.1.1.2')).rejects.toThrow(/navnet/);
    await expect(submitLongTermInquiry({ name: 'Ola', email: 'ola@y.no', message: 'En lang nok melding her', consent: false }, '10.1.1.2')).rejects.toThrow(/samtykke/);
    const bot = await submitLongTermInquiry({ name: 'Bot', email: 'bot@spam.no', message: 'Buy cheap stuff now!!!', consent: true, website: 'http://spam' }, '10.1.1.3');
    expect(bot.id).toBeNull();
    expect(await one(`SELECT 1 FROM long_term_inquiries WHERE email='bot@spam.no'`)).toBeNull();
    for (let i = 0; i < 3; i++) await submitLongTermInquiry({ name: 'Kari', email: 'kari@y.no', message: 'Hei, jeg lurer på langtidsleie.', consent: true }, `10.2.0.${i}`);
    await expect(submitLongTermInquiry({ name: 'Kari', email: 'kari@y.no', message: 'Hei, jeg lurer på langtidsleie.', consent: true }, '10.2.0.9')).rejects.toThrow(/For mange/);
  });
});
