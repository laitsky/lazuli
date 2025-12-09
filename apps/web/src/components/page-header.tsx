/**
 * PageHeader Component - Lazuli Design System
 *
 * A consistent, clean page header used across all pages (except dashboard).
 * Features:
 * - Icon with primary background
 * - Title and description
 * - Optional badge/status indicator
 * - Subtle gradient background
 */

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: {
    text: string;
    variant?: 'default' | 'success' | 'warning';
  };
  className?: string;
}

export function PageHeader({ icon: Icon, title, description, badge, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-card border border-border p-6',
        className
      )}
    >
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* Decorative blur orb */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <div className="relative flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <Icon className="h-6 w-6 text-primary" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
              {title}
            </h1>
            {badge && (
              <span
                className={cn(
                  'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono',
                  badge.variant === 'success' &&
                    'bg-[hsl(152_60%_45%/0.1)] text-[hsl(152_60%_50%)] border border-[hsl(152_60%_45%/0.2)]',
                  badge.variant === 'warning' &&
                    'bg-[hsl(45_90%_55%/0.1)] text-[hsl(45_90%_55%)] border border-[hsl(45_90%_55%/0.2)]',
                  (!badge.variant || badge.variant === 'default') &&
                    'bg-primary/10 text-primary border border-primary/20'
                )}
              >
                {badge.text}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">{description}</p>
        </div>
      </div>
    </div>
  );
}
