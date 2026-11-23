'use client';
import { useState } from 'react';

/**
 * File input for photos that shrinks large pictures in the browser before upload (max 2000 px, JPEG ~85 %).
 * Phone photos are often 4–8 MB; Vercel functions accept max 4.5 MB per request, and smaller files also upload faster on mobile data.
 * The server still checks the file type and size.
 */
export function ImageInput(props: { name: string; required?: boolean; capture?: 'environment' | 'user'; style?: React.CSSProperties; accept?: string }) {
  const [note, setNote] = useState<string | null>(null);
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file || !file.type.startsWith('image/') || file.size < 1.5 * 1024 * 1024) { setNote(null); return; }
    try {
      setNote('Gjør bildet klart …');
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) { setNote(null); return; }
      const dt = new DataTransfer();
      dt.items.add(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      setNote(`Bildet er gjort mindre (${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB).`);
    } catch { setNote(null); /* keep the original; the server will tell if it is too large */ }
  }
  return (
    <span style={{ display: 'block', flex: props.style?.flex }}>
      <input type="file" name={props.name} accept={props.accept ?? 'image/*'} required={props.required} capture={props.capture} onChange={onChange} style={props.style} />
      {note && <small className="muted" style={{ display: 'block', marginTop: 4 }}>{note}</small>}
    </span>
  );
}
