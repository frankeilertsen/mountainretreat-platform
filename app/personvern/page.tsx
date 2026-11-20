export const metadata = { title: 'Personvern' };
export default function Privacy() {
  return (
    <div className="narrow">
      <span className="eyebrow">FKE Property AS</span>
      <h1>Personvern</h1>
      <p>Vi behandler kun opplysningene som trengs for å administrere medlemskap og bookinger: navn, e-post, telefon (valgfritt), bookinghistorikk, betalingsstatus og vervebonus. Kortopplysninger håndteres av betalingsleverandøren (Stripe) og lagres aldri hos oss.</p>
      <p>Renholdere ser kun datoer, tider, antall gjester og praktiske instruksjoner – aldri navn, kontaktinfo eller priser.</p>
      <p>Data lagres i EU/EØS. Du kan når som helst laste ned dine data eller be om anonymisering fra profilsiden. Regnskapsdata oppbevares i henhold til bokføringsloven (5 år) under anonymisert ID.</p>
      <p>Behandlingsgrunnlag: avtale (GDPR art. 6 nr. 1 b). Spørsmål: post@mountainretreat.no</p>
    </div>
  );
}
