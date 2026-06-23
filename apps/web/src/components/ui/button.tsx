/**
 * Button — primary action element
 *
 * Variants drive intent. Sizes drive density. All variants work for both
 * <button> and <a> (via asChild).
 *
 * Mobile: minimum 40px touch target for sm/default. xs is for inline use only.
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'font-medium select-none no-tap-highlight',
    'transition-[background-color,border-color,color,opacity,transform] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variants: {
      variant: {
        // Solid accent — primary CTA
        default:
          'bg-accent text-accent-foreground hover:bg-accent/90 hover:shadow-sm active:scale-[0.98] [&_svg]:size-4',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98] [&_svg]:size-4',
        success:
          'bg-success text-success-foreground hover:bg-success/90 active:scale-[0.98] [&_svg]:size-4',
        // Outlined — secondary action
        outline:
          'border border-border bg-surface-1 text-foreground hover:bg-surface-2 hover:border-border-strong active:scale-[0.98] [&_svg]:size-4',
        // Subtle accent outlined
        accent:
          'border border-accent-border bg-accent-subtle text-accent hover:bg-accent/15 active:scale-[0.98] [&_svg]:size-4',
        // Ghost — no chrome, used in dense rows
        ghost: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground [&_svg]:size-4',
        // Subtle — used for filters that are inactive
        secondary: 'bg-surface-2 text-foreground hover:bg-surface-3 [&_svg]:size-4',
        // Link — inline link button (no padding, no border)
        link: 'text-accent underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        xs: 'h-6 px-2 text-xs gap-1 rounded [&_svg]:size-3',
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        default: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base [&_svg]:size-4',
        icon: 'h-9 w-9 [&_svg]:size-4',
        'icon-sm': 'h-7 w-7 [&_svg]:size-3.5',
        'icon-lg': 'h-11 w-11 [&_svg]:size-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? undefined : type}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
