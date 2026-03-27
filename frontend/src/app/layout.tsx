import type { Metadata } from 'next';
import { Playfair_Display, DM_Sans, DM_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { I18nProvider } from '@/lib/i18n';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-playfair',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400'],
  variable: '--font-dm-sans',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-dm-mono',
});

export const metadata: Metadata = {
  title: 'Photography Portfolio',
  description: 'A curated photography portfolio',
  openGraph: {
    type: 'website',
    title: 'Photography Portfolio',
    description: 'A curated photography portfolio',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW" className={`${playfair.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <head>
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_R2_PUBLIC_URL || ''} />
      </head>
      <body className="font-sans bg-[var(--bg-primary)] text-[var(--text-primary)] antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
