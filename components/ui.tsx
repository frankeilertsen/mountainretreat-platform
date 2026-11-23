import Link from 'next/link';
import { nok } from '@/lib/format';
import { translateMessage } from '@/lib/i18n/messages';
import { dict, type Lang } from '@/lib/i18n/dict';

export function Flash({ sp, lang = 'no' }: { sp: Record<string, string | string[] | undefined>; lang?: Lang }) {
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const err = typeof sp.feil === 'string' ? sp.feil : null;
  if (!ok && !err) return null;
  return <div className={`flash ${err ? 'err' : 'ok'}`} role="status">{translateMessage((err ?? ok)!, lang)}</div>;
}

const STATUS: Record<string, [string, string]> = {
  pending_review: ['Venter på godkjenning', 'b-warn'], rejected: ['Avslått', 'b-danger'], awaiting_payment: ['Venter på betaling', 'b-clay'],
  expired: ['Utløpt', ''], confirmed: ['Bekreftet', 'b-ok'], cancellation_requested: ['Kansellering forespurt', 'b-warn'],
  cancelled: ['Kansellert', ''], completed: ['Fullført', 'b-sage'],
  pending: ['Venter', 'b-warn'], succeeded: ['Betalt', 'b-ok'], failed: ['Feilet', 'b-danger'], refunded: ['Refundert', 'b-info'], partially_refunded: ['Delvis refundert', 'b-info'],
  open: ['Ikke tildelt', 'b-warn'], assigned: ['Tildelt', 'b-info'], in_progress: ['Pågår', 'b-clay'], done: ['Ferdig', 'b-ok'], not_needed: ['Ikke nødvendig', ''],
  active: ['Aktiv', 'b-ok'], suspended: ['Suspendert', 'b-warn'], revoked: ['Utestengt', 'b-danger'], invited: ['Invitert', 'b-info'], anonymized: ['Anonymisert', ''],
  accepted: ['Akseptert', 'b-ok'], pending_vest: ['Opptjenes', 'b-warn'], available: ['Tilgjengelig', 'b-ok'], partially_used: ['Delvis brukt', 'b-sage'], fully_used: ['Brukt', ''],
  success: ['OK', 'b-ok'], failure: ['Feiler', 'b-danger'], never: ['Ikke synket ennå', 'b-warn'], qualified: ['Kvalifisert', 'b-ok'],
  sent: ['Sendt', 'b-info'], paid: ['Betalt', 'b-ok'], overdue: ['Forfalt', 'b-danger'],
  echo: ['Speilet', ''], conflict: ['KONFLIKT', 'b-danger'], removed: ['Fjernet', ''],
};
export function Status({ s, lang = 'no' }: { s: string | null | undefined; lang?: Lang }) {
  if (!s) return null;
  const [nbLabel, cls] = STATUS[s] ?? [s, ''];
  const label = lang === 'en' ? (dict.en.status[s] ?? nbLabel) : nbLabel;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Money({ ore }: { ore: number | null | undefined }) { return <>{nok(ore ?? 0)}</>; }

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted" style={{ padding: '18px 0' }}>{children}</p>;
}

export function Mountains({ color = '#26251f', color2 = '#1c1b18' }: { color?: string; color2?: string }) {
  return (
    <svg viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 400 L0 260 L160 140 L260 220 L420 80 L560 230 L700 120 L860 250 L1000 150 L1200 260 L1200 400 Z" fill={color} />
      <path d="M0 400 L0 320 L200 230 L380 300 L560 210 L760 310 L940 240 L1200 320 L1200 400 Z" fill={color2} />
    </svg>
  );
}

export function PropertyMedia({ photoId, alt }: { photoId?: string | null; alt: string }) {
  return (
    <div className="prop-media">
      {photoId ? <img src={`/api/photos/${photoId}`} alt={alt} /> : <Mountains />}
    </div>
  );
}

export function NavLink({ href, children, active }: { href: string; children: React.ReactNode; active?: boolean }) {
  return <Link href={href} className={active ? 'active' : ''}>{children}</Link>;
}
