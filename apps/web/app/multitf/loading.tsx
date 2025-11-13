/**
 * MultiTF loading state - Displayed while multi-timeframe page loads
 */

import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <PageHeaderSkeleton />

      {/* Controls skeleton */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Charts grid skeleton */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <Skeleton className="h-[400px] w-full" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <Skeleton className="h-[400px] w-full" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <Skeleton className="h-[400px] w-full" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    </div>
  )
}
