import type { Lang } from './dict';

const MONTHS = { no: ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'], en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] };
const MONTHS_LONG = { no: ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'], en: ['January','February','March','April','May','June','July','August','September','October','November','December'] };
const WD = { no: ['søn','man','tir','ons','tor','fre','lør'], en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] };
const DOW = { no: ['Ma','Ti','On','To','Fr','Lø','Sø'], en: ['Mo','Tu','We','Th','Fr','Sa','Su'] };

export function fmtDateL(iso: string | Date | null | undefined, lang: Lang, withWeekday = false): string {
  if (!iso) return '–';
  const s = typeof iso === 'string' ? iso.slice(0, 10) : iso.toISOString().slice(0, 10);
  const d = new Date(s + 'T12:00:00Z');
  const base = lang === 'en' ? `${d.getUTCDate()} ${MONTHS.en[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${d.getUTCDate()}. ${MONTHS.no[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withWeekday ? `${WD[lang][d.getUTCDay()]} ${base}` : base;
}
export function fmtDateTimeL(ts: string | Date | null | undefined, lang: Lang): string {
  if (!ts) return '–';
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}
export function nokL(ore: number | null | undefined, lang: Lang): string {
  const v = (ore ?? 0) / 100;
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: v % 1 === 0 ? 0 : 2 }).format(v);
}
export const monthName = (m: number, lang: Lang) => MONTHS_LONG[lang][m];
export const dowShort = (lang: Lang) => DOW[lang];
