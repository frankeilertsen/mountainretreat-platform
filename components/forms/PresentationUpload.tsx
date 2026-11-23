'use client';
import { useRef, useState } from 'react';
import { startPresentationUploadAction, uploadPresentationAction } from '@/app/actions/presentations';

const MAX = 20 * 1024 * 1024;

/**
 * Upload form for PDF presentations. With Supabase storage the PDF goes straight from the browser to the private bucket
 * (Vercel functions only accept 4.5 MB), then the form is submitted with the file's key and the server checks the file.
 */
export function PresentationUploadForm({ children }: { children: React.ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ready = useRef(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (ready.current) return; // second pass: let the form post normally
    e.preventDefault();
    setErr(null);
    const f = form.current!;
    const input = f.elements.namedItem('file') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) { setErr('Velg en PDF-fil.'); return; }
    if (file.size > MAX) { setErr('PDF-filen må være under 20 MB.'); return; }
    try {
      setBusy('Forbereder …');
      const up = await startPresentationUploadAction();
      if (up) {
        setBusy(`Laster opp (${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB) …`);
        const r = await fetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: file });
        if (!r.ok) throw new Error(`Opplastingen feilet (${r.status}).`);
        (f.elements.namedItem('uploadedKey') as HTMLInputElement).value = up.key;
        (f.elements.namedItem('originalName') as HTMLInputElement).value = file.name;
        input.required = false; input.value = '';
      }
      setBusy('Kontrollerer filen …');
      ready.current = true;
      f.requestSubmit();
    } catch (x) {
      setBusy(null);
      setErr((x as Error).message || 'Opplastingen feilet. Prøv igjen.');
    }
  }

  return (
    <form ref={form} action={uploadPresentationAction} onSubmit={onSubmit} className="card">
      <input type="hidden" name="uploadedKey" defaultValue="" />
      <input type="hidden" name="originalName" defaultValue="" />
      {children}
      {err && <div className="flash err" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn block" disabled={!!busy}>{busy ?? 'Last opp'}</button>
    </form>
  );
}
