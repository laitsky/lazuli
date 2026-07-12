/**
 * Topbar — persistent top of the app frame
 *
 * Three regions:
 *  - Left: mobile hamburger + Lazuli wordmark
 *  - Center: SymbolSearch (desktop)
 *  - Right: TopbarPrices + AccentPicker + Cmd+K trigger
 *
 * Always visible across all routes. Height: var(--shell-topbar-h) (56px default).
 * Mobile: hamburger + compact wordmark + price icon. Desktop: full width.
 */

import { Menu, Command as CommandIcon, Search, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { BrandLockup } from './BrandLockup';
import { SymbolSearch } from './SymbolSearch';
import { TopbarPrices } from './TopbarPrices';
import { AccentPicker } from './AccentPicker';

interface TopbarProps {
  onOpenMobileNav: () => void;
  onOpenCommandPalette: () => void;
}

export function Topbar({ onOpenMobileNav, onOpenCommandPalette }: TopbarProps) {
  const { status, user } = useAuth();

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-30 h-[var(--shell-topbar-h)]',
        'bg-surface-0/95 backdrop-blur supports-[backdrop-filter]:bg-surface-0/80',
        'border-b border-border',
        'flex items-center gap-3 px-3 md:px-6',
        'pt-safe'
      )}
    >
      {/* Left — mobile hamburger + wordmark */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className={cn(
            'md:hidden flex h-9 w-9 items-center justify-center rounded-md',
            'hover:bg-surface-2 transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'
          )}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>

        <div className="md:hidden">
          <BrandLockup compact />
        </div>
      </div>

      {/* Center — symbol search (desktop) */}
      <div className="flex-1 flex justify-center px-2 md:px-6">
        <div className="w-full max-w-md hidden md:block">
          <SymbolSearch />
        </div>
      </div>

      {/* Right — prices + actions */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <TopbarPrices />

        {/* Mobile search trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Search"
          className={cn(
            'md:hidden flex h-9 w-9 items-center justify-center rounded-md',
            'bg-surface-1 border border-border',
            'hover:bg-surface-3 transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'
          )}
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>

        {/* Cmd+K trigger (desktop) */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette (Cmd+K)"
          className={cn(
            'hidden md:flex items-center gap-1.5 h-9 px-2.5 rounded-md',
            'bg-surface-1 border border-border',
            'hover:bg-surface-3 hover:border-border-strong transition-colors',
            'text-xs text-muted-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'
          )}
        >
          <kbd className="font-mono text-[10px] flex items-center gap-0.5">
            <CommandIcon className="h-3 w-3" aria-hidden />K
          </kbd>
        </button>

        <AccentPicker />

        <Link
          to="/account"
          aria-label={
            user ? `Account settings for ${user.email}` : 'Sign in or open account settings'
          }
          className={cn(
            'flex h-9 min-w-9 items-center justify-center gap-2 rounded-md px-2.5',
            'bg-surface-1 border border-border text-sm',
            'hover:bg-surface-3 hover:border-border-strong transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'
          )}
        >
          <UserRound className="h-4 w-4" aria-hidden />
          <span className="hidden xl:inline max-w-32 truncate">
            {status === 'loading' ? 'Account' : user?.displayName || user?.email || 'Sign in'}
          </span>
          {user && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />}
        </Link>
      </div>
    </header>
  );
}
