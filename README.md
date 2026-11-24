# Mountain Retreat – Friends & Family-plattform (FKE Property AS)

Privat, invitasjonsbasert bookingplattform med medlemsportal, administrasjon, renholdsportal, verveprogram, betaling og kanalsynk.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL 16 (rene SQL-migreringer + `pg`) · Stripe · iCal · Resend (e-post). Ingen Redis – jobber og rate limiting går i Postgres (holder godt for dusinvis av medlemmer og et lite antall boliger).

---

## 1. Hva er bygget

| Område | Innhold |
|---|---|
| **Forside** | `mountainretreat.no` åpner med logoen og tre valg: **Book via Airbnb** (lenke til Airbnb-annonsen, settes per bolig under Boliger → Detaljer; vises som «Kommer snart» til lenken er lagt inn), **Venner og familie** (går videre til `/venner`, inngangen til medlemsportalen) og **Fast leie** (`/fast-leie`, kontaktskjema). |
| **Fast leie** | Skjema med navn, e-post, telefon, bolig, ønsket innflytting, varighet, antall personer og melding, samt samtykke. Forespørselen lagres, sendes på e-post til frank@mountainretreat.no (svar går direkte til avsender; adressen kan endres under Innstillinger), og avsender får bekreftelse. Beskyttet mot spam i flere lag: **bekreftelseskode** med bokstaver og tall (bildet tegnes på vår egen server som vektorstreker, ikke tekst, så roboter kan ikke lese det fra sidekoden; koden kan brukes én gang, utløper etter 20 min, avvises hvis skjemaet sendes på under 3 sek, og «Ny kode» gir nytt bilde), skjult felt (honeypot) og rate limiting. Skrives koden feil, beholdes alt gjesten har fylt inn. Vil dere heller bruke **Cloudflare Turnstile** (dagens vanligste standard, som oftest uten tasting), settes `TURNSTILE_SITE_KEY` og `TURNSTILE_SECRET_KEY`, så byttes koden ut automatisk (se §4). Admin ser alle forespørsler under *Fast leie – forespørsler* og kan markere dem som kontaktet/avsluttet. |
| **Språk (norsk/engelsk)** | Norsk og britisk flagg øverst til høyre på forsiden, venner-siden, fast leie, innlogging og invitasjon, og nederst i sidemenyen i medlemsportalen (også under Profil). Valget lagres i en informasjonskapsel (`mr_lang`, 1 år); første besøk følger nettleserens språk (norsk hvis nettleseren er norsk, ellers engelsk). Oversatt: alle gjestesider, hele medlemsportalen, prisberegning og besparelse, kalender, statuser og meldinger/feil. Bekreftelsen ved fast leie sendes på valgt språk. Tekstene ligger i `lib/i18n/dict.ts`. |
| **Innlogging** | Ingen åpen registrering. E-postlenke (magic link, 15 min, engangs) + obligatorisk TOTP med 10 gjenopprettingskoder. Øktgrenser i databasen (admin 12 t / 30 min inaktivitet, andre 24 t / 60 min). Låsing etter 5 feil TOTP, rate limiting på innlogging/invitasjoner. |
| **Invitasjoner og medlemskap** | Personlig engangslenke (hash lagret), knyttet til inviterende. Hele vervetreet spores. Medlemmer invitert av admin kan invitere; medlemmer invitert av medlemmer må søke og godkjennes. Admin kan invitere, trekke tilbake, suspendere, tilbakekalle (kansellerer aktive bookinger + refunderer), nullstille tofaktor og logge ut alle økter. Duplikater hindres (unik e-post uten hensyn til store/små bokstaver, én aktiv invitasjon per adresse, ingen selvinvitasjon). |
| **Prising** | Hver bolig velger **Følg Airbnb-prisene** (standard) eller **egne priser** (sesongpriser). Ved Airbnb-prising er nattprisen den samme som på Airbnb; sesongperiodene brukes da bare for regler (min. netter, hel periode, byttedag). Airbnb tilbyr ikke priser via iCal eller åpent API, så prisene legges inn fra Airbnb-kalenderen (periode med hverdag/helg-pris eller lim inn linjer), og kan synkes automatisk når en channel manager kobles til. Datoer uten pris kan ikke bookes og vises i rødt for admin. |
| **Sengeplasser og maks personer** | Hvert rom defineres med senger: type (dobbel, enkel, køye nedre/øvre, sovesofa, ekstramadrass, barneseng), størrelse (90×200, 150×200, 180×200 … eller egendefinert), antall plasser og om sengen kun er for barn, samt maks personer i rommet. Sengeplasser = sum per rom av sengenes plasser, begrenset av rommets maks; barnesenger telles ikke. Maks personer per bolig følger sengeplassene automatisk, eller settes manuelt – men aldri høyere enn sengeplassene, og reduseres automatisk hvis senger fjernes. Medlemmene ser soverommene med sengetype og størrelse. |
| **Gjester og tillegg** | Prisen gjelder for et antall personer per bolig (standard 4). Hver ekstra person (spedbarn teller ikke) koster et tillegg (standard 350 kr per opphold, kan settes per natt) som dekker sengetøy, håndklær og ekstra leie. Tillegg som ekstra sett sengetøy og håndklær (250 kr per sett: dyne, pute, laken og håndklær liten/medium/stor) og vedsekk (125 kr) har navn, innhold, pris og pristype som alle kan endres i admin. |
| **Hva medlemmet sparer** | 1) Ingen Airbnb-serviceavgift (ca. 15 %, kan justeres – brukes i sammenligningen), 2) fast medlemsrabatt (standard 10 %, kan justeres og overstyres per medlem), 3) lojalitetsrabatt som starter på 0 % og øker 1 % per booking til maks 10 %, 4) vervebonus (maks 10 ubrukte vervebonuser før de må brukes; justerbart). Prisboksen viser «Samme opphold på Airbnb» mot «Din pris som medlem» og total besparelse i kroner og prosent. Siden *Medlemsfordeler* har et regneeksempel og rabattrappen. |
| **Medlemsrabatt** | Alle medlemmer får en standardrabatt på overnattingsprisen (standard 10 %, settes i admin under *Medlemsfordeler*). Admin kan gi enkeltmedlemmer en personlig grunnrabatt. I tillegg øker rabatten med 1 prosentpoeng per booking (starter på 0 %) (bekreftet eller fullført, kansellerte teller ikke) opp til 10 % ekstra. Steg og tak kan endres. Rabatten låses i prisen ved godkjenning, vises med ordinær pris overstreket, og medlemmet får e-post når rabatten øker. Siden *Medlemsfordeler* forklarer de tre fordelene og viser hvor medlemmet står på rabattrappen. |
| **Verving og bonus** | Den som inviterer og den som blir invitert får hver sin bonus (standard 500 kr hver) når den inviterte fullfører sitt **første** opphold. Hver invitert person gir bonus bare én gang (senere opphold gir ingenting), men et medlem kan invitere så mange det vil og får bonus for hver persons første opphold. Medlemmer kan sende **maks 50 invitasjoner per 7 dager** (justerbart under *Bonus*; gjelder ikke administratorer); siden viser hvor mange som er igjen, og grensen holder også ved samtidige innsendinger. Fast beløp eller prosent (med tak og minste oppholdsverdi) – alt i admin. Opptjening (7 d), gyldighet (2 år), bonuslommebok og full transaksjonshistorikk. Brukes FIFO som rabatt ved godkjenning, gis tilbake ved avslag/utløp/kansellering. Admin kan justere og trekke tilbake. Duplikater er umulige (unik indeks per vervning og part + radlås). Selvverving blokkeres i databasen; suspendert verver får ingenting. |
| **Boliger** | Ubegrenset antall. Detaljer, bilder, fasiliteter, husregler, maks gjester, inn-/utsjekktid, sluttrengjøring, tillegg (per opphold/natt/gjest/stk), sesongpriser (Lavsesong/Høysesong/Ferie) med perioder som kan overstyre pris/rabatt/min/maks netter, «hel periode» og fast byttedag, langtidsrabatt, årsoversikt som viser uprisede dager i rødt, manuelle sperringer. |
| **Booking** | Søk/velg datoer → serverberegnet pris → forespørsel → admin godkjenner/avslår → datoene holdes (48 t, faktura 14 d) → betaling → bekreftet → renholdsoppgave → fullført → bonus. Pris beregnes på nytt og **låses ved godkjenning**. Kansellering etter konfigurerbare vilkår (≥30 d 100 %, 10–29 d 50 %, <10 d krever godkjenning; ubehandlet etter 48 t = automatisk godkjent i medlemmets favør). |
| **Dobbeltbooking** | `EXCLUDE USING GIST (property_id WITH =, date_range WITH &&)` på én tabell som *alle* sperringer går gjennom (egne bookinger, manuelle, eksterne). Testet med 20 samtidige godkjenninger → nøyaktig én lykkes. |
| **Betaling** | Stripe Checkout (kortdata berører aldri plattformen), verifisert webhook, hver hendelse lagres én gang (`webhook_events`), idempotente handlere, maks én vellykket betaling per booking (unik indeks), automatisk refusjon hvis betaling kommer inn etter at datoene er frigitt, refusjoner med ny-forsøk, faktura med norsk KID (MOD10) og «marker betalt», betalingshistorikk. Uten Stripe-nøkler brukes en tydelig merket **testleverandør** (kun utvikling) som går gjennom samme signerte webhook-sti. |
| **Kanaler** | Abstraksjonslag (`lib/channels`) der hver integrasjon oppgir hva den faktisk kan. iCal-import (polling, streng parsing – en feil sletter aldri data), iCal-eksport per kanal med hemmelig roterbar lenke (eksporterer ikke en kanals egne bookinger tilbake til den), deteksjon av speiling vs. **ekte konflikt** med varsel, synkstatus, feilteller og varsel, kjørelogg. Guesty/Hostaway-adaptere er koblet inn, men ikke implementert (se §4). |
| **Admin** | Oversikt med godkjenningskø, KPI-er, belegg, ankomster, synk- og renholdsstatus · sentral kalender (alle boliger × dager × kanaler) · bookinger · boliger · kanaler · medlemmer/ansatte/vervetre · bonus · betalinger/fakturaer/refusjoner · renhold · rapporter · innstillinger (alle frister og regler) · revisjonslogg. |
| **Renholdsportal** | Egen rolle, mobil først. Admin inviterer renholderen, som registrerer seg selv med navn, mobil (påkrevd) og e-post og blir knyttet til boligen. Varsler på e-post og SMS (kan slås av/på i egen profil): ny booking/ny vask, tildelt, flyttet, avlyst, endret info om neste gjester, dagen før og påminnelse samme morgen (klokkeslett i innstillinger). I dag (utsjekk/innsjekk), dag/uke/måned, kort snutid uthevet, adresse, tider, antall gjester ut og inn, frist, instrukser. Start/ferdig, merk hvert rom ferdig, rapporter skade/mangel/avvik med bilde, kommentarer, bildeopplasting. Ser **ingen** navn, kontaktinfo, priser, betalinger eller verving. Ser kun tildelte oppgaver med mindre admin gir utvidet tilgang. |
| **Sengeoppsett** | Rom med bilde, etasje, maks personer og sengeinstruks; senger med type (dobbel, enkel, køye nedre/øvre, sovesofa, ekstramadrass, barneseng), plasser, mål, prioritet og «kun barn». Fordelingen bruker romoppsett og kapasitet per seng – ikke gjester ÷ senger. Viser per rom hvilke senger som skal redes, hvilke som står ubrukt, og antall sengesett/dyner/puter/håndklær. Admin kan overstyre per booking. Hytta er lagt inn etter plantegningene (5 rom, 8 plasser + barneseng/madrass). |
| **Presentasjoner (PDF) og invitasjoner** | Admin laster opp PDF-presentasjoner (bilder, informasjon og medlemsfordeler) under *Medlemmer → Presentasjoner (PDF)*: tittel, valgfri bolig, standard, skjul/aktiver, forhåndsvisning og hvor mange invitasjoner den er brukt i. Kun ekte PDF-er under 20 MB godtas (sjekkes på filinnhold). På invitasjonsskjemaet (admin og medlemmer) velges hvilken presentasjon som skal legges ved (standard er forhåndsvalgt, eller «Ikke legg ved») og språket i invitasjonen. PDF-en sendes som vedlegg i e-posten (filer over 15 MB sendes som lenke) og kan åpnes fra invitasjonssiden. Invitasjonen (e-post og side) beskriver medlemsfordelene med gjeldende satser fra innstillingene. Innloggede medlemmer finner aktive presentasjoner under *Medlemsfordeler*. Filene lagres utenfor den offentlige mappen og vises bare for administratorer, innloggede medlemmer og den som har en gyldig invitasjonslenke. |
| **Synlighet av fordeler** | Medlemsfordelene (rabatter, avgift, bonus) vises **ikke** på de offentlige sidene (forsiden og venner-siden). De vises bare i invitasjonen og i medlemsportalen etter innlogging. |
| **Meldinger** | Medlemmene har en innboks under *Meldinger* i medlemsportalen: de kan starte en samtale (emne, valgfri booking, melding), svare og se hele historikken. Fra en booking kan de trykke «Spør oss om denne bookingen». Admin har en felles innboks under *Medlemmer → Meldinger* med filtre (Venter på svar / Åpne / Avsluttede / Alle), søk i navn, emne, tekst og bookingref., medlemsinfo ved siden av samtalen, og kan avslutte og åpne samtaler igjen. Admin kan også starte en samtale fra medlemssiden eller bookingsiden. Antall uleste vises i menyen på begge sider, og sidene oppdateres automatisk (hvert 15.–30. sek) mens de er åpne. Varsling på e-post: administratorene når et medlem skriver, medlemmet når admin svarer (på medlemmets valgte språk, med lenke). Det sendes bare én e-post til meldingene er lest, så flere meldinger etter hverandre gir ikke mange e-poster. Historikken kan ikke endres eller slettes (låst i databasen), samtaler er bare synlige for medlemmet selv og administratorene, og meldingene er med i dataeksporten. |
| **Varsler** | Outbox-tabell (sendes kun hvis endringen committes), dedupe-nøkler, e-post via Resend. Kanalfeltet (`email/sms/push`) er klart for SMS/push. Dekker alle hendelser i spesifikasjonen. |
| **Sikkerhet/GDPR** | All autorisasjon server-side (én tilgangsmatrise, `lib/auth/rbac.ts`), append-only revisjonslogg håndhevet med trigger, ingen harde slettinger av forretningsdata, bildeopplasting validert på filsignatur og servert kun til autoriserte, sikkerhetsheadere, dataeksport (JSON) og anonymisering, oppbevaringsjobb. |

### Design
Logoen (mountainretreat.no) brukes i en lys versjon med gull sol for den mørke bakgrunnen: stor på forsiden, i sidemenyen i admin- og medlemsportalen, på innlogging, i renholdsportalen (kun illustrasjonen) og som app-ikon. E-poster bruker en mørk versjon. Filene ligger i `public/brand/` (logo-light, logo-dark, mark-light) og `app/icon.png`.

Mørk, eksklusiv profil: sort/antrasitt bakgrunn, gull/beige detaljer, Cormorant Garamond (titler) + Inter (tekst), selvhostet via `@fontsource` (ingen eksterne kall). Admin- og medlemsportalen har fast venstre sidemeny med aktiv markering; renholdsportalen har bunnmeny tilpasset mobil. Dashboards bruker informasjonskort, serverrendrede SVG-grafer (belegg per måned fordelt på egne/eksterne bookinger, beleggsringer per bolig, innbetalt per måned) og rene tabeller. Alle farger ligger som CSS-variabler øverst i `app/globals.css`.

## 2. Databasestruktur

Fullt skjema: `db/migrations/0001_schema.sql` (+ standardinnstillinger i `0002`, bekreftelseskode, språkvalg og meldinger i `0003`, presentasjoner i `0004`, ukesgrense for invitasjoner i `0005`). Beløp i øre (heltall).

- **Identitet:** `users`, `login_tokens`, `sessions`, `rate_limits`
- **Medlemskap/verving:** `invitations`, `loyalty_applications`, `referrals`
- **Bolig/pris:** `properties`, `season_categories`, `pricing_periods`, `length_of_stay_discounts`, `add_on_items`, `member_cleaning_exemptions`, `cancellation_policy_tiers`
- **Rom/senger:** `rooms`, `beds`, `stay_preparations`, `stay_sleeping_plan`, `room_preparation_status`
- **Kalender/kanaler:** `availability_blocks` (eksklusjonsbegrensning), `channel_connections`, `external_calendar_events`, `channel_sync_runs`
- **Booking:** `bookings`, `booking_add_ons`, `booking_holds`
- **Betaling:** `payment_method_settings`, `payments`, `invoices`, `refunds`, `webhook_events`
- **Bonus:** `reward_credits`, `reward_redemptions`, `reward_transactions`
- **Renhold:** `helper_property_assignments`, `cleaning_tasks`, `cleaning_reports`, `photos`
- **Meldinger:** `conversations`, `messages` (kan ikke endres/slettes)
- **Presentasjoner:** `presentations` (+ `invitations.presentation_id`, `invitations.lang`)
- **Drift:** `platform_settings`, `audit_log`, `notifications`, `job_runs`, `captcha_used`

## 3. Integrasjoner som virker (implementert og testet)

- iCal-import (parsing, diff, avlysning frigjør datoer, konflikt-/speilingsdeteksjon) – testet mot iCal-fikstur
- iCal-eksport per kanal – testet
- Stripe Checkout + webhook – implementert etter Stripes API; **ikke kjørt mot ekte Stripe-konto** (ingen nøkler her). Hele flyten er testet ende til ende via testleverandøren som bruker samme kode.
- E-post via Resend – implementert; uten nøkkel skrives e-post til serverloggen

## 4. Krever konto, nøkler eller oppsett

| Integrasjon | Status | Hva trengs |
|---|---|---|
| Stripe | Klar, utestet mot live | `STRIPE_SECRET_KEY`, webhook til `/api/webhooks/stripe` med hendelsene `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` → `STRIPE_WEBHOOK_SECRET` |
| Airbnb / Booking.com / Vrbo / Expedia via iCal | Klar | Lim inn hver kanals iCal-lenke (import) og legg vår eksportlenke inn hos kanalen. Seed-lenkene er plassholdere. |
| Resend (e-post) | Klar | `RESEND_API_KEY`, verifisert avsenderdomene (mountainretreat.no), EU-region |
| Vipps ePayment | **Kun struktur** | Vipps MobilePay-avtale + API-nøkler; adapteren må implementeres og testes |
| Guesty / Hostaway | **Kun struktur** | Konto, API-nøkler og en testannonse; adapteren må implementeres og testes |
| Direkte Airbnb/Booking.com-API | **Ikke tilgjengelig** | Krever godkjent partnerstatus – bruk iCal eller channel manager |
| SMS (renhold) | Klar, utestet mot live | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (norsk avsendernummer/alfanumerisk avsender). Uten nøkler skrives SMS til serverloggen. |
| Cloudflare Turnstile (valgfritt) | Klar, utestet mot live | Gratis konto hos Cloudflare → Turnstile → legg til mountainretreat.no → sett `TURNSTILE_SITE_KEY` og `TURNSTILE_SECRET_KEY`. Uten nøkler brukes den innebygde bekreftelseskoden. Turnstile kontakter Cloudflare, så nevn det i personvernerklæringen hvis dere slår det på. |
| Push | Ikke bygget | Kanalfeltet finnes; avsender må legges til |
| Fillagring (Supabase Storage) | Klar, testet mot etterligning av API-et | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`; bøtten lages av `db/supabase/1-oppsett.sql`. Uten disse brukes lokal mappe (`STORAGE_DIR`) |

**Om iCal:** Det er ikke sanntid. Vi henter med fast intervall (standard 30 min), og kanalene henter vår lenke på egen timeplan (ofte 30 min – flere timer). Admin-godkjenning er siste kontroll, og overlapp fra en kanal varsles som konflikt. For sanntid trengs en channel manager.

## 5. Testresultater

`npm test` – **83 tester, 16 filer, alle grønne** (mot ekte PostgreSQL):
- `pricing` (11): ekstra gjester (per opphold/natt, med i Airbnb-sammenligningen), Airbnb-prising (nattpris, rabatter, sammenligning inkl. avgift, manglende pris, min. netter), spesifikasjonens eksempel (14 175 kr), min/maks netter, hel periode, byttedag, uprisede datoer, tillegg, vaskefritak
- `booking` (13): hele flyten, prislåsing, 2 og 20 samtidige godkjenninger → én vinner, idempotent webhook-replay, holdutløp + automatisk refusjon av sen betaling, kanselleringsvilkår + automatisk godkjenning, dobbeltinnsending, tilgang
- `rewards` (11): tak på ubrukte vervebonuser, én bonus per part selv ved gjentatte/samtidige utløsere, kun første opphold, prosent med tak, minstebeløp, selvverving, suspendert verver, FIFO + tilbakeføring, 100 % bonusdekning, justering/tilbaketrekking/hovedbok, ende til ende
- `access` (12): tilgangsmatrise, invitasjonsflyt, duplikater, utløpt/tilbaketrukket invitasjon, invitasjonsrett etter godkjenning, magic link, øktutløp, rate limiting, renholdsisolasjon, soveplan + overstyring, append-only logg
- `capacity` (2): sengeplasser per rom med rombegrensning og uten barneseng, manuelt maks kan ikke overstige sengeplassene og reduseres når senger fjernes
- `beds` (5): eksempelet fra oppgaven (3 gjester → dobbel + nedre køye, øvre og sovesofa ubrukt), barn, sovesofa sist, barneseng, romkapasitet
- `discount` (3): standard + 1 % per booking med tak, kansellerte teller ikke, varsel ved økning, personlig overstyring
- `cleaning-notify` (2): renholder registrerer seg (mobil påkrevd) og knyttes til bolig; ny booking gir e-post + SMS etter egne valg, uten gjestenavn; påminnelse samme dag sendes én gang
- `inquiry` (3): fast leie-forespørsel lagres, sendes til riktig adresse med svar-til avsender og bekreftes; validering, honeypot og rate limiting; bekreftelseskode (mangler, feil, brukt før, for rask, utløpt, forfalsket signatur, store/små bokstaver og mellomrom)
- `messages` (3): medlem spør → admin varsles én gang til det er lest → admin svarer → medlemmet varsles på sitt språk, uleste-tellere; andre medlemmer og renholdere har ikke tilgang; historikken kan ikke endres/slettes; avslutt/åpne igjen (medlemssvar åpner); admin starter samtale; validering og rate limiting
- `presentations` (3): kun admin laster opp, kun ekte PDF under 20 MB, standard og skjul; invitasjons-e-post beskriver fordelene, legger ved valgt PDF og følger valgt språk (norsk/engelsk); skjult presentasjon kan ikke legges ved; vedlegget lastes ved utsending; medlemmer kan legge ved
- `invite-limit` (3): 50 invitasjoner per uke (51. avvises med tidspunkt for neste, tilbaketrukne teller, vinduet ruller), justerbar grense som holder ved samtidige innsendinger, gjelder ikke admin; den som inviterer får 500 kr for hver invitert persons første opphold, den inviterte 500 kr én gang, senere opphold gir ingenting
- `storage` (2): Supabase Storage-adapteren (lagre, hente, signerte lenker, nøkkel i `apikey`-headeren, avviser farlige filnavn); direkte PDF-opplasting fra nettleser, kontroll av filen etterpå, ugyldig fil slettes, kun admin
- `dbconfig` (1): Supabase-adresse gir TLS, `sslmode` fjernes fra adressen, sertifikatet sjekkes når `DATABASE_CA_CERT` er satt
- `render` (3): sikkerhetskopien har alle filer og tabeller (uten økter/innloggingslenker), manglende filer legges tilbake fra arkivet uten å overskrive, ukjente filer og ugyldige arkiv avvises; første deploy oppretter hovedadministrator fra `INITIAL_ADMIN_EMAIL` kun én gang; bakgrunnsjobbene kjører ikke når en annen instans har låsen
- `channels` (7): parsing, import/avlysning, konflikt, speiling, feil sletter ikke data, eksport uten ekko, ærlig kapabilitetsstatus

I tillegg: produksjonsbygg OK, kjørt i produksjonsmodus med Render-oppsett (disk + innebygde jobber, helsesjekk grønn), alle sider testet for alle roller, og nettleserflyt ende til ende (forespørsel → godkjenning → testbetaling → bekreftet → invitasjon).

## 6. Kjente begrensninger

- Airbnb-prisene hentes ikke automatisk (Airbnb har ikke åpent pris-API, og skraping bryter vilkårene). De legges inn manuelt/lim inn til en channel manager kobles til. Sammenligningen bruker en fast avgiftsprosent (Airbnbs faktiske gjesteavgift varierer noe).

- Vipps, Guesty, Hostaway og push er ikke funksjonelle (se §4). SMS er implementert mot Twilio, men ikke testet med ekte nøkler.
- Stripe er ikke verifisert mot en ekte konto.
- E-postendring gjøres av admin (ingen selvbetjent flyt). Ingen passkey/WebAuthn.
- Rapportene er enkle (inntekt, belegg, trakt, verving) – ingen eksport til regnskap (Fiken) ennå.
- Personlig iCal-feed for renholdere (fra spesifikasjonen) er ikke laget.
- Endring av datoer på en eksisterende booking gjøres ved å kansellere og sende ny forespørsel.
- Innhold som admin skriver inn (boligbeskrivelser, romnavn, fasiliteter, husregler, tillegg) vises på det språket det er skrevet på – det finnes ikke egne engelske felt ennå. Admin- og renholdsportalen er kun på norsk. E-post om meldinger og bekreftelsen ved fast leie sendes på valgt språk; øvrige e-poster/SMS til medlemmer sendes foreløpig på norsk.
- Sideoppdateringer er serverrendret. Meldingssidene henter nye meldinger automatisk hvert 15.–30. sekund (ikke sanntid); renholdere må laste siden på nytt.
- PDF-presentasjoner byttes ved å laste opp en ny og skjule den gamle (ingen versjonering). Fordelene i invitasjonen er standardtekster med satsene fra innstillingene – selve teksten endres i `lib/domain/inviteBenefits.ts`.
- Meldinger støtter ikke vedlegg/bilder ennå, og det sendes ikke SMS-varsel om meldinger.
- Den innebygde bekreftelseskoden er et bilde og har ingen lydversjon; derfor står e-postadressen ved feltet som alternativ. Turnstile har bedre tilgjengelighet hvis det er viktig.

## 7. Kjøre lokalt

```bash
npm install
cp .env.example .env.local      # fyll inn ENCRYPTION_KEY, TOKEN_PEPPER, CRON_SECRET (openssl rand -base64 32)
createdb byrampen
npm run db:reset                # migreringer + testdata
npm run dev                     # http://localhost:3000
npm run jobs -- --loop          # bakgrunnsjobber hvert minutt (eget vindu)
npm test                        # krever databasen byrampen_test
```
Med `DEV_LOGIN=1` viser `/login` en liste for ett-klikks innlogging som alle testbrukerne (aldri i produksjon). Ventende renholderinvitasjon: `/invitasjon/dev-helper-invite`. Testbrukere: `admin@fkeproperty.test` (super-admin), `eiendom@fkeproperty.test` (eiendomsadmin), `kari@` / `ola@` / `lise@example.test` (medlemmer), `renhold@` og `renhold2@fkeproperty.test` (renhold). Ventende invitasjon: `/invitasjon/dev-invite-token-per`.

## 8. Produksjonssetting (anbefalt: GitHub + Render + Resend + Domeneshop)

Full steg-for-steg-guide på norsk: dokumentet «Mountain Retreat – test og lansering på Render» (lenke i chatten). Alt er beskrevet i `render.yaml` (Render Blueprint), så Render setter opp nettside, database, disk og nøkler selv. Ca. 14 USD/mnd (Starter-nettside 7 + Postgres basic-256mb 6 + 1 GB disk 0,25), region Frankfurt.

1. **GitHub:** privat repo `mountainretreat-platform`.
2. **Resend:** verifiser mountainretreat.no (MX/TXT på `send`, DKIM på `resend._domainkey` i Domeneshop).
3. **Render → New → Blueprint** → velg repoet. Render lager:
   - nettsiden `mountainretreat` (Node 22, `npm ci && npm run build`, `npm start`, helsesjekk `/api/health`)
   - databasen `mountainretreat-db` (Postgres 16, ingen tilgang utenfra – `ipAllowList: []`)
   - disken `files` på `/var/data` (bilder og PDF-er i `STORAGE_DIR=/var/data/storage`)
   - `ENCRYPTION_KEY`, `TOKEN_PEPPER`, `CRON_SECRET` som tilfeldige 256-bits verdier; `DATABASE_URL` kobles automatisk.
   Du fyller inn: `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, `RESEND_API_KEY`, `EMAIL_REPLY_TO`, `ALLOW_MOCK_PAYMENTS` (1 under test, 0 i drift).
4. **Før hver versjon** kjører `npm run migrate` (preDeployCommand): nye migreringer, og ved første gang opprettes hovedadministratoren fra `INITIAL_ADMIN_EMAIL` (bare hvis det ikke finnes noen aktiv super-admin).
5. **Bakgrunnsjobber** kjører inne i nettsiden hvert minutt (`RUN_JOBS_IN_PROCESS=1`, `lib/scheduler.ts`). En låsing i databasen (`pg_try_advisory_lock`) gjør at de aldri kjører to ganger samtidig, selv med flere instanser. E-post sendes i tillegg rett etter hver handling.
6. **Domene:** Render → Settings → Custom Domains: `mountainretreat.no` og `www.mountainretreat.no`. I Domeneshop: A-post `@` → `216.24.57.1`, CNAME `www` → `mountainretreat.onrender.com`, slett AAAA-poster for `@`/`www`. MX/TXT for e-post røres ikke. Legg så til `APP_URL=https://mountainretreat.no` (før det brukes `RENDER_EXTERNAL_URL`).
7. **Sikkerhetskopi i tre lag:** Render tar backup av databasen med gjenoppretting til valgfritt tidspunkt (3 dager på Hobby, 7 på Pro). Disken får daglige øyeblikksbilder. I tillegg kan hovedadministrator laste ned alt fra `/admin/sikkerhetskopi`: én `.tar.gz` med alle filer og hver tabell som NDJSON. Økter, innloggingslenker og rate limits er utelatt. Filer kan legges tilbake derfra; bare manglende filer databasen kjenner til, ingenting overskrives. Både nedlasting og tilbakelegging logges.
8. **Drift:** overvåk `/api/health`. Den viser database, migreringer, antall admins, siste jobbkjøring, lagring (`disk (/var/data/storage)`), e-post, app-adresse og manglende nøkler, men aldri hemmeligheter.

### 8b. Alternativ: Supabase + Vercel

Koden er tilpasset Vercel (serverløst) og Supabase. Full steg-for-steg-guide på norsk: dokumentet «Mountain Retreat – test og lansering» (lenke i chatten). Kortversjon:

1. **GitHub:** privat repo `mountainretreat-platform`.
2. **Supabase (EU, Stockholm):** kjør `db/supabase/1-oppsett.sql` (alle migreringer, låser tabellene for Supabase sitt offentlige API med RLS og fjerner rettigheter for `anon`/`authenticated`, lager den private bøtten `mountainretreat`, tidssone Europe/Oslo), så `2-forste-admin.sql`. Filen genereres fra `db/migrations` med `npm run supabase:sql`.
3. **Resend:** verifiser mountainretreat.no (MX/TXT på `send`, DKIM på `resend._domainkey` i Domeneshop).
4. **Vercel:** importer repoet. Miljøvariabler: `DATABASE_URL` (Supabase *Transaction pooler*, port 6543, `?sslmode=require`), `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (`sb_secret_…`), `SUPABASE_BUCKET`, `APP_URL`, `ENCRYPTION_KEY`, `TOKEN_PEPPER`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, valgfritt `DATABASE_CA_CERT`, `STRIPE_*`, og kun under testing `ALLOW_MOCK_PAYMENTS=1`. Region `arn1` (Stockholm) er satt i `vercel.json`.
5. **Bakgrunnsjobber:** `db/supabase/3-bakgrunnsjobber.sql` (pg_cron + pg_net kaller `/api/cron` hvert minutt med `x-cron-secret`). E-post sendes i tillegg rett etter hver handling (`after()`), så innloggingslenker kommer på sekunder.
6. **Domene:** A-post for `@` og CNAME for `www` i Domeneshop etter verdiene Vercel viser; MX/TXT for e-post røres ikke. Oppdater `APP_URL` og kjør `3-bakgrunnsjobber.sql` på nytt.
7. **Drift:** Vercel Pro (Hobby er kun ikke-kommersielt) og Supabase Pro (ingen pause, daglig backup). Overvåk `/api/health` (viser hva som er konfigurert, aldri hemmeligheter).

**Tilpasninger for Vercel:** filer lagres i Supabase Storage (privat bøtte; appen sjekker tilgang og gir en signert lenke som varer 60–120 sek), PDF-er lastes opp direkte fra nettleseren til Supabase (Vercel tar maks 4,5 MB per forespørsel), bilder krympes i nettleseren før opplasting (maks 2000 px), databasetilkoblingen bruker små pooler og TLS, og svg-captcha-fonten pakkes med funksjonene. Lokalt brukes fortsatt `STORAGE_DIR` når Supabase-variablene mangler.

