/**
 * SegmentedControl — mutually exclusive option group
 *
 * Used for spot/perp toggle, timeframe pickers, sort direction. Mobile-first:
 * options can wrap. Active option gets accent background.
 *
 * Controlled: caller manages `value` and `onChange`.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional icon rendered before label */
  icon?: React.ComponentType<{ className?: string }>;
  /** Disable this option */
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Compact variant — smaller padding for inline use */
  size?: 'sm' | 'md';
  /** Full-width — stretches to container */
  fullWidth?: boolean;
  /** Accessible label */
  'aria-label'?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 p-0.5 rounded-md',
        'bg-surface-1 border border-border',
        fullWidth && 'w-full grid',
        className
      )}
      style={fullWidth ? { gridTemplateColumns: `repeat(${options.length}, 1fr)` } : undefined}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-sm',
              'font-medium transition-colors no-tap-highlight',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-2',
              fullWidth && 'w-full'
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
