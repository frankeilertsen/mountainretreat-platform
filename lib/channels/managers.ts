import { ChannelAdapter } from './types';

/**
 * Channel-manager adapters (Guesty, Hostaway). The contract is defined and wired into the sync engine,
 * but the HTTP calls are NOT implemented: they need an account, API credentials and a test listing.
 * Until then these adapters report `requires_credentials` / throw, and the UI shows that clearly.
 *
 * Implementation plan once credentials exist:
 *  - fetchEvents: GET reservations for the listing (Guesty Open API /reservations, Hostaway /v1/reservations)
 *    → map to ExternalEvent incl. guest count (managers DO provide guest details, unlike iCal).
 *  - pushAvailability: PUT calendar blocks for our platform bookings/manual blocks (Guesty /availability-pricing,
 *    Hostaway /v1/listings/{id}/calendar). The manager then distributes to Airbnb/Booking.com/Vrbo in near real time.
 *  - webhooks: reservation.created/updated → /api/webhooks/channel/{provider}, verified + stored in webhook_events.
 */
function managerAdapter(name: string, envKeys: string[]): ChannelAdapter {
  const hasCreds = () => envKeys.every(k => !!process.env[k]);
  return {
    mode: 'channel_manager',
    capability: () => ({ importsBookings: true, pushesAvailability: true, realTime: true, guestDetails: true,
      status: hasCreds() ? 'not_implemented' : 'requires_credentials',
      notes: `${name}: grensesnitt klart, men API-kall er ikke implementert/testet. Krever konto og ${envKeys.join(', ')}.` }),
    async fetchEvents() { throw new Error(`${name}-integrasjonen er ikke aktivert ennå.`); },
    async pushAvailability() { throw new Error(`${name}-integrasjonen er ikke aktivert ennå.`); },
  };
}

export const guestyAdapter = managerAdapter('Guesty', ['GUESTY_CLIENT_ID', 'GUESTY_CLIENT_SECRET']);
export const hostawayAdapter = managerAdapter('Hostaway', ['HOSTAWAY_ACCOUNT_ID', 'HOSTAWAY_API_KEY']);

/** Direct Airbnb / Booking.com APIs are partner-only. Not available to us; use iCal or a channel manager. */
export const directApiAdapter: ChannelAdapter = {
  mode: 'api',
  capability: () => ({ importsBookings: false, pushesAvailability: false, realTime: false, guestDetails: false, status: 'not_implemented',
    notes: 'Direkte API hos Airbnb/Booking.com krever godkjent partnerstatus. Bruk iCal eller channel manager.' }),
};
