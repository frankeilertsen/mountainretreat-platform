# Mountain Retreat – Friends & Family-plattform (Byrampen Eiendom AS)

Privat, invitasjonsbasert bookingplattform med medlemsportal, administrasjon, renholdsportal, verveprogram, betaling og kanalsynk.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL 16 (rene SQL-migreringer + `pg`) · Stripe · iCal · Resend (e-post). Ingen Redis – jobber og rate limiting går i Postgres (holder godt for dusinvis av medlemmer og et lite antall boliger).

---

## 1. Hva er bygget

| Område | Innhold |
|---|---|
| **Innlogging** | Ingen åpen registrering. E-postlenke (magic link, 15 min, engangs) + obligatorisk TOTP med 10 gjenopprettingskoder. Øktgrenser i databasen (admin 12 t / 30 min inaktivitet, andre 24 t / 60 min). Låsing etter 5 feil TOTP, rate limiting på innlogging/invitasjoner. |
| **Invitasjoner og medlemskap** | Personlig engangslenke (hash lagret), knyttet til inviterende. Hele vervetreet spores. Medlemmer invitert av admin kan invitere; medlemmer invitert av medlemmer må søke og godkjennes. Admin kan invitere, trekke tilbake, suspendere, tilbakekalle (kansellerer aktive bookinger + refunderer), nullstille tofaktor og logge ut alle økter. Duplikater hindres (unik e-post uten hensyn til store/små bokstaver, én aktiv invitasjon per adresse, ingen selvinvitasjon). |
| **Verving og bonus** | Begge parter får bonus når den inviterte fullfører sitt **første** opphold. Fast beløp eller prosent (med tak og minste oppholdsverdi) – alt i admin. Opptjening (7 d), gyldighet (2 år), bonuslommebok og full transaksjonshistorikk. Brukes FIFO som rabatt ved godkjenning, gis tilbake ved avslag/utløp/kansellering. Admin kan justere og trekke tilbake. Duplikater er umulige (unik indeks per vervning og part + radlås). Selvverving blokkeres i databasen; suspendert verver får ingenting. |
| **Boliger** | Ubegrenset antall. Detaljer, bilder, fasiliteter, husregler, maks gjester, inn-/utsjekktid, sluttrengjøring, tillegg (per opphold/natt/gjest/stk), sesongpriser (Lavsesong/Høysesong/Ferie) med perioder som kan overstyre pris/rabatt/min/maks netter, «hel periode» og fast byttedag, langtidsrabatt, årsoversikt som viser uprisede dager i rødt, manuelle sperringer. |
| **Booking** | Søk/velg datoer → serverberegnet pris → forespørsel → admin godkjenner/avslår → datoene holdes (48 t, faktura 14 d) → betaling → bekreftet → renholdsoppgave → fullført → bonus. Pris beregnes på nytt og **låses ved godkjenning**. Kansellering etter konfigurerbare vilkår (≥30 d 100 %, 10–29 d 50 %, <10 d krever godkjenning; ubehandlet etter 48 t = automatisk godkjent i medlemmets favør). |
| **Dobbeltbooking** | `EXCLUDE USING GIST (property_id WITH =, date_range WITH &&)` på én tabell som *alle* sperringer går gjennom (egne bookinger, manuelle, eksterne). Testet med 20 samtidige godkjenninger → nøyaktig én lykkes. |
| **Betaling** | Stripe Checkout (kortdata berører aldri plattformen), verifisert webhook, hver hendelse lagres én gang (`webhook_events`), idempotente handlere, maks én vellykket betaling per booking (unik indeks), automatisk refusjon hvis betaling kommer inn etter at datoene er frigitt, refusjoner med ny-forsøk, faktura med norsk KID (MOD10) og «marker betalt», betalingshistorikk. Uten Stripe-nøkler brukes en tydelig merket **testleverandør** (kun utvikling) som går gjennom samme signerte webhook-sti. |
| **Kanaler** | Abstraksjonslag (`lib/channels`) der hver integrasjon oppgir hva den faktisk kan. iCal-import (polling, streng parsing – en feil sletter aldri data), iCal-eksport per kanal med hemmelig roterbar lenke (eksporterer ikke en kanals egne bookinger tilbake til den), deteksjon av speiling vs. **ekte konflikt** med varsel, synkstatus, feilteller og varsel, kjørelogg. Guesty/Hostaway-adaptere er koblet inn, men ikke implementert (se §4). |
| **Admin** | Oversikt med godkjenningskø, KPI-er, belegg, ankomster, synk- og renholdsstatus · sentral kalender (alle boliger × dager × kanaler) · bookinger · boliger · kanaler · medlemmer/ansatte/vervetre · bonus · betalinger/fakturaer/refusjoner · renhold · rapporter · innstillinger (alle frister og regler) · revisjonslogg. |
| **Renholdsportal** | Egen rolle, mobil først. I dag (utsjekk/innsjekk), dag/uke/måned, kort snutid uthevet, adresse, tider, antall gjester ut og inn, frist, instrukser. Start/ferdig, merk hvert rom ferdig, rapporter skade/mangel/avvik med bilde, kommentarer, bildeopplasting. Ser **ingen** navn, kontaktinfo, priser, betalinger eller verving. Ser kun tildelte oppgaver med mindre admin gir utvidet tilgang. |
| **Sengeoppsett** | Rom med bilde, etasje, maks personer og sengeinstruks; senger med type (dobbel, enkel, køye nedre/øvre, sovesofa, ekstramadrass, barneseng), plasser, mål, prioritet og «kun barn». Fordelingen bruker romoppsett og kapasitet per seng – ikke gjester ÷ senger. Viser per rom hvilke senger som skal redes, hvilke som står ubrukt, og antall sengesett/dyner/puter/håndklær. Admin kan overstyre per booking. Hytta er lagt inn etter plantegningene (5 rom, 8 plasser + barneseng/madrass). |
| **Varsler** | Outbox-tabell (sendes kun hvis endringen committes), dedupe-nøkler, e-post via Resend. Kanalfeltet (`email/sms/push`) er klart for SMS/push. Dekker alle hendelser i spesifikasjonen. |
| **Sikkerhet/GDPR** | All autorisasjon server-side (én tilgangsmatrise, `lib/auth/rbac.ts`), append-only revisjonslogg håndhevet med trigger, ingen harde slettinger av forretningsdata, bildeopplasting validert på filsignatur og servert kun til autoriserte, sikkerhetsheadere, dataeksport (JSON) og anonymisering, oppbevaringsjobb. |

## 2. Databasestruktur

Fullt skjema: `db/migrations/0001_schema.sql` (+ standardinnstillinger i `0002`). Beløp i øre (heltall).

- **Identitet:** `users`, `login_tokens`, `sessions`, `rate_limits`
- **Medlemskap/verving:** `invitations`, `loyalty_applications`, `referrals`
- **Bolig/pris:** `properties`, `season_categories`, `pricing_periods`, `length_of_stay_discounts`, `add_on_items`, `member_cleaning_exemptions`, `cancellation_policy_tiers`
- **Rom/senger:** `rooms`, `beds`, `stay_preparations`, `stay_sleeping_plan`, `room_preparation_status`
- **Kalender/kanaler:** `availability_blocks` (eksklusjonsbegrensning), `channel_connections`, `external_calendar_events`, `channel_sync_runs`
- **Booking:** `bookings`, `booking_add_ons`, `booking_holds`
- **Betaling:** `payment_method_settings`, `payments`, `invoices`, `refunds`, `webhook_events`
- **Bonus:** `reward_credits`, `reward_redemptions`, `reward_transactions`
- **Renhold:** `helper_property_assignments`, `cleaning_tasks`, `cleaning_reports`, `photos`
- **Drift:** `platform_settings`, `audit_log`, `notifications`, `job_runs`

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
| SMS / push | Ikke bygget | Kanalfeltet finnes; avsender må legges til |
| Fillagring i sky | Lokal mappe | Bytt `lib/domain/cleaning.ts › savePhoto` til EU S3-kompatibel bøtte ved serverløs hosting |

**Om iCal:** Det er ikke sanntid. Vi henter med fast intervall (standard 30 min), og kanalene henter vår lenke på egen timeplan (ofte 30 min – flere timer). Admin-godkjenning er siste kontroll, og overlapp fra en kanal varsles som konflikt. For sanntid trengs en channel manager.

## 5. Testresultater

`npm test` – **53 tester, 6 filer, alle grønne** (mot ekte PostgreSQL):
- `pricing` (7): spesifikasjonens eksempel (14 175 kr), min/maks netter, hel periode, byttedag, uprisede datoer, tillegg, vaskefritak
- `booking` (13): hele flyten, prislåsing, 2 og 20 samtidige godkjenninger → én vinner, idempotent webhook-replay, holdutløp + automatisk refusjon av sen betaling, kanselleringsvilkår + automatisk godkjenning, dobbeltinnsending, tilgang
- `rewards` (10): én bonus per part selv ved gjentatte/samtidige utløsere, kun første opphold, prosent med tak, minstebeløp, selvverving, suspendert verver, FIFO + tilbakeføring, 100 % bonusdekning, justering/tilbaketrekking/hovedbok, ende til ende
- `access` (12): tilgangsmatrise, invitasjonsflyt, duplikater, utløpt/tilbaketrukket invitasjon, invitasjonsrett etter godkjenning, magic link, øktutløp, rate limiting, renholdsisolasjon, soveplan + overstyring, append-only logg
- `beds` (5): eksempelet fra oppgaven (3 gjester → dobbel + nedre køye, øvre og sovesofa ubrukt), barn, sovesofa sist, barneseng, romkapasitet
- `channels` (7): parsing, import/avlysning, konflikt, speiling, feil sletter ikke data, eksport uten ekko, ærlig kapabilitetsstatus

I tillegg: produksjonsbygg OK, alle sider testet for alle roller, og nettleserflyt ende til ende (forespørsel → godkjenning → testbetaling → bekreftet → invitasjon).

## 6. Kjente begrensninger

- Vipps, Guesty, Hostaway, SMS og push er ikke funksjonelle (se §4).
- Stripe er ikke verifisert mot en ekte konto.
- E-postendring gjøres av admin (ingen selvbetjent flyt). Ingen passkey/WebAuthn.
- Rapportene er enkle (inntekt, belegg, trakt, verving) – ingen eksport til regnskap (Fiken) ennå.
- Bilder lagres på lokal disk; trenger skylagring på serverløs plattform.
- Personlig iCal-feed for renholdere (fra spesifikasjonen) er ikke laget.
- Endring av datoer på en eksisterende booking gjøres ved å kansellere og sende ny forespørsel.
- Sideoppdateringer er serverrendret uten live-oppdatering; renholdere må laste siden på nytt.

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
Med `DEV_LOGIN=1` viser `/login` en liste for ett-klikks innlogging som alle testbrukerne (aldri i produksjon). Testbrukere: `admin@byrampen.test` (super-admin), `eiendom@byrampen.test` (eiendomsadmin), `kari@` / `ola@` / `lise@example.test` (medlemmer), `renhold@` og `renhold2@byrampen.test` (renhold). Ventende invitasjon: `/invitasjon/dev-invite-token-per`.

## 8. Produksjonssetting

Anbefalt: én container på **Render, Fly.io (arn – Stockholm) eller Railway (EU)** + administrert **PostgreSQL 16 i EU** (Neon Frankfurt, Supabase EU eller Render Frankfurt). Container gir lokal disk for bilder; på Vercel må bildelagring byttes til S3 først.

1. **Database:** Opprett Postgres 16 i EU. Sett `DATABASE_URL`. Kjør `npm run migrate` (aldri `db:reset` i produksjon).
2. **Miljøvariabler:** `APP_URL=https://mountainretreat.no`, `ENCRYPTION_KEY`, `TOKEN_PEPPER`, `CRON_SECRET` (unike, tilfeldige, i hemmelighetslageret), `RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STORAGE_DIR=/data/storage` (vedvarende volum). **Ikke** sett `DEV_LOGIN` eller `ALLOW_MOCK_PAYMENTS`.
3. **Bygg og start:** `npm ci && npm run build && npm start` (Node 20+). Helsesjekk: `/api/health`.
4. **Første admin:** Opprett én super-admin i databasen:
   `INSERT INTO users (email, name, system_role, status) VALUES ('frank@…', 'Frank', 'super_admin', 'active');` → logg inn med e-postlenke og sett opp tofaktor. Inviter resten fra admin.
5. **Cron:** Kall `/api/cron` hvert minutt med header `x-cron-secret: $CRON_SECRET` (Render Cron Job, GitHub Actions, cron-job.org eller `npm run jobs -- --loop` som egen tjeneste).
6. **Stripe:** Legg inn webhook-endepunktet (§4), kopier signeringsnøkkelen, test med Stripe CLI (`stripe trigger checkout.session.completed`) og én ekte betaling på lavt beløp før åpning.
7. **Kanaler:** For hver bolig og kanal: legg til iCal-import (kanalens lenke) og iCal-eksport (lim vår lenke inn hos kanalen). Sjekk at «Hentet av kanalen» blir grønn innen et døgn.
8. **E-post:** Verifiser domenet i Resend (SPF/DKIM).
9. **Backup:** Slå på daglige snapshots + point-in-time recovery (7–30 dager) hos databaseleverandøren, og ta backup av bildevolumet. Test gjenoppretting én gang.
10. **Overvåking:** Oppetidsovervåking på `/api/health`; feilloggen fra plattformen (eller Sentry). Synkfeil og feilede refusjoner varsles allerede på e-post til admin.
