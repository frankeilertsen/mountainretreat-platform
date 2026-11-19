import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: { default: 'Mountain Retreat', template: '%s · Mountain Retreat' },
  description: 'Privat bookingportal for venner og familie – Byrampen Eiendom AS',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f6f3ee' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="nb"><body>{children}</body></html>;
}
