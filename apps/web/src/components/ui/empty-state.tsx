/**
 * EmptyState — friendly "no data" placeholder
 *
 * Every list / table / chart that can be empty should render this. Includes:
 *  - Icon
 *  - Title
 *  - Description
 *  - Optional action (button / link)
 */

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** CTA element (Button, Link, etc.) */
  action?: React.ReactNode;
  className?: string;
  /** Compact — for inline empty states (table cells, panels) */
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6' : 'py-12',
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full',
            'bg-surface-2 border border-border text-muted-foreground',
            compact ? 'h-10 w-10 mb-2' : 'h-14 w-14 mb-3'
          )}
        >
          <Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} strokeWidth={1.5} aria-hidden />
        </div>
      )}
      <p
        className={cn(
          'font-display font-medium text-foreground',
          compact ? 'text-sm' : 'text-base'
        )}
      >
        {title}
      </p>
      {description && <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
