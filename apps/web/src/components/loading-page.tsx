/**
 * Full-page loading skeleton
 * Used as Suspense fallback for lazy-loaded pages
 */
export function LoadingPage() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-48 bg-card rounded-lg" />
        <div className="h-4 w-96 bg-card rounded" />
      </div>

      {/* Content skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-48 bg-card rounded-xl border border-border" />
        ))}
      </div>
    </div>
  );
}
