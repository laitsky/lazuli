/**
 * PageHeader — standard page title + actions row
 *
 * Every page renders one. Includes:
 *  - Title + optional icon
 *  - One-line description (optional, hidden on mobile)
 *  - Data freshness badge (optional, derived from API meta)
 *  - Actions slot (filters, buttons)
 *
 * Mobile: title + actions only. Description hidden below md.
 */

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FreshnessBadge, type FreshnessMeta } from './freshness-badge';

interface PageHeaderProps {
  /** Optional icon to precede the title */
  icon?: LucideIcon;
  /** Page title (H1) */
  title: string;
  /** Optional description shown under the title */
  description?: string;
  /** Right-side actions — filters, buttons, refresh, etc. */
  actions?: React.ReactNode;
  /** API meta for freshness display */
  freshnessMeta?: FreshnessMeta | null;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  freshnessMeta,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-center md:justify-between',
        'mb-6',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {Icon && <Icon className="h-5 w-5 text-accent shrink-0" strokeWidth={2.25} aria-hidden />}
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-foreground truncate">
            {title}
          </h1>
          {freshnessMeta && <FreshnessBadge meta={freshnessMeta} />}
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </header>
  );
}

/** Lightweight skeleton version of PageHeader for loading states */
export function PageHeaderSkeleton() {
  return (
    <header className="mb-6">
      <div className="h-8 w-48 skeleton-shimmer rounded-md" />
      <div className="mt-2 h-4 w-72 skeleton-shimmer rounded-md" />
    </header>
  );
}
