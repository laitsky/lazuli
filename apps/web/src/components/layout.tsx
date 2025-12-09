import { ReactNode } from 'react';
import { Navigation } from './navigation';
import { CommandPalette } from './command-palette';

/**
 * Root Layout Component
 *
 * Provides the main application shell with:
 * - Navigation sidebar (desktop: fixed left, mobile: drawer)
 * - Command palette (Cmd+K / Ctrl+K)
 * - Main content area with responsive margins
 */
interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="antialiased font-sans min-h-screen bg-background text-foreground">
      <Navigation />
      {/* Global Command Palette - Cmd+K / Ctrl+K to open */}
      <CommandPalette />
      {/* Main content area with left margin for sidebar on desktop */}
      {/* Mobile: full width with top padding, Desktop (lg): 280px left margin for sidebar */}
      <main className="min-h-screen px-4 pt-20 pb-8 lg:pt-8 lg:ml-[280px] lg:px-8 relative">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
