/**
 * AppFrame — the application shell
 *
 * Composes Topbar + Sidebar + main content area. Manages:
 *  - Mobile drawer open/close state
 *  - Body scroll lock when overlays are open
 *  - Preferences application (accent + density attrs on <html>)
 *  - Delegates Cmd+K to the legacy CommandPalette (mounted once here)
 *
 * Renders children inside a max-width container with consistent padding.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useApplyPreferences } from '@/lib/preferences';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';

interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useApplyPreferences();

  // Body scroll lock when mobile nav is open
  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileNavOpen]);

  // Open the command palette by dispatching the keyboard shortcut.
  // The legacy CommandPalette listens for Cmd+K and toggles itself.
  // Phase 3 will replace this with a context-driven palette.
  const openCommandPalette = () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
    );
  };

  return (
    <div className="min-h-screen bg-surface-0 text-foreground">
      <Topbar
        onOpenMobileNav={() => setMobileNavOpen(true)}
        onOpenCommandPalette={openCommandPalette}
      />
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />

      <main
        className={cn(
          'min-h-screen',
          'pt-[var(--shell-topbar-h)] md:pl-[var(--shell-sidebar-w)]',
          'pb-safe'
        )}
      >
        <div className="mx-auto max-w-[1440px] px-4 md:px-6 lg:px-8 py-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
