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
  const same = t.referred === t.referrer;
  const fee = s.airbnb_guest_fee_pct, base = s.member_base_discount_pct, max = s.member_loyalty_max_pct, step = s.member_loyalty_step_pct;
  return lang === 'en' ? [
    { title: 'No Airbnb service fee', text: `You book directly with us and avoid Airbnb’s service fee of approx. ${fee} %.` },
    { title: `${base} % member discount`, text: `All members get ${base} % off the price per night. On top of that, you avoid the service fee you would otherwise pay on Airbnb or other booking platforms.` },
    { title: `Loyalty discount up to ${max} %`, text: `Starts at 0 % and increases by ${step} % for every booking you make, up to an extra ${max} %.` },
    { title: 'Bonus for you – and for your friends', text: `${same ? `After your first stay, you and the person who invited you each receive ${t.referred}` : `After your first stay, you receive ${t.referred} and the person who invited you ${t.referrer}`} off a future booking. Once you are approved to invite others yourself, you earn ${t.referrer} for every friend you invite who books their first stay – and your friend gets ${t.referred} too. This is where being an ambassador becomes both enjoyable and rewarding – as long as you are happy yourself and believe in what we offer.` },
  ] : [
    { title: 'Ingen Airbnb-avgift', text: `Du booker direkte hos oss og slipper Airbnbs serviceavgift på ca. ${fee} %.` },
    { title: `${base} % medlemsrabatt`, text: `Alle medlemmer får ${base} % rabatt på overnattingsprisen (prisen per natt). I tillegg slipper du serviceavgiften du ellers betaler på Airbnb eller andre bookingplattformer.` },
    { title: `Lojalitetsrabatt opptil ${max} %`, text: `Starter på 0 % og øker med ${step} % for hver booking du gjør, opptil ${max} % ekstra.` },
    { title: 'Bonus til deg – og vennene dine', text: `${same ? `Etter ditt første opphold får både du og den som inviterte deg ${t.referred} hver` : `Etter ditt første opphold får du ${t.referred} og den som inviterte deg ${t.referrer}`} i rabatt på en senere booking. Når du selv er godkjent for å invitere, får du ${t.referrer} for hver venn du inviterer som booker sitt første opphold – og vennen får ${t.referred} også. Her begynner det å bli både hyggelig og lønnsomt å være ambassadør – så lenge du selv er fornøyd og har tro på det vi leverer.` },
  ];
}
