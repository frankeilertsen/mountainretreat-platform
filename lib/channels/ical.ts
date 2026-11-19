import ical from 'node-ical';
import { ChannelAdapter, ExternalEvent } from './types';

function toDate(d: any): string {
  // All-day VEVENTs are dates; node-ical gives a Date at local midnight with dateOnly flag
  const dt = d instanceof Date ? d : new Date(d);
  if ((d as any)?.dateOnly || (dt.getHours() === 0 && dt.getMinutes() === 0)) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(dt);
}

/** Parses an iCal document strictly: any structural problem throws, so a bad response can never wipe availability. */
export function parseIcal(text: string): ExternalEvent[] {
  if (!/BEGIN:VCALENDAR/.test(text) || !/END:VCALENDAR/.test(text)) throw new Error('Svaret er ikke en gyldig iCal-kalender');
  const data = ical.sync.parseICS(text);
  const out: ExternalEvent[] = [];
  for (const k of Object.keys(data)) {
    const ev: any = (data as any)[k];
    if (ev.type !== 'VEVENT') continue;
    if (!ev.start) continue;
    const start = toDate(ev.start);
    const end = ev.end ? toDate(ev.end) : start;
    if (end <= start) continue;
    out.push({ uid: String(ev.uid || `${start}_${end}`), start, end, summary: ev.summary ? String(ev.summary).slice(0, 200) : null });
  }
  return out;
}

export async function fetchIcal(url: string, timeoutMs = 15000): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new Error('iCal-URL må bruke https');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MountainRetreat-CalendarSync/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 5_000_000) throw new Error('Kalenderen er for stor');
    return text;
  } finally { clearTimeout(t); }
}

export const icalImportAdapter: ChannelAdapter = {
  mode: 'ical_import',
  capability: () => ({ importsBookings: true, pushesAvailability: false, realTime: false, guestDetails: false, status: 'implemented',
    notes: 'Henter kanalens iCal-feed med fast intervall. Kun datoer – ingen gjestenavn eller antall.' }),
  async fetchEvents(conn) {
    if (!conn.ical_url) throw new Error('Mangler iCal-URL');
    return parseIcal(await fetchIcal(conn.ical_url));
  },
};

export const icalExportAdapter: ChannelAdapter = {
  mode: 'ical_export',
  capability: () => ({ importsBookings: false, pushesAvailability: true, realTime: false, guestDetails: false, status: 'implemented',
    notes: 'Kanalen henter vår hemmelige iCal-lenke på egen timeplan (ofte 30 min – flere timer). Ikke sanntid.' }),
};

const esc = (s: string) => s.replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
const d8 = (iso: string) => iso.replace(/-/g, '');

/** Builds the export feed: every block except those that came from the requesting channel (no echo). */
export function buildIcal(propertyName: string, blocks: { id: string; start: string; end: string }[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Byrampen Eiendom AS//Mountain Retreat//NO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(propertyName)}`];
  for (const b of blocks) {
    lines.push('BEGIN:VEVENT', `UID:${b.id}@mountainretreat.no`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${d8(b.start)}`, `DTEND;VALUE=DATE:${d8(b.end)}`,
      'SUMMARY:Blocked', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
