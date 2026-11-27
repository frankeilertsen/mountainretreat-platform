import type { Lang } from './dict';
import { fmtDateL } from './format';

/** Texts for the cleaning portal (Norwegian / English). Cleaners often prefer English, so the portal follows the flags. */
const no = {
  portal: 'Renhold', logout: 'Logg ut', admin: 'Admin',
  tabs: { today: 'I dag', week: 'Uke', month: 'Måned', profile: 'Profil', day: 'Dag' },
  today: { title: 'I dag', checkout: 'Utsjekk', checkin: 'Innsjekk', none: 'Ingen oppgaver i dag. 🌿', upcoming: 'Kommende', noneUpcoming: 'Ingen kommende oppgaver de neste 14 dagene.' },
  cal: { week: (n: number) => `Uke ${n}`, noTasks: 'Ingen oppgaver', jobs: (n: number) => `${n} ${n === 1 ? 'jobb' : 'jobber'}` },
  card: {
    checkout: 'Utsjekk', guests: (n: number) => `${n} gjester`, prep: 'Klargjøring før ankomst', nextIn: 'Neste inn', today: 'i dag', sameDay: 'samme dag',
    infants: (n: number) => `+ ${n} sped.`, shortTurn: (t: string) => `Kort snutid – ferdig før kl. ${t}`, unassigned: 'ikke tildelt',
  },
  task: {
    back: '← Tilbake', date: 'Dato', job: 'Oppgave', turnover: 'Utvask etter utsjekk', preparation: 'Klargjøring før ankomst',
    checkout: 'Utsjekk', at: (t: string) => `kl. ${t}`, leaving: (n: number) => `${n} gjester reiser`, nextArrival: 'Neste ankomst', todayAt: (t: string) => `I DAG kl. ${t}`,
    expected: (t: string) => `(ventet ${t})`, nonePlanned: 'Ingen planlagt', deadline: 'Frist', guests: 'Gjester',
    guestList: (a: number, c: number, i: number) => `${a} voksne${c ? `, ${c} barn` : ''}${i ? `, ${i} spedbarn` : ''}`, noGuestInfo: 'Ingen info om neste gjester ennå',
    responsible: 'Ansvarlig', notAssigned: 'Ikke tildelt', notNeeded: 'Ikke nødvendig – gjesten vasker selv.',
    bedsTitle: 'Senger og rom', forNext: '– for neste gjester', noPlan: 'Ingen informasjon om neste gjester ennå. Re opp etter standard eller spør administrator.',
    planMember: 'Soveplan valgt av gjesten.', linenAll: 'Alle gjestene tar med eget sengetøy og håndklær – ikke re opp sengene eller legg ut håndklær.', linenPartial: (own: number, total: number) => `${own} av ${total} gjester tar med eget sengetøy. Re opp bare sengene som ikke er merket «Eget sengetøy».`, linenPartialNoPlan: (own: number, total: number) => `${own} av ${total} gjester tar med eget sengetøy, men gjesten har ikke valgt hvilke senger ennå. Re opp for ${total - own} personer.`,
    planAdmin: 'Soveplan satt av administrator.', planAuto: 'Automatisk forslag ut fra antall gjester og senger.', roomsSummary: (n: number, d: number) => `${n} rom skal gjøres klare · ${d} ferdig.`,
    reports: 'Rapporter', resolved: 'løst', newReport: '+ Rapporter skade, mangel eller kommentar', type: 'Type',
    kinds: { damage: 'Skade', missing_item: 'Mangler', issue: 'Avvik', comment: 'Kommentar' } as Record<string, string>,
    kindOptions: { damage: 'Skade', missing_item: 'Noe mangler', issue: 'Annet avvik', comment: 'Kommentar' },
    description: 'Beskrivelse', descPh: 'Hva, hvor?', photoOpt: 'Bilde (valgfritt)', send: 'Send', photos: 'Bilder', upload: 'Last opp',
    start: 'Start renhold', notePh: 'Notat til administrator (valgfritt)', complete: '✓ Marker som ferdig', roomsLeft: (n: number) => `(${n} rom gjenstår)`,
    doneAt: (when: string, note?: string | null) => `Ferdig ${when}${note ? ` – «${note}»` : ''}.`,
  },
  room: {
    guestsInRoom: (n: number) => `${n} gjest${n === 1 ? '' : 'er'} i rommet`, empty: 'Ingen gjester – ikke re opp', done: '✓ Ferdig', markDone: 'Marker ferdig',
    persons: 'Antall personer', makeCot: 'Gjør klar barneseng', makeFor: (n: number, child: boolean) => `Re opp for ${n}${child ? ' (barn)' : ''}`, ownLinen: (n: number) => `Eget sengetøy (${n}) – ikke re opp`, unused: 'Ikke i bruk',
    noBeds: 'Ingen senger i dette rommet.', sheets: (n: number) => `${n} sengesett`, duvets: (n: number) => `${n} dyner`, pillows: (n: number) => `${n} puter`,
    towels: (l: number, s: number) => `${l} store + ${s} små håndklær`, cot: (n: number) => `${n} sett barnesengtøy`, instructions: 'Instruks:',
  },
  beds: { double: 'Dobbeltseng', single: 'Enkeltseng', bunk_lower: 'Køyeseng (nedre)', bunk_upper: 'Køyeseng (øvre)', sofa_bed: 'Sovesofa', extra_mattress: 'Ekstra madrass', cot: 'Barneseng' } as Record<string, string>,
  profile: {
    eyebrow: 'Min konto', title: 'Profil og varsler', name: 'Navn', phone: 'Mobil', email: 'E-post', emailHelp: 'Brukes til innlogging. Kontakt administrator for å endre.',
    notices: 'Varsler', noticesText: 'Du får beskjed ved ny booking (ny vask), når en vask flyttes eller avlyses, når info om neste gjester endres, dagen før og samme morgen som det skal vaskes.',
    byEmail: 'E-post', bySms: 'SMS til mobilnummeret over', save: 'Lagre', assigned: (p: string) => `Du er satt opp på: ${p}.`,
    language: 'Språk', languageHelp: 'Portalen, e-post og SMS kommer på språket du velger.',
  },
};

type CleanT = typeof no;

const en: CleanT = {
  portal: 'Cleaning', logout: 'Log out', admin: 'Admin',
  tabs: { today: 'Today', week: 'Week', month: 'Month', profile: 'Profile', day: 'Day' },
  today: { title: 'Today', checkout: 'Check-out', checkin: 'Check-in', none: 'No tasks today. 🌿', upcoming: 'Upcoming', noneUpcoming: 'No upcoming tasks in the next 14 days.' },
  cal: { week: (n: number) => `Week ${n}`, noTasks: 'No tasks', jobs: (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}` },
  card: {
    checkout: 'Check-out', guests: (n: number) => `${n} guests`, prep: 'Preparation before arrival', nextIn: 'Next in', today: 'today', sameDay: 'same day',
    infants: (n: number) => `+ ${n} infant${n === 1 ? '' : 's'}`, shortTurn: (t: string) => `Short turnaround – done before ${t}`, unassigned: 'not assigned',
  },
  task: {
    back: '← Back', date: 'Date', job: 'Task', turnover: 'Clean after check-out', preparation: 'Preparation before arrival',
    checkout: 'Check-out', at: (t: string) => `at ${t}`, leaving: (n: number) => `${n} guests leaving`, nextArrival: 'Next arrival', todayAt: (t: string) => `TODAY at ${t}`,
    expected: (t: string) => `(expected ${t})`, nonePlanned: 'None planned', deadline: 'Deadline', guests: 'Guests',
    guestList: (a: number, c: number, i: number) => `${a} adult${a === 1 ? '' : 's'}${c ? `, ${c} child${c === 1 ? '' : 'ren'}` : ''}${i ? `, ${i} infant${i === 1 ? '' : 's'}` : ''}`, noGuestInfo: 'No information about the next guests yet',
    responsible: 'Assigned to', notAssigned: 'Not assigned', notNeeded: 'Not needed – the guest cleans themselves.',
    bedsTitle: 'Beds and rooms', forNext: '– for the next guests', noPlan: 'No information about the next guests yet. Make up the beds as standard or ask the administrator.',
    planMember: 'Sleeping plan chosen by the guest.', linenAll: 'All guests bring their own bed linen and towels – do not make up the beds or put out towels.', linenPartial: (own: number, total: number) => `${own} of ${total} guests bring their own bed linen. Only make up the beds not marked “Own linen”.`, linenPartialNoPlan: (own: number, total: number) => `${own} of ${total} guests bring their own bed linen, but the guest has not chosen which beds yet. Make up for ${total - own} people.`,
    planAdmin: 'Sleeping plan set by the administrator.', planAuto: 'Automatic suggestion based on the number of guests and beds.', roomsSummary: (n: number, d: number) => `${n} room${n === 1 ? '' : 's'} to prepare · ${d} done.`,
    reports: 'Reports', resolved: 'resolved', newReport: '+ Report damage, something missing or a comment', type: 'Type',
    kinds: { damage: 'Damage', missing_item: 'Missing', issue: 'Issue', comment: 'Comment' } as Record<string, string>,
    kindOptions: { damage: 'Damage', missing_item: 'Something is missing', issue: 'Other issue', comment: 'Comment' },
    description: 'Description', descPh: 'What, where?', photoOpt: 'Photo (optional)', send: 'Send', photos: 'Photos', upload: 'Upload',
    start: 'Start cleaning', notePh: 'Note to the administrator (optional)', complete: '✓ Mark as done', roomsLeft: (n: number) => `(${n} room${n === 1 ? '' : 's'} left)`,
    doneAt: (when: string, note?: string | null) => `Done ${when}${note ? ` – “${note}”` : ''}.`,
  },
  room: {
    guestsInRoom: (n: number) => `${n} guest${n === 1 ? '' : 's'} in the room`, empty: 'No guests – do not make up', done: '✓ Done', markDone: 'Mark done',
    persons: 'Number of people', makeCot: 'Prepare the cot', makeFor: (n: number, child: boolean) => `Make up for ${n}${child ? ' (child)' : ''}`, ownLinen: (n: number) => `Own linen (${n}) – do not make up`, unused: 'Not in use',
    noBeds: 'No beds in this room.', sheets: (n: number) => `${n} bedding set${n === 1 ? '' : 's'}`, duvets: (n: number) => `${n} duvet${n === 1 ? '' : 's'}`, pillows: (n: number) => `${n} pillow${n === 1 ? '' : 's'}`,
    towels: (l: number, s: number) => `${l} large + ${s} small towels`, cot: (n: number) => `${n} cot bedding set${n === 1 ? '' : 's'}`, instructions: 'Instructions:',
  },
  beds: { double: 'Double bed', single: 'Single bed', bunk_lower: 'Bunk bed (lower)', bunk_upper: 'Bunk bed (upper)', sofa_bed: 'Sofa bed', extra_mattress: 'Extra mattress', cot: 'Cot' },
  profile: {
    eyebrow: 'My account', title: 'Profile and notifications', name: 'Name', phone: 'Mobile', email: 'Email', emailHelp: 'Used for logging in. Contact the administrator to change it.',
    notices: 'Notifications', noticesText: 'You are notified about new bookings (new cleaning), when a cleaning is moved or cancelled, when information about the next guests changes, the day before and on the morning of the cleaning.',
    byEmail: 'Email', bySms: 'SMS to the mobile number above', save: 'Save', assigned: (p: string) => `You are set up for: ${p}.`,
    language: 'Language', languageHelp: 'The portal, emails and text messages use the language you choose.',
  },
};

export const cleanDict: Record<Lang, CleanT> = { no, en };

/** Translate the room-plan warnings produced in Norwegian by the bed allocator. */
export function translateWarning(w: string, lang: Lang): string {
  if (lang === 'no') return w;
  let m = w.match(/^(\d+) spedbarn mangler barneseng/);
  if (m) return `${m[1]} infant(s) without a cot – sleeping with an adult, or bring a travel cot.`;
  m = w.match(/^(\d+) gjest\(er\) får ikke plass/);
  if (m) return `${m[1]} guest(s) do not fit in the configured beds.`;
  return w;
}

// ---------- notifications to cleaners (e-mail subject + SMS), in the cleaner's own language

type Msg = { subject: string; sms?: string };
export type HelperMessage = Record<Lang, Msg>;
const d = (iso: string, lang: Lang) => fmtDateL(iso, lang, true);

export const helperMsg = {
  newBooking: (channel: string, property: string, type: 'turnover' | 'preparation', date: string, guests: number | null, assignedToYou: boolean, sameDayCheckin: boolean): HelperMessage => ({
    no: {
      subject: `Ny booking (${channel}): ${property} – ${type === 'turnover' ? 'vask' : 'klargjøring'} ${d(date, 'no')}${assignedToYou ? ' – tildelt deg' : ''}`,
      sms: `Ny booking på ${property}: ${type === 'turnover' ? 'vask' : 'klargjøring'} ${d(date, 'no')}${guests ? ` (${guests} gjester)` : ''}${sameDayCheckin ? ', nye gjester samme dag' : ''}.`,
    },
    en: {
      subject: `New booking (${channel}): ${property} – ${type === 'turnover' ? 'cleaning' : 'preparation'} ${d(date, 'en')}${assignedToYou ? ' – assigned to you' : ''}`,
      sms: `New booking at ${property}: ${type === 'turnover' ? 'cleaning' : 'preparation'} ${d(date, 'en')}${guests ? ` (${guests} guests)` : ''}${sameDayCheckin ? ', new guests the same day' : ''}.`,
    },
  }),
  moved: (property: string, from: string, to: string): HelperMessage => ({
    no: { subject: `Vask flyttet: ${property} nå ${d(to, 'no')}`, sms: `Endring: vasken på ${property} er flyttet fra ${fmtDateL(from, 'no')} til ${d(to, 'no')}.` },
    en: { subject: `Cleaning moved: ${property} now ${d(to, 'en')}`, sms: `Change: the cleaning at ${property} has moved from ${fmtDateL(from, 'en')} to ${d(to, 'en')}.` },
  }),
  cancelled: (property: string, date: string): HelperMessage => ({
    no: { subject: `Vask avlyst: ${property} ${d(date, 'no')}`, sms: `Avlyst: vasken på ${property} ${d(date, 'no')} trengs ikke lenger (booking kansellert).` },
    en: { subject: `Cleaning cancelled: ${property} ${d(date, 'en')}`, sms: `Cancelled: the cleaning at ${property} on ${d(date, 'en')} is no longer needed (booking cancelled).` },
  }),
  reminderTomorrow: (property: string, date: string): HelperMessage => ({
    no: { subject: `I morgen: vask ${property}`, sms: `Husk: vask på ${property} i morgen (${d(date, 'no')}).` },
    en: { subject: `Tomorrow: cleaning ${property}`, sms: `Reminder: cleaning at ${property} tomorrow (${d(date, 'en')}).` },
  }),
  reminderToday: (property: string, type: string, cout: string, cin: string, sameDay: boolean, guests: number | null, assigned: boolean): HelperMessage => ({
    no: {
      subject: `I dag: vask ${property}, ${type === 'turnover' ? `utsjekk kl. ${cout}` : 'klargjøring'}${assigned ? '' : ' (ikke tildelt ennå)'}`,
      sms: `Påminnelse: vask i dag på ${property}, ${type === 'turnover' ? `utsjekk kl. ${cout}` : 'klargjøring'}.${sameDay ? ` Nye gjester kl. ${cin}${guests ? ` (${guests} pers.)` : ''} – må være ferdig før det.` : ''}`,
    },
    en: {
      subject: `Today: cleaning ${property}, ${type === 'turnover' ? `check-out at ${cout}` : 'preparation'}${assigned ? '' : ' (not assigned yet)'}`,
      sms: `Reminder: cleaning today at ${property}, ${type === 'turnover' ? `check-out at ${cout}` : 'preparation'}.${sameDay ? ` New guests at ${cin}${guests ? ` (${guests} people)` : ''} – must be done before then.` : ''}`,
    },
  }),
  notNeeded: (property: string, date: string): HelperMessage => ({
    no: { subject: `Vask trengs ikke: ${property} ${d(date, 'no')}`, sms: `Endring: vasken på ${property} ${d(date, 'no')} trengs ikke – det vaskes selv denne gangen.` },
    en: { subject: `Cleaning not needed: ${property} ${d(date, 'en')}`, sms: `Change: the cleaning at ${property} on ${d(date, 'en')} is not needed – the guests clean themselves this time.` },
  }),
  assigned: (property: string, date: string): HelperMessage => ({
    no: { subject: `Ny renholdsjobb: ${property} ${d(date, 'no')}` },
    en: { subject: `New cleaning job: ${property} ${d(date, 'en')}` },
  }),
  guestInfoChanged: (): HelperMessage => ({
    no: { subject: 'Endret info om neste ankomst' },
    en: { subject: 'Updated information about the next arrival' },
  }),
};

export const helperEmailBody = (lang: Lang, name: string, subject: string, link: string) => lang === 'en'
  ? `Hi ${name}!\n\n${subject}\nSee times, guests and bed setup: ${link}`
  : `Hei ${name}!\n\n${subject}\nSe tider, gjester og sengeoppsett: ${link}`;
