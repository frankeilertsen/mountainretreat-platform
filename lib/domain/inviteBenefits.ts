import { Db, getPool } from '../db';
import { getSettings } from '../settings';
import { rewardTerms } from './memberOverview';

export type Lang = 'no' | 'en';

/**
 * The member benefits as told to someone who has been invited (invitation e-mail and invitation page).
 * Not shown on public pages – only to invitees and logged-in members.
 */
export async function inviteBenefits(lang: Lang = 'no', db: Db = getPool()): Promise<{ title: string; text: string }[]> {
  const s = await getSettings(db);
  const t = await rewardTerms(db, lang);
  const fee = s.airbnb_guest_fee_pct, base = s.member_base_discount_pct, max = s.member_loyalty_max_pct, step = s.member_loyalty_step_pct;
  return lang === 'en' ? [
    { title: 'No Airbnb service fee', text: `You book directly with us and avoid Airbnb’s service fee of approx. ${fee} %.` },
    { title: `${base} % member discount`, text: `All members get ${base} % off the nightly price, on top of not paying the service fee.` },
    { title: `Loyalty discount up to ${max} %`, text: `Starts at 0 % and increases by ${step} % for every booking you make, up to an extra ${max} %.` },
    { title: 'Bonus for you – and for your friends', text: `After your first stay, you receive ${t.referred} and the person who invited you ${t.referrer} off a future booking. Once you are approved to invite others, you earn ${t.referrer} for each friend’s first stay.` },
  ] : [
    { title: 'Ingen Airbnb-avgift', text: `Du booker direkte hos oss og slipper Airbnbs serviceavgift på ca. ${fee} %.` },
    { title: `${base} % medlemsrabatt`, text: `Alle medlemmer får ${base} % rabatt på nattprisen, i tillegg til at serviceavgiften faller bort.` },
    { title: `Lojalitetsrabatt opptil ${max} %`, text: `Starter på 0 % og øker med ${step} % for hver booking du gjør, opptil ${max} % ekstra.` },
    { title: 'Bonus til deg – og vennene dine', text: `Etter ditt første opphold får du ${t.referred} og den som inviterte deg ${t.referrer} i rabatt på en senere booking. Når du er godkjent for å invitere andre, får du ${t.referrer} for hver venns første opphold.` },
  ];
}
