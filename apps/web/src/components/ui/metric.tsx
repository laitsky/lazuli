/**
 * Metric — large display number with label + delta
 *
 * Used for KPI cards, dashboard stats, asset header on workspace, etc.
 * Layout: label (muted mono) + value (display font, large) + optional delta.
 *
 * Pass `mono` to render the value in Fira Code (default for prices/percentages).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface MetricProps {
  label: string;
  value: React.ReactNode;
  /** Delta value (e.g. +2.4%). Sign drives color. */
  delta?: number | null;
  /** Format delta — defaults to fixed-2 with sign */
  formatDelta?: (v: number) => string;
  /** Render value in mono font (numbers). Default true. */
  mono?: boolean;
  /** Size — default 'lg' (page metric), 'md' (card metric), 'sm' (inline) */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Override the label color */
  labelClassName?: string;
  children?: React.ReactNode;
}

const sizeClasses = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-4xl',
} as const;

export function Metric({
  label,
  value,
  delta,
  formatDelta = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`,
  mono = true,
  size = 'lg',
  className,
  labelClassName,
  children,
}: MetricProps) {
  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;
  const hasDelta = delta !== null && delta !== undefined;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <dt
        className={cn(
          'text-xs font-mono uppercase tracking-wider text-muted-foreground',
          labelClassName
        )}
      >
        {label}
      </dt>
      <dd className={cn('flex items-baseline gap-2 flex-wrap')}>
        <span
          className={cn(
            'font-display font-semibold text-foreground leading-none',
            sizeClasses[size],
            mono && 'numeric'
          )}
        >
          {value}
        </span>
        {hasDelta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              isUp && 'text-up',
              isDown && 'text-down',
              !isUp && !isDown && 'text-muted-foreground'
            )}
          >
            {isUp && <ArrowUp className="h-3 w-3" aria-hidden />}
            {isDown && <ArrowDown className="h-3 w-3" aria-hidden />}
            {formatDelta(delta!)}
          </span>
        )}
      </dd>
      {children}
    </div>
  );
}
