/**
 * Exchanges loading state - Displayed while exchanges page loads
 */

import { CardSkeleton, PageHeaderSkeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <PageHeaderSkeleton />

      {/* Exchanges table card skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-6 w-32 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
          </div>
          <TableSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
