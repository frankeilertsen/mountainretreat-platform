'use client';
import { useEffect, useState } from 'react';

function stampNow(lang: 'no' | 'en') {
  const d = new Date();
  const opts = { timeZone: 'Europe/Oslo' } as const;
  const date = d.toLocaleDateString('nb-NO', { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('nb-NO', { ...opts, hour: '2-digit', minute: '2-digit' });
  return lang === 'en' ? `Generated ${date} at ${time}` : `Generert ${date} kl. ${time}`;
}

/** Shown only on paper: title + generated date/time. Refreshed right before printing. Placed once in the root layout. */
export function PrintStamp() {
  const [s, setS] = useState({ title: '', stamp: '' });
  useEffect(() => {
    const upd = () => {
      const lang = document.documentElement.lang?.startsWith('en') ? 'en' : 'no';
      const h1 = document.querySelector('#print-area h1, #print-area h2, #print-area h3') ?? document.querySelector('main h1, .admin-main h1, .clean h1, h1');
      setS({ title: (h1?.textContent ?? document.title).trim(), stamp: stampNow(lang) });
    };
    upd();
    window.addEventListener('beforeprint', upd);
    return () => window.removeEventListener('beforeprint', upd);
  }, []);
  return (
    <div className="print-stamp" aria-hidden>
      <span><strong>Retreat Club · FKE Property AS</strong>{s.title ? ` — ${s.title}` : ''}</span>
      <span>{s.stamp}</span>
    </div>
  );
}

/** Inline "Generert dd.mm.yyyy kl. hh:mm" (print only), e.g. on each page of a multi-page printout. */
export function GeneratedAt({ lang = 'no' }: { lang?: 'no' | 'en' }) {
  const [t, setT] = useState('');
  useEffect(() => { const upd = () => setT(stampNow(lang)); upd(); window.addEventListener('beforeprint', upd); return () => window.removeEventListener('beforeprint', upd); }, [lang]);
  return <small className="print-only print-generated">{t}</small>;
}

/** Print button. With `target` (element id) only that section is printed. */
export function PrintButton({ label = 'Skriv ut', target, className = 'btn ghost small' }: { label?: string; target?: string; className?: string }) {
  return (
    <button type="button" className={`${className} no-print`} onClick={() => {
      const el = target ? document.getElementById(target) : null;
      let area: HTMLDivElement | null = null;
      if (el) {
        area = document.createElement('div'); area.id = 'print-area';
        area.appendChild(el.cloneNode(true)); document.body.appendChild(area);
        document.body.classList.add('print-focus');
      }
      window.dispatchEvent(new Event('beforeprint'));
      const done = () => { document.body.classList.remove('print-focus'); area?.remove(); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(() => window.print(), 80);
    }}>🖨 {label}</button>
  );
}
