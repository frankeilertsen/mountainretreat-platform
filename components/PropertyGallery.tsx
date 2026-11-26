'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type GalleryPhoto = { id: string; caption?: string | null };

/** Large cover + thumbnail grid; tapping opens a full-screen viewer with arrows, swipe and keyboard. */
export function PropertyGallery({ photos, alt, labels }: { photos: GalleryPhoto[]; alt: string; labels: { all: string; close: string; prev: string; next: string } }) {
  const [open, setOpen] = useState<number | null>(null);
  const touch = useRef<number | null>(null);
  const n = photos.length;
  const go = useCallback((d: number) => setOpen(i => (i === null ? i : (i + d + n) % n)), [n]);
  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    document.addEventListener('keydown', key); const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = o; };
  }, [open, go]);
  if (!n) return null;
  const src = (id: string) => `/api/photos/${id}`;
  const thumbs = photos.slice(1, 5);
  return (
    <>
      <div className={`gallery${thumbs.length ? '' : ' single'}`}>
        <button type="button" className="gallery-main" onClick={() => setOpen(0)} aria-label={alt}><img src={src(photos[0].id)} alt={photos[0].caption ?? alt} /></button>
        {thumbs.length > 0 && <div className={`gallery-thumbs t${thumbs.length}`}>{thumbs.map((p, i) => (
          <button type="button" key={p.id} onClick={() => setOpen(i + 1)}><img src={src(p.id)} alt={p.caption ?? alt} loading="lazy" />
            {i === thumbs.length - 1 && n > 5 && <span className="gallery-more">+{n - 5}</span>}</button>))}</div>}
        {n > 1 && <button type="button" className="gallery-all" onClick={() => setOpen(0)}>▦ {labels.all.replace('{n}', String(n))}</button>}
      </div>
      {open !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(null)}
          onTouchStart={e => { touch.current = e.touches[0].clientX; }}
          onTouchEnd={e => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}>
          <div className="lightbox-top" onClick={e => e.stopPropagation()}><span>{open + 1} / {n}{photos[open].caption ? ` · ${photos[open].caption}` : ''}</span><button type="button" onClick={() => setOpen(null)} aria-label={labels.close}>✕</button></div>
          <img src={src(photos[open].id)} alt={photos[open].caption ?? alt} onClick={e => e.stopPropagation()} />
          {n > 1 && <><button type="button" className="lb-nav prev" aria-label={labels.prev} onClick={e => { e.stopPropagation(); go(-1); }}>‹</button>
            <button type="button" className="lb-nav next" aria-label={labels.next} onClick={e => { e.stopPropagation(); go(1); }}>›</button></>}
        </div>
      )}
    </>
  );
}
