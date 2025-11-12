import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "@/components/navigation";

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
    <html lang="en">
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
