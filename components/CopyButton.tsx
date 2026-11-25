'use client';
import { useState } from 'react';

/** Copies a value to the clipboard (for pasting into Fiken). */
export function CopyButton({ value, label = 'Kopier' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost small" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    }}>{done ? 'Kopiert ✓' : label}</button>
  );
}
