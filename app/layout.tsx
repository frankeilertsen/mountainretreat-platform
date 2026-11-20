import './globals.css';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: { default: 'Mountain Retreat', template: '%s · Mountain Retreat' },
  description: 'Privat bookingportal for venner og familie – FKE Property AS',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0e0e0d' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="nb"><body>{children}</body></html>;
}
