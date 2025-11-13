import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "@/components/navigation";
import { Space_Grotesk, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";

// Distinctive geometric sans for headings - extreme weights for high contrast
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "700", "800"],
  variable: "--font-space-grotesk",
  display: "swap",
});

// Technical sans for body text - lighter weights for contrast
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

// Code aesthetic for financial data - extreme weight range
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["200", "400", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lazuli - Cryptocurrency Trading Tool",
  description: "Real-time cryptocurrency data from multiple exchanges",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased font-sans">
        <Navigation />
        {/* Main content area with left margin to account for sidebar on desktop */}
        {/* Mobile: full width, Desktop (lg): 256px left margin for sidebar */}
        <main className="min-h-screen px-4 py-8 lg:ml-64 lg:px-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
