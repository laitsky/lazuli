/**
 * Tag — compact inline label
 *
 * Like Badge but smaller and not uppercase. Used for asset categories,
 * quote currencies, exchange IDs. Always lowercase.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const tagVariants = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono', {
  variants: {
    variant: {
      default: 'bg-surface-2 text-muted-foreground',
      accent: 'bg-accent-subtle text-accent',
      up: 'bg-success/10 text-success',
      down: 'bg-destructive/10 text-destructive',
      warning: 'bg-warning/10 text-warning',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface TagProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof tagVariants> {}

export function Tag({ className, variant, ...props }: TagProps) {
  return <span className={cn(tagVariants({ variant }), className)} {...props} />;
}
