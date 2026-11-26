import type { Lang } from './dict';

/**
 * Terms of sale (salgsvilkår) for Retreat Club bookings – Norwegian and English.
 * Covers what Vipps MobilePay requires: parties, payment, delivery, right of withdrawal, returns,
 * complaints and dispute resolution, plus the rental terms (changes, cancellation, end of the rental).
 * Figures come from the live settings so the text always matches how the platform works.
 */
export type TermsInput = {
  company: string; orgNr: string; address: string; phone: string; email: string;
  holdHours: number; cancelTimeoutHours: number;
  tiers: { min: number; max: number | null; pct: number; approval: boolean }[];
  checkIn: string; checkOut: string;
};
export type Section = { h: string; p: (string | string[])[] };

const tierText = (t: TermsInput['tiers'][number], lang: Lang) => {
  const span = t.max != null ? `${t.min}–${t.max}` : `${t.min}`;
  if (lang === 'en') {
    const when = t.max != null ? `${span} days before check-in` : `${span} days or more before check-in`;
    return t.approval ? `${when}: the cancellation must be approved by us; a refund is assessed case by case${t.pct > 0 ? ` (normally ${t.pct} %)` : ''}.` : `${when}: ${t.pct} % refund of the amount paid.`;
  }
  const when = t.max != null ? `${span} dager før innsjekk` : `${span} dager eller mer før innsjekk`;
  return t.approval ? `${when}: avbestillingen må godkjennes av oss, og refusjon vurderes i hvert tilfelle${t.pct > 0 ? ` (normalt ${t.pct} %)` : ''}.` : `${when}: ${t.pct} % refusjon av innbetalt beløp.`;
};

export function termsSections(lang: Lang, i: TermsInput): { title: string; lead: string; updated: string; sections: Section[] } {
  const id = [i.company, i.orgNr && (lang === 'en' ? `org. no. ${i.orgNr}` : `org.nr. ${i.orgNr}`), i.address].filter(Boolean).join(', ');
  const contact = [i.email, i.phone].filter(Boolean).join(lang === 'en' ? ' or ' : ' eller ');
  const tiers = i.tiers.map(t => tierText(t, lang));
  if (lang === 'en') return {
    title: 'Terms of sale', updated: 'Last updated 25 November 2026',
    lead: `These terms apply to bookings of stays through Retreat Club at mountainretreat.no. Please read them before you pay – by paying you accept the terms.`,
    sections: [
      { h: '1. Parties', p: [
        `Seller and landlord: ${id}. Contact: ${contact}. Messages can also be sent through “Messages” in the member portal.`,
        'Buyer and tenant: the Retreat Club member who makes the booking (“you”). Membership is by invitation only, and you must be at least 18 years old. You are responsible for the guests who stay with you.',
      ] },
      { h: '2. Booking and agreement', p: [
        'You send a booking request with dates, number of guests and any extras. The request is not binding for either party until we have approved it.',
        `When we approve the request, the price is locked and the dates are held for you for ${i.holdHours} hours. The agreement is binding when the payment has been completed and you have received a booking confirmation by e-mail.`,
        'If payment is not completed within the deadline, the dates are released and the request lapses at no cost.',
      ] },
      { h: '3. Prices', p: [
        'All prices are in Norwegian kroner (NOK) and include any applicable taxes and fees. The total price is shown before you pay and specifies the stay, final cleaning, extra guests, extras and any discounts or bonuses.',
        'There is no fee for the choice of payment method.',
      ] },
      { h: '4. Payment', p: [
        'You can pay by card (Visa, Mastercard and others, via Stripe) or with Vipps. The payment is processed by Stripe or Vipps MobilePay – we never see or store your card details.',
        'The full amount is charged when you pay. The booking is confirmed automatically when the payment has been verified.',
        'Members who have agreed this with us may also pay by invoice. The booking is then confirmed straight away, and the invoice is sent by e-mail with the due date stated on it. For late payment we may charge late-payment interest and reminder fees under the applicable rules.',
      ] },
      { h: '5. Delivery', p: [
        `The service is delivered by the accommodation being made available to you for the booked period. Check-in is from ${i.checkIn} on the day of arrival and check-out is by ${i.checkOut} on the day of departure, unless otherwise stated in your booking.`,
        'Practical information, including access and key details, is sent to you before arrival and can be found in your booking in the member portal.',
      ] },
      { h: '6. The rental: changes, cancellation and end of the rental', p: [
        'Changes and rebooking: if you want to change the dates or the number of guests, please contact us through “Messages” as early as possible. We will try to accommodate you if the property is available, but cannot guarantee it. If the change cannot be made, you can cancel under the rules below and send a new request.',
        'Cancellation by you: you cancel from your booking in the member portal. The refund depends on how long before check-in you cancel:',
        tiers,
        `Requests that require our approval are processed within ${i.cancelTimeoutHours} hours; if we have not processed the request by then, it is approved automatically in your favour. Bookings that have not yet been paid can be cancelled at no cost.`,
        'Cancellation by us: if we must cancel your stay (for example due to damage to the property or force majeure), you get a full refund of everything you have paid. We are not liable for indirect losses such as travel costs.',
        'End of the rental: the rental is for a limited period and ends automatically at check-out on the day of departure – no notice is required. The rental is not a tenancy for residential purposes and is not covered by the Tenancy Act. Long-term rentals are agreed separately in writing.',
        'Termination for breach: we may terminate the rental with immediate effect if the house rules are seriously breached, for example if there are more guests than agreed, in the case of parties or deliberate damage. In such cases there is no refund for the remaining period.',
      ] },
      { h: '7. Right of withdrawal', p: [
        'There is no right of withdrawal on bookings of accommodation for a specific date or period, cf. the Norwegian Cancellation Act (angrerettloven) section 22 (m). Instead, the cancellation rules in section 6 apply.',
      ] },
      { h: '8. Returns and refunds', p: [
        'Because this is a service and not goods, there is nothing to return. Refunds after a cancellation or a justified complaint are paid back to the same card or Vipps account that was used for the payment. We initiate the refund within 14 days; the time until the money is in your account depends on your bank.',
        'Unused bonuses that were applied to a cancelled booking are returned to your bonus balance. A returned bonus keeps its original expiry date.',
        'Referral bonuses: each bonus is valid for 24 months from the date it is earned and must be used before it expires; an expired bonus cannot be used or refunded. Up to 5 bonuses can be used per booking, a member can hold at most 10 unused bonuses at a time, and bonuses cannot be paid out as cash. We send a reminder 30 days before a bonus expires.',
      ] },
      { h: '9. Complaints', p: [
        'If something is not as agreed – for example cleanliness, equipment or missing items – please tell us as soon as possible, preferably during your stay, via “Messages”, e-mail or phone, so we can put it right. Photos help.',
        'If we cannot put it right, you may be entitled to a price reduction or compensation under general Norwegian contract law. Complaints must be made within a reasonable time after you discovered or should have discovered the problem.',
        'Damage you or your guests cause to the property must be reported immediately. You are responsible for damage caused intentionally or negligently by you or your guests, beyond normal wear and tear.',
      ] },
      { h: '10. House rules and use', p: [
        'The house rules shown in the booking are part of the agreement. The property may only be used by the number of guests stated in the booking.',
      ] },
      { h: '11. Privacy', p: [
        'We process personal data in accordance with our privacy policy, see mountainretreat.no/personvern.',
      ] },
      { h: '12. Dispute resolution', p: [
        'Please contact us first – we want to find a good solution together.',
        'If we cannot agree, you as a consumer can contact the Norwegian Consumer Council (Forbrukerrådet, forbrukerradet.no) for advice and mediation. If mediation does not lead to a solution, the case can be brought before the Consumer Complaints Committee (Forbrukerklageutvalget).',
        'The agreement is governed by Norwegian law. Disputes that are not resolved otherwise are decided by the Norwegian courts, with the consumer’s local district court as the venue.',
      ] },
    ],
  };
  return {
    title: 'Salgsvilkår', updated: 'Sist oppdatert 25. november 2026',
    lead: `Disse vilkårene gjelder for booking av opphold gjennom Retreat Club på mountainretreat.no. Les dem før du betaler – ved å betale godtar du vilkårene.`,
    sections: [
      { h: '1. Parter', p: [
        `Selger og utleier: ${id}. Kontakt: ${contact}. Du kan også sende melding under «Meldinger» i medlemsportalen.`,
        'Kjøper og leietaker: medlemmet av Retreat Club som gjør bookingen («du»). Medlemskap skjer kun gjennom invitasjon, og du må være minst 18 år. Du er ansvarlig for gjestene som bor sammen med deg.',
      ] },
      { h: '2. Bestilling og avtale', p: [
        'Du sender en bookingforespørsel med datoer, antall gjester og eventuelle tillegg. Forespørselen er ikke bindende for noen av partene før vi har godkjent den.',
        `Når vi godkjenner forespørselen, låses prisen, og datoene holdes av til deg i ${i.holdHours} timer. Avtalen er bindende når betalingen er gjennomført og du har fått bookingbekreftelse på e-post.`,
        'Blir betalingen ikke gjennomført innen fristen, frigis datoene, og forespørselen faller bort uten kostnad.',
      ] },
      { h: '3. Priser', p: [
        'Alle priser er i norske kroner (NOK) og inkluderer eventuelle avgifter. Totalprisen vises før du betaler, og spesifiserer oppholdet, sluttrengjøring, ekstra gjester, tillegg og eventuelle rabatter og bonuser.',
        'Det tas ikke gebyr for valg av betalingsmåte.',
      ] },
      { h: '4. Betaling', p: [
        'Du kan betale med kort (Visa, Mastercard m.fl. via Stripe) eller med Vipps. Betalingen behandles av Stripe eller Vipps MobilePay – vi ser eller lagrer aldri kortopplysningene dine.',
        'Hele beløpet trekkes når du betaler. Bookingen bekreftes automatisk når betalingen er verifisert.',
        'Medlemmer som har avtalt det med oss, kan også betale med faktura. Da bekreftes bookingen med en gang, og fakturaen sendes på e-post med forfallsdato som står på fakturaen. Ved for sen betaling kan vi kreve forsinkelsesrente og purregebyr etter gjeldende regler.',
      ] },
      { h: '5. Levering', p: [
        `Tjenesten leveres ved at boligen stilles til din disposisjon i den bookede perioden. Innsjekk er fra kl. ${i.checkIn} på ankomstdagen, og utsjekk er innen kl. ${i.checkOut} på avreisedagen, med mindre annet står i bookingen din.`,
        'Praktisk informasjon, blant annet om adkomst og nøkkel, sendes til deg før ankomst og ligger i bookingen din i medlemsportalen.',
      ] },
      { h: '6. Leieforholdet: endring, avbestilling og avslutning', p: [
        'Endring og ombooking: Ønsker du å endre datoer eller antall gjester, kontakt oss under «Meldinger» så tidlig som mulig. Vi forsøker å imøtekomme ønsket dersom boligen er ledig, men kan ikke garantere det. Lar endringen seg ikke gjøre, kan du avbestille etter reglene under og sende en ny forespørsel.',
        'Avbestilling fra deg: Du avbestiller fra bookingen din i medlemsportalen. Refusjonen avhenger av hvor lenge før innsjekk du avbestiller:',
        tiers,
        `Forespørsler som krever vår godkjenning, behandles innen ${i.cancelTimeoutHours} timer. Har vi ikke behandlet forespørselen innen fristen, godkjennes den automatisk i din favør. Bookinger som ikke er betalt ennå, kan avbestilles kostnadsfritt.`,
        'Avbestilling fra oss: Må vi avlyse oppholdet ditt (for eksempel på grunn av skade på boligen eller force majeure), får du full refusjon av alt du har betalt. Vi er ikke ansvarlige for indirekte tap som for eksempel reisekostnader.',
        'Avslutning av leieforholdet: Leieforholdet gjelder for en avgrenset periode og avsluttes automatisk ved utsjekk på avreisedagen – det er ikke nødvendig med oppsigelse. Leieforholdet er ikke en leie av bolig til boformål og omfattes ikke av husleieloven. Langtidsleie avtales særskilt og skriftlig.',
        'Heving ved mislighold: Vi kan heve leieforholdet med umiddelbar virkning ved vesentlige brudd på husreglene, for eksempel flere gjester enn avtalt, fester eller forsettlig skade. I slike tilfeller gis det ikke refusjon for gjenværende periode.',
      ] },
      { h: '7. Angrerett', p: [
        'Det er ikke angrerett ved booking av overnatting for en bestemt dato eller periode, jf. angrerettloven § 22 bokstav m. Isteden gjelder avbestillingsreglene i punkt 6.',
      ] },
      { h: '8. Retur og refusjon', p: [
        'Fordi dette er en tjeneste og ikke en vare, er det ingenting å returnere. Refusjon etter avbestilling eller berettiget reklamasjon betales tilbake til samme kort eller Vipps-konto som ble brukt ved betalingen. Vi setter i gang refusjonen innen 14 dager; hvor lang tid det tar før pengene er på kontoen, avhenger av banken din.',
        'Ubrukte bonuser som var trukket fra en avbestilt booking, føres tilbake til bonussaldoen din. En tilbakeført bonus beholder sin opprinnelige utløpsdato.',
        'Vervebonus: Hver bonus er gyldig i 24 måneder fra den er opptjent og må brukes før den utløper. En utløpt bonus kan ikke brukes eller refunderes. Det kan brukes opptil 5 bonuser per booking, et medlem kan ha maks 10 ubrukte bonuser om gangen, og bonus kan ikke tas ut i penger. Vi sender en påminnelse 30 dager før en bonus utløper.',
      ] },
      { h: '9. Reklamasjon', p: [
        'Er noe ikke som avtalt – for eksempel renhold, utstyr eller noe som mangler – gi beskjed så snart som mulig, helst mens du er der, via «Meldinger», e-post eller telefon, slik at vi kan rette det. Bilder er til god hjelp.',
        'Klarer vi ikke å rette det, kan du ha krav på prisavslag eller erstatning etter alminnelige kontraktsrettslige regler. Det må reklameres innen rimelig tid etter at du oppdaget eller burde ha oppdaget mangelen.',
        'Skader du eller gjestene dine påfører boligen, må meldes med en gang. Du er ansvarlig for skader som du eller gjestene dine forårsaker forsettlig eller uaktsomt, utover normal slitasje.',
      ] },
      { h: '10. Husregler og bruk', p: [
        'Husreglene som vises i bookingen, er en del av avtalen. Boligen kan bare brukes av det antallet gjester som står i bookingen.',
      ] },
      { h: '11. Personvern', p: [
        'Vi behandler personopplysninger i tråd med personvernerklæringen vår, se mountainretreat.no/personvern.',
      ] },
      { h: '12. Konfliktløsning', p: [
        'Ta kontakt med oss først – vi ønsker å finne en god løsning sammen.',
        'Kommer vi ikke til enighet, kan du som forbruker kontakte Forbrukerrådet (forbrukerradet.no) for råd og mekling. Fører ikke meklingen frem, kan saken bringes inn for Forbrukerklageutvalget.',
        'Avtalen er underlagt norsk rett. Tvister som ikke løses på annen måte, avgjøres av norske domstoler, med forbrukerens hjemting som verneting.',
      ] },
    ],
  };
}
