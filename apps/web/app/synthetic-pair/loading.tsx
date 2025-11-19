/**
 * Synthetic Pair loading state - Displayed while synthetic pair page loads
 */

import { PageHeaderSkeleton, Skeleton, CardSkeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <PageHeaderSkeleton />

      {/* Pair selector skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <div className="space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </div>

      {/* Chart skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <Skeleton className="h-[500px] w-full" />
      </div>

      {/* Stats cards skeleton */}
      <div className="grid gap-4 md:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  )
}
