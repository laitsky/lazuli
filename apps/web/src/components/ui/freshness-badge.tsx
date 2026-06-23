/**
 * FreshnessBadge — surfaces API cache freshness to the user
 *
 * The API returns `meta.cache.ageMs` and `meta.cache.stale`. This badge
 * translates those values into a compact human-readable status pill.
 *
 * States:
 *  - < 30s  → fresh (green dot, "12s ago")
 *  - < 60s  → aging (no dot, "45s ago")
 *  - stale  → stale (amber, "stale — exchange unreachable")
 *  - no meta → hidden (don't render)
 */

import { cn } from '@/lib/utils';

export interface FreshnessMeta {
  cache?: {
    ageMs?: number | null;
    stale?: boolean | null;
    refreshError?: string | null;
  } | null;
  source?: string | null;
}

interface FreshnessBadgeProps {
  meta: FreshnessMeta | null | undefined;
  className?: string;
  /** Compact = just a colored dot, no text (for inline use) */
  compact?: boolean;
}

export function FreshnessBadge({ meta, className, compact = false }: FreshnessBadgeProps) {
  const { ageMs, stale, refreshError } = meta?.cache ?? {};

  // No meta — render nothing
  if (!meta || (ageMs === undefined && stale === undefined)) {
    return null;
  }

  // Stale (exchange unreachable, returning cached data)
  if (stale || refreshError) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded',
          'bg-warning/10 border border-warning/30',
          'text-[10px] font-mono uppercase tracking-wider text-warning',
          className
        )}
        title={refreshError ?? 'Data is stale — exchange may be unreachable'}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-blink-soft" />
        {!compact && <span>stale</span>}
      </span>
    );
  }

  const seconds = ageMs ? Math.round(ageMs / 1000) : 0;
  const isFresh = seconds < 30;
  const isAging = seconds >= 30 && seconds < 60;

  if (isFresh) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded',
          'bg-success/10 border border-success/30',
          'text-[10px] font-mono uppercase tracking-wider text-success',
          className
        )}
        title={`Live — updated ${seconds}s ago`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success animate-blink-soft" />
        {!compact && <span>live</span>}
      </span>
    );
  }

  if (isAging) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded',
          'bg-surface-2 border border-border',
          'text-[10px] font-mono uppercase tracking-wider text-muted-foreground',
          className
        )}
        title={`${seconds}s old`}
      >
        {!compact && <span>{seconds}s ago</span>}
      </span>
    );
  }

  // Old data (>60s) but not stale
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded',
        'bg-warning/10 border border-warning/30',
        'text-[10px] font-mono uppercase tracking-wider text-warning',
        className
      )}
      title={`${seconds}s old`}
    >
      {!compact && <span>{seconds}s old</span>}
    </span>
  );
}
