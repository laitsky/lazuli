/**
 * Kbd — keyboard key indicator
 *
 * Used in tooltips, command palette footer, and inline hints.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export function Kbd({ className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5',
        'rounded border border-border bg-surface-2',
        'text-[10px] font-mono font-medium text-muted-foreground',
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
