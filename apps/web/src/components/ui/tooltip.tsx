/**
 * Tooltip — Radix-based hover/focus tooltip
 *
 * Wrap any element with <Tooltip content="..."> for instant tooltips.
 * Disabled on touch devices (Radix auto-handles). Delay is 300ms to avoid
 * flicker but feel responsive.
 */

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md px-2.5 py-1.5',
        'bg-surface-2 border border-border text-foreground shadow-lg',
        'text-xs font-medium',
        'animate-scale-in',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Convenience wrapper: <Tip content="..." disabled={false}>child</Tip>
 * Use when you don't need fine control over trigger/content split.
 */
interface TipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
}

export function Tip({ content, children, side = 'top', align = 'center', disabled }: TipProps) {
  if (disabled) return <>{children}</>;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
