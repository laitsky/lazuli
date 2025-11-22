/**
 * Root loading state - Displayed while homepage loads
 */

import { CardSkeleton, PageHeaderSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <PageHeaderSkeleton />

      {/* Status card skeleton */}
      <CardSkeleton />

      {/* Exchanges grid skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>

      {/* Quick links skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        <div className="grid gap-4 md:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}
