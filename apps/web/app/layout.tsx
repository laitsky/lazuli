import type { Metadata } from 'next';
import './globals.css';
import { Navigation } from '@/components/navigation';
import { Outfit, Fira_Code } from 'next/font/google';
import localFont from 'next/font/local';

/**
 * Terminal Luxe Typography System
 *
 * Display: Clash Display - geometric, bold, editorial headlines
 * Body: Outfit - modern geometric sans with warmth
 * Mono: Fira Code - elegant terminal aesthetic for financial data
 */

// Clash Display - loaded locally for the distinctive display font
// This creates the dramatic editorial headline aesthetic
const clashDisplay = localFont({
  src: [
    {
      path: '../fonts/ClashDisplay-Variable.woff2',
      style: 'normal',
    },
  ],
  variable: '--font-clash-display',
  display: 'swap',
  preload: true,
});

// Outfit - modern geometric sans with warmth for body text
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
  preload: true,
});

// Fira Code - elegant terminal aesthetic for financial data
const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-fira-code',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: 'Lazuli - Precision Trading Intelligence',
  description:
    'Real-time cryptocurrency data aggregation across major exchanges. Unified interface for spot and perpetual markets.',
  keywords: ['cryptocurrency', 'trading', 'exchange', 'market data', 'bitcoin', 'ethereum'],
  authors: [{ name: 'Lazuli' }],
  openGraph: {
    title: 'Lazuli - Precision Trading Intelligence',
    description: 'Real-time cryptocurrency data from multiple exchanges',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${clashDisplay.variable} ${outfit.variable} ${firaCode.variable}`}>
      <body className="antialiased font-sans min-h-screen bg-background text-foreground">
        <Navigation />
        {/* Main content area with left margin for sidebar on desktop */}
        {/* Mobile: full width with top padding, Desktop (lg): 280px left margin for sidebar */}
        <main className="min-h-screen px-4 pt-20 pb-8 lg:pt-8 lg:ml-[280px] lg:px-8 relative">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </body>
    </html>
  );
}
