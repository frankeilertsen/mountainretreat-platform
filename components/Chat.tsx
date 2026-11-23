'use client';
import { useEffect, useRef } from 'react';
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
