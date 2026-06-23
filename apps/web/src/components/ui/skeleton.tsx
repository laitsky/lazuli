/**
 * Skeleton — loading placeholder with shimmer
 *
 * Layout-matched placeholder blocks. Use for content that loads async —
 * never show a blank area when you can show a skeleton with the same shape.
 *
 * Compound components:
 *  - Skeleton             base block (pass w/h via className)
 *  - TextSkeleton         line of text
 *  - MetricSkeleton       KPI card skeleton
 *  - TableSkeleton        multi-row table skeleton
 *  - ChartSkeleton        chart-area skeleton
 *  - CardSkeleton         full card skeleton
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('rounded skeleton-shimmer', className)}
      aria-busy="true"
      aria-live="polite"
      {...props}
    />
  );
}

export function TextSkeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${85 - i * 10}%` }} />
      ))}
    </div>
  );
}

export function MetricSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-0 border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex gap-3 bg-surface-1 border-b border-border p-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 p-3 border-b border-border last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-4 flex-1"
              style={{ width: `${60 + ((r + c) % 4) * 10}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border" style={{ height }}>
      <Skeleton className="absolute inset-0 rounded-none" />
      <div className="absolute inset-0 flex items-end justify-around p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="w-4 bg-surface-2/40 rounded-t"
            style={{ height: `${30 + Math.sin(i) * 25 + 30}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-5 space-y-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}
