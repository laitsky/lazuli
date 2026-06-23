/**
 * IconButton — square button for icon-only actions
 *
 * Always sets `aria-label` (required). Mobile: minimum 40px hit target.
 * Use for refresh, settings, watchlist star, screenshot, etc.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const iconButtonVariants = cva(
  cn(
    'inline-flex items-center justify-center shrink-0',
    'rounded-md no-tap-highlight select-none',
    'transition-[background-color,border-color,color,opacity,transform]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.96]'
  ),
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground hover:bg-accent/90',
        outline:
          'border border-border bg-surface-1 text-foreground hover:bg-surface-2 hover:border-border-strong',
        ghost: 'text-muted-foreground hover:text-foreground hover:bg-surface-2',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-7 w-7 [&_svg]:size-3.5',
        md: 'h-9 w-9 [&_svg]:size-4',
        lg: 'h-11 w-11 [&_svg]:size-5',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  }
);

export interface IconButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof iconButtonVariants> {
  'aria-label': string;
  icon: React.ComponentType<{ className?: string }>;
  /** Render a badge dot on the corner (e.g. for unread notifications) */
  badge?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, icon: Icon, badge, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      <Icon className="" aria-hidden />
      {badge && (
        <span
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent border border-surface-0"
          aria-hidden
        />
      )}
    </button>
  )
);
IconButton.displayName = 'IconButton';
