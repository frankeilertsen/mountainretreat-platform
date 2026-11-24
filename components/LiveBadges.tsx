'use client';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Keeps the menu badges current. The menu lives in a layout, which Next.js does not re-render on
 * navigation, so a new inquiry or message would not show until a full reload. This checks the counts
 * every 30 s, when the tab gets focus and on every page change, and refreshes the page data if they changed.
 */
export function LiveBadges({ scope, sig }: { scope: 'admin' | 'member'; sig: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useRef(sig);
  current.current = sig;
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/api/badges?scope=${scope}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { sig: now } = await r.json();
        if (!stop && now && now !== current.current) { current.current = now; router.refresh(); }
      } catch { /* offline – try again later */ }
    };
    check();
    const t = setInterval(check, 30_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { stop = true; clearInterval(t); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [scope, pathname, router]);
  return null;
}
