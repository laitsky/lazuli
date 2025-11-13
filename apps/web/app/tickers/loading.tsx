/**
 * Tickers loading state - Displayed while tickers page loads
 */

import { PageHeaderSkeleton, TableSkeleton, Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <PageHeaderSkeleton />

      {/* Exchange selector skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Tickers table card skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
            <Skeleton className="h-9 w-64" />
          </div>
          <TableSkeleton rows={10} />
        </div>
      </div>
    </div>
  )
}
