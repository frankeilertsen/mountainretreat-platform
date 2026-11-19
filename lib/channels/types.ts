/**
 * Channel integration abstraction. Each adapter declares exactly what it can do, so the admin UI
 * never implies a capability that does not exist.
 *
 *  - ical_import:      we poll the channel's iCal feed (pull, typically every 30 min). Dates only; no guest data.
 *  - ical_export:      the channel polls OUR secret iCal feed on its own schedule (Airbnb: ~every few hours,
 *                      not configurable). Changes are therefore NOT real-time.
 *  - api:              direct channel API (Airbnb/Booking.com APIs are only available to approved partners).
 *  - channel_manager:  Guesty / Hostaway etc. own the channel connections; we sync with the manager's API.
 */
export type ExternalEvent = { uid: string; start: string; end: string; summary: string | null };

export type Capability = {
  importsBookings: boolean;
  pushesAvailability: boolean;
  realTime: boolean;
  guestDetails: boolean;
  status: 'implemented' | 'requires_credentials' | 'not_implemented';
  notes: string;
};

export interface ChannelAdapter {
  mode: 'ical_import' | 'ical_export' | 'api' | 'channel_manager';
  capability(): Capability;
  /** Pull current reservations/blocks. Throws on transport/parse errors (never returns partial data). */
  fetchEvents?(connection: { ical_url: string | null; config: any }): Promise<ExternalEvent[]>;
  /** Push our availability to the channel (only for adapters that can). */
  pushAvailability?(connection: { config: any }, blocks: { start: string; end: string }[]): Promise<void>;
}
