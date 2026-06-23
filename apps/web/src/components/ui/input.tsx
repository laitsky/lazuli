/**
 * Input — text input
 *
 * Mobile-first. Default height 40px (h-10) for accessibility. Smaller sizes
 * (h-8) for inline filter inputs where space is constrained.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  cn(
    'flex w-full rounded-md border border-border bg-surface-1 text-foreground',
    'placeholder:text-muted-foreground/70',
    'transition-[border-color,box-shadow,background-color]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
    'focus-visible:border-accent focus-visible:bg-surface-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'file:border-0 file:bg-transparent file:text-sm file:font-medium'
  ),
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5 text-xs',
        default: 'h-10 px-3 text-sm',
        lg: 'h-11 px-4 text-base',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', size, ...props }, ref) => {
    return (
      <input type={type} className={cn(inputVariants({ size, className }))} ref={ref} {...props} />
    );
  }
);
Input.displayName = 'Input';

export { Input, inputVariants };
