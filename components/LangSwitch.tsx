import type { Lang } from '@/lib/i18n/dict';

const NoFlag = () => (
  <svg viewBox="0 0 22 16" width="22" height="16" aria-hidden="true">
    <rect width="22" height="16" fill="#BA0C2F" />
    <path d="M0 8h22M8 0v16" stroke="#fff" strokeWidth="4" />
    <path d="M0 8h22M8 0v16" stroke="#00205B" strokeWidth="2" />
  </svg>
);
const UkFlag = () => (
  <svg viewBox="0 0 60 30" width="22" height="16" preserveAspectRatio="none" aria-hidden="true">
    <clipPath id="uk-s"><path d="M0,0 v30 h60 v-30 z" /></clipPath>
    <clipPath id="uk-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
    <g clipPath="url(#uk-s)">
      <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uk-t)" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </g>
  </svg>
);

/** Norwegian / English flag switch. Plain links (no JS): /api/lang sets a cookie and returns to the same page. */
export function LangSwitch({ lang, className = '' }: { lang: Lang; className?: string }) {
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Språk / Language">
      <a href="/api/lang?l=no" className={lang === 'no' ? 'active' : ''} aria-current={lang === 'no' ? 'true' : undefined} title="Norsk" hrefLang="nb"><NoFlag /><span>NO</span></a>
      <a href="/api/lang?l=en" className={lang === 'en' ? 'active' : ''} aria-current={lang === 'en' ? 'true' : undefined} title="English" hrefLang="en"><UkFlag /><span>EN</span></a>
    </div>
  );
}
