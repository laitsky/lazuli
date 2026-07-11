/**
 * Sidebar — primary navigation
 *
 * Two modes:
 *  - Desktop (md+): persistent left rail, 240px wide
 *  - Mobile (<md): hidden by default, opens as a drawer with overlay
 *
 * Sections render all 12 routes (Dashboard is solo). Active route gets an
 * accent left-border + subtle background. Health status is in the footer.
 */

import { Link, useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigationSections } from '@/lib/navigation';
import { BrandLockup } from './BrandLockup';
import { SidebarHealth } from './SidebarHealth';

interface SidebarProps {
  /** Mobile drawer open state. Undefined = desktop persistent. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  return (
    <>
      {/* Desktop persistent rail */}
      <aside
        className={cn(
          'hidden md:flex fixed inset-y-0 left-0 z-30',
          'w-[var(--shell-sidebar-w)] flex-col',
          'bg-surface-1 border-r border-border'
        )}
        aria-label="Primary navigation"
      >
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <Dialog.Root open={mobileOpen} onOpenChange={onMobileClose}>
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn(
              'fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden',
              'data-[state=open]:animate-fade-in data-[state=closed]:opacity-0'
            )}
          />
          <Dialog.Content
            aria-label="Navigation"
            aria-description="Main navigation drawer"
            className={cn(
              'fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw]',
              'bg-surface-1 border-r border-border',
              'flex flex-col',
              'md:hidden',
              'data-[state=open]:animate-slide-in-left'
            )}
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">
              Site navigation — close with the X button or by tapping outside.
            </Dialog.Description>
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Close navigation"
              className={cn(
                'absolute right-3 top-3 z-10',
                'flex h-9 w-9 items-center justify-center rounded-md',
                'hover:bg-surface-3 transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1'
              )}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <SidebarContent onNavigate={onMobileClose} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();

  return (
    <>
      <div className="flex min-h-[var(--shell-topbar-h)] items-center border-b border-border px-4">
        <BrandLockup onNavigate={onNavigate} />
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-4 px-3" aria-label="Sections">
        <ul className="space-y-6">
          {navigationSections.map((section) => (
            <li key={section.id}>
              {section.label && (
                <div className="px-3 mb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {section.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = isRouteActive(item.href, location.pathname);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        onClick={onNavigate}
                        title={item.description}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'group relative flex items-center gap-2.5',
                          'min-h-9 px-3 py-2 rounded-md',
                          'text-sm transition-colors no-tap-highlight',
                          isActive
                            ? 'bg-accent-subtle text-accent font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
                        )}
                      >
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-accent"
                          />
                        )}
                        <Icon
                          className="h-[18px] w-[18px] shrink-0"
                          strokeWidth={isActive ? 2.25 : 1.75}
                          aria-hidden
                        />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      <SidebarHealth />
    </>
  );
}

/** Active if path matches exactly, or path starts with the route href (for deep links) */
function isRouteActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
