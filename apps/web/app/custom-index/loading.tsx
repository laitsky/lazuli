import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for Custom Index page
 * Shows placeholder UI while the page is loading
 */
export default function CustomIndexLoading() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section Skeleton */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-5 w-96" />
          </div>
        </div>
      </div>

      {/* Configuration Card Skeleton */}
      <Card className="glass border-white/5">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Index Name */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-80" />
          </div>

          {/* Exchange and Timeframe */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-12" />
                ))}
              </div>
            </div>
          </div>

          {/* Selected Assets */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <div className="p-6 border border-dashed border-white/10 rounded-lg">
              <Skeleton className="h-8 w-8 mx-auto mb-2" />
              <Skeleton className="h-4 w-64 mx-auto" />
            </div>
          </div>

          {/* Asset Selector */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-10 w-full" />
            <div className="border border-white/10 rounded-xl h-[250px] p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
