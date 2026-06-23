/**
 * Panel — primary surface container for content
 *
 * Replaces the old Card with a flatter, simpler API. Three elevation levels:
 *   <Panel>                → surface-1 (default card)
 *   <Panel elevation="2">  → surface-2 (elevated / popover)
 *
 * Use the named subcomponents (PanelHeader, PanelTitle, PanelBody, PanelFooter)
 * for structured layouts. For free-form content, just use <Panel> directly.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

type Elevation = 1 | 2 | 3;

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
  /** Disable hover treatment (useful for static info panels) */
  interactive?: boolean;
  /** Remove default padding (Panel is padded by default) */
  flush?: boolean;
}

const surfaceClasses: Record<Elevation, string> = {
  1: 'bg-surface-1',
  2: 'bg-surface-2',
  3: 'bg-surface-3',
};

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, elevation = 1, interactive = false, flush = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border',
        surfaceClasses[elevation],
        !flush && 'p-5',
        interactive &&
          'transition-colors hover:border-border-strong hover:bg-surface-2 cursor-pointer',
        className
      )}
      {...props}
    />
  )
);
Panel.displayName = 'Panel';

export const PanelHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between gap-3 mb-4', className)}
      {...props}
    />
  )
);
PanelHeader.displayName = 'PanelHeader';

export const PanelTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('font-display font-semibold text-base text-foreground', className)}
    {...props}
  />
));
PanelTitle.displayName = 'PanelTitle';

export const PanelDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
PanelDescription.displayName = 'PanelDescription';

export const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn(className)} {...props} />
);
PanelBody.displayName = 'PanelBody';

export const PanelFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 mt-4 pt-4 border-t border-border', className)}
      {...props}
    />
  )
);
PanelFooter.displayName = 'PanelFooter';
