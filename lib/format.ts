export function nok(ore: number | null | undefined): string {
  const v = (ore ?? 0) / 100;
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: v % 1 === 0 ? 0 : 2 }).format(v);
}

/** Dates are handled as 'YYYY-MM-DD' strings to avoid timezone drift. */
export function toISODate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function nightsBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 86400000);
}
export function isoWeekday(iso: string): number { // 1 = Monday … 7 = Sunday
  const d = new Date(iso + 'T12:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}
export function todayOslo(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
}
const MONTHS = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
const WEEKDAYS = ['søn','man','tir','ons','tor','fre','lør'];
export function fmtDate(iso: string | Date | null | undefined, withWeekday = false): string {
  if (!iso) return '–';
  const s = typeof iso === 'string' ? iso.slice(0, 10) : toISODate(iso);
  const d = new Date(s + 'T12:00:00Z');
  const base = `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withWeekday ? `${WEEKDAYS[d.getUTCDay()]} ${base}` : base;
}
export function fmtDateTime(ts: string | Date | null | undefined): string {
  if (!ts) return '–';
  return new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}
export function fmtTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '–';
}

/** Percent with Norwegian decimal comma (1,5) or English point (1.5). */
export const pctNo = (n: number) => n.toLocaleString('nb-NO', { maximumFractionDigits: 2 });
export const pctL = (n: number, lang: 'no' | 'en' = 'no') => n.toLocaleString(lang === 'en' ? 'en-GB' : 'nb-NO', { maximumFractionDigits: 2 });
