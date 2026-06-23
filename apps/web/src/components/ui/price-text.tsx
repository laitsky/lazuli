/**
 * PriceText — auto-styled price + change indicator
 *
 * For tables and inline use. Color is driven by sign of `change` (if provided).
 * Numbers are always tabular-nums in mono.
 *
 * Variants:
 *  - default: just the price
 *  - with change: price + (colored) percentage
 *  - subtle: muted styling for less-prominent display
 */

import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';

interface PriceTextProps {
  /** Price value. null/undefined renders '—' */
  value: number | null | undefined;
  /** Optional 24h percentage change. Drives color. */
  changePercent?: number | null;
  /** Currency symbol to prefix (default '$') */
  currency?: string;
  /** Show +/- sign on change even if positive */
  signed?: boolean;
  /** Smaller text size for inline use */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Show change inline next to price (default) or as separate element */
  inlineChange?: boolean;
  className?: string;
}

const sizeClasses = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
} as const;

export function PriceText({
  value,
  changePercent,
  currency = '$',
  signed = true,
  size = 'sm',
  inlineChange = true,
  className,
}: PriceTextProps) {
  const hasChange = changePercent !== null && changePercent !== undefined;
  const isUp = (changePercent ?? 0) > 0;
  const isDown = (changePercent ?? 0) < 0;

  return (
    <span
      className={cn('inline-flex items-baseline gap-1.5', inlineChange && 'flex-wrap', className)}
    >
      <span className={cn('numeric font-medium text-foreground', sizeClasses[size])}>
        {value === null || value === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            {currency}
            {formatPrice(value)}
          </>
        )}
      </span>
      {hasChange && (
        <span
          className={cn(
            'numeric text-xs font-medium',
            sizeClasses[size],
            isUp && 'text-up',
            isDown && 'text-down',
            !isUp && !isDown && 'text-muted-foreground'
          )}
        >
          {signed && isUp ? '+' : ''}
          {changePercent!.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

/** Bare percentage change — for columns that already show the price separately */
export function ChangeText({
  value,
  signed = true,
  className,
  size = 'sm',
}: {
  value: number | null | undefined;
  signed?: boolean;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const isUp = (value ?? 0) > 0;
  const isDown = (value ?? 0) < 0;
  return (
    <span
      className={cn(
        'numeric font-medium',
        sizeClasses[size],
        isUp && 'text-up',
        isDown && 'text-down',
        !isUp && !isDown && 'text-muted-foreground',
        className
      )}
    >
      {value === null || value === undefined
        ? '—'
        : `${signed && isUp ? '+' : ''}${value.toFixed(2)}%`}
    </span>
  );
}
