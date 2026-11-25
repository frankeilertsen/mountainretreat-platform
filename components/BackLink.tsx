'use client';

/**
 * "← Tilbake": goes to the previous page if the visitor came from this site, otherwise to the home page
 * (e.g. when the login page was opened from a bookmark or an e-mail). Works as a plain link without JavaScript.
 */
export function BackLink({ label, fallback = '/', className = 'btn ghost small back-corner' }: { label: string; fallback?: string; className?: string }) {
  return (
    <a
      href={fallback}
      className={className}
      onClick={e => {
        try {
          const ref = document.referrer ? new URL(document.referrer) : null;
          if (ref && ref.origin === window.location.origin && ref.pathname !== window.location.pathname && window.history.length > 1) {
            e.preventDefault();
            window.history.back();
          }
        } catch { /* fall back to the link */ }
      }}
    >
      {label}
    </a>
  );
}
