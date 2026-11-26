import { Db, getPool } from '../db';
import { getSettings } from '../settings';
import { rewardTerms } from './memberOverview';
import { computeMemberDiscount, describeSteps, launchFor, loyaltySettings } from './memberDiscount';

export type Lang = 'no' | 'en';

/**
 * The member benefits as told to someone who has been invited (invitation e-mail and invitation page).
 * Not shown on public pages – only to invitees and logged-in members.
 */
export async function inviteBenefits(lang: Lang = 'no', db: Db = getPool()): Promise<{ title: string; text: string }[]> {
  const s = await getSettings(db);
  const t = await rewardTerms(db, lang);
  const same = t.referred === t.referrer;
  const cl = await db.query(`SELECT cleaning_fee_ore AS ours, COALESCE(airbnb_cleaning_fee_ore, cleaning_fee_ore) AS airbnb, own_linen_discount_ore AS linen FROM properties WHERE active ORDER BY created_at LIMIT 1`).then(r => r.rows[0] as { ours: number; airbnb: number; linen: number } | undefined);
  const kr = (o: number) => `${Math.round(o / 100).toLocaleString('nb-NO')} kr`;
  const fee = Number(s.airbnb_guest_fee_pct), base = Number(s.member_base_discount_pct), hol = Number(s.member_holiday_discount_pct ?? base), cap = Number(s.member_discount_cap_pct ?? 100);
  const loyHoliday = String(s.member_loyalty_in_holiday ?? '1') === '1';
  const launch = await launchFor(new Date(), db);
  const until = launch.until ? `${launch.until.slice(8, 10)}.${launch.until.slice(5, 7)}.${launch.until.slice(0, 4)}` : '';
  const ls = await loyaltySettings(db); const ld = computeMemberDiscount(0, null, 0, ls.steps.length ? ls.steps : ls.step, ls.max);
  const fmt = (n: number) => n.toLocaleString(lang === 'en' ? 'en-GB' : 'nb-NO', { maximumFractionDigits: 2 }); const max = fmt(ld.loyaltyMaxPct); const desc = describeSteps(ld.steps, lang);
  return lang === 'en' ? [
    ...(fee > 0 ? [{ title: 'No Airbnb service fee', text: `You book directly with us and avoid Airbnb’s service fee of approx. ${fee} %.` }] : [{ title: 'Same nightly rate – lower cleaning', text: `The nightly rate is the same as on Airbnb, and the final cleaning costs less${cl ? ` (${kr(cl.ours)} instead of ${kr(cl.airbnb)})` : ''}.${cl?.linen ? ` Bring your own bed linen and save ${kr(cl.linen)} per person.` : ''}` }]),
    ...(launch.pct > 0 ? [{ title: `Launch offer: +${fmt(launch.pct)} % extra`, text: `Every booking sent up to and including ${until} gets ${fmt(launch.pct)} % extra discount in all seasons – holidays included (total discount at most ${fmt(cap)} %).` }] : []),
    { title: `${fmt(base)} % member discount`, text: `All members get ${fmt(base)} % off the price per night${hol !== base ? ` in low and high season, and ${fmt(hol)} % in holiday periods` : ''}. ${fee > 0 ? 'On top of that, you avoid the service fee you would otherwise pay on Airbnb or other booking platforms.' : 'The nightly rate is the same as on Airbnb, so the discount is a pure saving.'}` },
    { title: `Loyalty discount up to ${max} %`, text: `Starts at 0 % and grows with every booking you make – ${desc} – up to an extra ${max} %${loyHoliday ? '' : ' in low and high season'}. The total discount is at most ${fmt(cap)} %.` },
    { title: 'Bonus for you – and for your friends', text: `${same ? `After your first stay, you and the person who invited you each receive ${t.referred}` : `After your first stay, you receive ${t.referred} and the person who invited you ${t.referrer}`} off a future booking. Once you are approved to invite others yourself, you earn ${t.referrer} for every friend you invite who books their first stay – and your friend gets ${t.referred} too. Each bonus is valid for 24 months from the date it is earned, and up to 3 bonuses can be used per booking. This is where being an ambassador becomes both enjoyable and rewarding – as long as you are happy yourself and believe in what we offer.` },
  ] : [
    ...(fee > 0 ? [{ title: 'Ingen Airbnb-avgift', text: `Du booker direkte hos oss og slipper Airbnbs serviceavgift på ca. ${fee} %.` }] : [{ title: 'Samme nattpris – lavere vask', text: `Nattprisen er den samme som på Airbnb, og sluttrengjøringen koster mindre${cl ? ` (${kr(cl.ours)} i stedet for ${kr(cl.airbnb)})` : ''}.${cl?.linen ? ` Tar du med eget sengetøy, sparer du ${kr(cl.linen)} per person.` : ''}` }]),
    ...(launch.pct > 0 ? [{ title: `Lanseringstilbud: +${fmt(launch.pct)} % ekstra`, text: `Alle bookinger som sendes inn til og med ${until}, får ${fmt(launch.pct)} % ekstra rabatt i alle sesonger – også ferie (samlet rabatt maks ${fmt(cap)} %).` }] : []),
    { title: `${fmt(base)} % medlemsrabatt`, text: `Alle medlemmer får ${fmt(base)} % rabatt på overnattingsprisen (prisen per natt)${hol !== base ? ` i lav- og høysesong, og ${fmt(hol)} % i ferieperiodene` : ''}. ${fee > 0 ? 'I tillegg slipper du serviceavgiften du ellers betaler på Airbnb eller andre bookingplattformer.' : 'Nattprisen er den samme som på Airbnb, så rabatten er ren besparelse.'}` },
    { title: `Lojalitetsrabatt opptil ${max} %`, text: `Starter på 0 % og øker for hver booking du gjør – ${desc} – opptil ${max} % ekstra${loyHoliday ? '' : ' i lav- og høysesong'}. Samlet rabatt er maks ${fmt(cap)} %.` },
    { title: 'Bonus til deg – og vennene dine', text: `${same ? `Etter ditt første opphold får både du og den som inviterte deg ${t.referred} hver` : `Etter ditt første opphold får du ${t.referred} og den som inviterte deg ${t.referrer}`} i rabatt på en senere booking. Når du selv er godkjent for å invitere, får du ${t.referrer} for hver venn du inviterer som booker sitt første opphold – og vennen får ${t.referred} også. Hver bonus er gyldig i 24 måneder fra den er opptjent, og du kan bruke opptil 3 bonuser per booking. Her begynner det å bli både hyggelig og lønnsomt å være ambassadør – så lenge du selv er fornøyd og har tro på det vi leverer.` },
  ];
}
