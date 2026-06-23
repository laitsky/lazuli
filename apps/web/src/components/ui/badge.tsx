/**
 * Badge — compact label / status pill
 *
 * Semantic variants tie to data freshness + market direction. Use sparingly —
 * badges are noisy if overused. Prefer PriceText for colored numbers.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  cn(
    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5',
    'text-[11px] font-mono font-medium uppercase tracking-wider',
    'transition-colors whitespace-nowrap'
  ),
  {
    variants: {
      variant: {
        default: 'border-accent-border bg-accent-subtle text-accent',
        secondary: 'border-border bg-surface-2 text-muted-foreground',
        outline: 'border-border text-foreground',
        // Semantic — market direction
        up: 'border-success/30 bg-success/10 text-success',
        down: 'border-destructive/30 bg-destructive/10 text-destructive',
        // Semantic — data freshness
        fresh: 'border-success/30 bg-success/10 text-success',
        stale: 'border-warning/30 bg-warning/10 text-warning',
        dead: 'border-destructive/30 bg-destructive/10 text-destructive',
        // Type variants — kept for legacy compat
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
        success: 'border-success/30 bg-success/10 text-success',
        info: 'border-info/30 bg-info/10 text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
