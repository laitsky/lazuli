/**
 * Lazuli brand lockup for shell chrome.
 *
 * The mark is CSS-driven so it inherits accent preferences and never depends
 * on external image loading for primary navigation identity.
 */

import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { brand } from '@/lib/brand';

interface BrandLockupProps {
  compact?: boolean;
  onNavigate?: () => void;
}

export function BrandLockup({ compact = false, onNavigate }: BrandLockupProps) {
  return (
    <Link
      to="/"
      onClick={onNavigate}
      className={cn(
        'group flex min-h-10 items-center gap-3 rounded-md no-tap-highlight',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1'
      )}
      aria-label={brand.ariaHome}
    >
      <span
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center rounded-md border border-accent-border bg-accent-subtle',
          compact ? 'h-8 w-8' : 'h-9 w-9'
        )}
      >
        <span className="font-display text-base font-semibold text-accent">L</span>
      </span>
      <span className="flex min-w-0 flex-col justify-center">
        <span
          className={cn(
            'font-display font-semibold text-foreground',
            compact ? 'text-lg' : 'text-xl'
          )}
        >
          {brand.name}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground transition-colors group-hover:text-foreground">
          {compact ? brand.shortProduct : brand.product}
        </span>
      </span>
    </Link>
  );
}
