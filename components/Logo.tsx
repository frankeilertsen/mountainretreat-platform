import Link from 'next/link';

/** Mountain Retreat logo (light version for the dark theme). 'full' = mark + wordmark, 'mark' = illustration only. */
export function Logo({ variant = 'full', width, href = '/', label }: { variant?: 'full' | 'mark'; width?: number; href?: string | null; label?: string }) {
  const src = variant === 'full' ? '/brand/logo-light.png' : '/brand/mark-light.png';
  const img = <img src={src} alt="Mountain Retreat" width={width ?? (variant === 'full' ? 200 : 120)} style={{ height: 'auto', display: 'block' }} />;
  const inner = <>{img}{label && <span className="logo-label">{label}</span>}</>;
  return href ? <Link href={href} className="logo">{inner}</Link> : <span className="logo">{inner}</span>;
}
