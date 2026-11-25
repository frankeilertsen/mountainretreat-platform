import type { Lang } from './dict';

const no = {
  eyebrow: 'Omtale', title: (p: string) => `Hvordan var oppholdet på ${p}?`,
  lead: 'Takk for at du bodde hos oss! Tilbakemeldingen din hjelper oss å gjøre neste opphold enda bedre. Det tar omtrent ett minutt.',
  overall: 'Samlet vurdering', categories: 'Vurder gjerne også',
  cats: { cleanliness: 'Renhold', accuracy: 'Som beskrevet', checkin: 'Innsjekk', communication: 'Kommunikasjon', location: 'Beliggenhet', value: 'Verdi for pengene' } as Record<string, string>,
  publicText: 'Din omtale', publicPh: 'Hva likte du best? Hva bør andre vite?',
  privateText: 'Til oss (vises ikke offentlig)', privatePh: 'Noe vi kan gjøre bedre, noe som manglet?',
  consent: 'Omtalen min kan vises på mountainretreat.no med fornavnet mitt.', submit: 'Send omtale',
  thanks: 'Takk for omtalen! 🌿', thanksText: 'Vi setter stor pris på at du tok deg tid.',
  done: 'Du har allerede gitt en omtale for dette oppholdet. Takk!', notYet: 'Du kan gi en omtale når oppholdet er gjennomført.',
  back: '← Til bookingen', cta: 'Gi en omtale', ctaText: 'Hvordan var oppholdet? Vi vil gjerne høre fra deg.', your: 'Din omtale', stars: (n: number) => `${n} av 5`,
};
type RT = typeof no;
const en: RT = {
  eyebrow: 'Review', title: (p: string) => `How was your stay at ${p}?`,
  lead: 'Thank you for staying with us! Your feedback helps us make the next stay even better. It takes about a minute.',
  overall: 'Overall rating', categories: 'You are also welcome to rate',
  cats: { cleanliness: 'Cleanliness', accuracy: 'Accuracy', checkin: 'Check-in', communication: 'Communication', location: 'Location', value: 'Value' },
  publicText: 'Your review', publicPh: 'What did you like most? What should others know?',
  privateText: 'To us (not shown publicly)', privatePh: 'Anything we could do better, anything missing?',
  consent: 'My review may be shown on mountainretreat.no with my first name.', submit: 'Send review',
  thanks: 'Thank you for your review! 🌿', thanksText: 'We really appreciate you taking the time.',
  done: 'You have already reviewed this stay. Thank you!', notYet: 'You can review the stay once it has been completed.',
  back: '← Back to the booking', cta: 'Give a review', ctaText: 'How was your stay? We would love to hear from you.', your: 'Your review', stars: (n: number) => `${n} of 5`,
};
export const reviewDict: Record<Lang, RT> = { no, en };
