'use server';
import { redirect } from 'next/navigation';
import { str, int } from '@/lib/actions';
import { clientIp } from '@/lib/auth/current';
import { submitLongTermInquiry } from '@/lib/domain/inquiries';
import { issueChallenge, type Challenge } from '@/lib/captcha';
import { DomainError } from '@/lib/errors';
import { translateMessage } from '@/lib/i18n/messages';

export type LeaseFormState = { error?: string; values?: Record<string, string>; challenge?: Challenge; n: number };

/** Long-term enquiry. On error the form is shown again with what the visitor typed and a new verification code. */
export async function longTermInquiryAction(prev: LeaseFormState, f: FormData): Promise<LeaseFormState> {
  const ip = await clientIp();
  const lang = str(f, 'lang') === 'en' ? 'en' : 'no';
  try {
    await submitLongTermInquiry({
      name: str(f, 'name'), email: str(f, 'email'), phone: str(f, 'phone'), propertyId: str(f, 'propertyId') || null,
      moveIn: str(f, 'moveIn') || null, duration: str(f, 'duration'), persons: int(f, 'persons') || null,
      message: str(f, 'message'), consent: !!f.get('consent'), website: str(f, 'website'), lang,
      captcha: { token: str(f, 'captchaToken'), answer: str(f, 'captcha'), turnstile: str(f, 'cf-turnstile-response') },
    }, ip);
  } catch (e) {
    if (!(e instanceof DomainError)) console.error('[lease enquiry]', e);
    const msg = e instanceof DomainError ? e.message : 'Noe gikk galt. Prøv igjen, eller kontakt administrator.';
    const values: Record<string, string> = {};
    for (const k of ['name', 'email', 'phone', 'propertyId', 'moveIn', 'duration', 'persons', 'message']) values[k] = str(f, k);
    if (f.get('consent')) values.consent = '1';
    return { error: translateMessage(msg, lang), values, challenge: issueChallenge(), n: prev.n + 1 };
  }
  redirect('/fast-leie?sendt=1');
}
