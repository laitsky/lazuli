import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function MarketTickerSkeleton() {
  return (
    <div className="w-full overflow-hidden py-4 border-y border-white/5 bg-black/20 backdrop-blur-sm">
      <div className="flex gap-8 min-w-full px-4 overflow-hidden">
        <div className="flex gap-4 md:gap-8 justify-center w-full">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 min-w-[200px] px-4 py-2 rounded-lg bg-white/5 animate-pulse"
            >
              <div className="flex flex-col gap-1">
                <div className="h-4 w-12 bg-white/10 rounded" />
                <div className="h-3 w-8 bg-white/5 rounded" />
              </div>
              <div className="flex flex-col items-end ml-auto gap-1">
                <div className="h-4 w-20 bg-white/10 rounded" />
                <div className="h-3 w-12 bg-white/5 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TopMoversSkeleton() {
  return (
    <Card className="glass border-primary/10 h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-5 w-28 bg-white/10 rounded animate-pulse" />
            <div className="h-4 w-36 bg-white/5 rounded animate-pulse" />
          </div>
          <div className="h-8 w-16 bg-white/5 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2.5 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 bg-white/5 rounded animate-pulse" />
                <div className="space-y-1">
                  <div className="h-4 w-12 bg-white/10 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-white/5 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-6 w-14 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
