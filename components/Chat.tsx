'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';

/** Refreshes server data every `seconds` while the tab is visible (new messages appear without reloading). */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [router, seconds]);
  return null;
}

/** Keeps the newest message in view. */
export function ScrollToEnd({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'end' }); }, [dep]);
  return <div ref={ref} />;
}

export function SendButton({ label, busy, className = 'btn' }: { label: string; busy: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? busy : label}</button>;
}

/** Textarea where Ctrl/⌘+Enter submits the form. */
export function MessageBox(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />;
}

/** After a thread is opened (and marked read), refresh once so the unread badge in the menu updates immediately. */
export function RefreshOnce() {
  const router = useRouter();
  useEffect(() => { const t = setTimeout(() => router.refresh(), 300); return () => clearTimeout(t); }, [router]);
  return null;
}

/** File picker for message attachments with client-side limits (max 5 files, 10 MB each, 20 MB total). */
export function AttachmentPicker({ accept, lang = 'no' }: { accept: string; lang?: 'no' | 'en' }) {
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState('');
  const en = lang === 'en';
  const size = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`;
  const onChange = () => {
    const list = Array.from(ref.current?.files ?? []);
    let e = '';
    if (list.length > 5) e = en ? 'Max 5 files per message.' : 'Maks 5 filer per melding.';
    else if (list.some(f => f.size > 10 * 1048576)) e = en ? 'Each file can be max 10 MB.' : 'Hver fil kan være maks 10 MB.';
    else if (list.reduce((s, f) => s + f.size, 0) > 20 * 1048576) e = en ? 'Max 20 MB in total.' : 'Maks 20 MB til sammen.';
    if (e && ref.current) { ref.current.value = ''; setFiles([]); } else setFiles(list);
    setErr(e);
  };
  return (
    <div className="attach-picker">
      <label className="btn ghost small" style={{ cursor: 'pointer' }}>
        📎 {en ? 'Attach files' : 'Legg ved filer'}
        <input ref={ref} type="file" name="files" multiple accept={accept} onChange={onChange} style={{ display: 'none' }} />
      </label>
      {files.length > 0 && <span className="attach-list">{files.map(f => <span key={f.name + f.size} className="attach-chip">{f.name} <small>({size(f.size)})</small></span>)}
        <button type="button" className="link-btn" onClick={() => { if (ref.current) ref.current.value = ''; setFiles([]); }}>{en ? 'Remove' : 'Fjern'}</button></span>}
      {!files.length && !err && <small className="muted">{en ? 'Images, PDF, Word, Excel · max 5 files, 10 MB each' : 'Bilder, PDF, Word, Excel · maks 5 filer, 10 MB per fil'}</small>}
      {err && <small style={{ color: 'var(--danger, #c0392b)' }}>{err}</small>}
    </div>
  );
}
