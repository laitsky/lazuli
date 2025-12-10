/**
 * LiquidationHeatmap Component
 *
 * Visual representation of liquidation density by price level.
 * Shows where liquidations cluster at different prices.
 *
 * Features:
 * - Vertical bar chart showing liquidation intensity
 * - Color gradient from low (blue) to high (red) intensity
 * - Current price indicator line
 * - Hover tooltips with detailed breakdown
 * - Long/Short separation
 */

import { memo, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLiquidationValue } from '@/lib/api-client';
import type {
  LiquidationHeatmap as LiquidationHeatmapType,
  LiquidationBucket,
} from '@lazuli/shared';
import { BarChart3 } from 'lucide-react';

interface LiquidationHeatmapProps {
  /** Heatmap data */
  data: LiquidationHeatmapType | null;
  /** Component height */
  height?: number;
  /** Show current price indicator */
  showCurrentPrice?: boolean;
  /** Whether data is loading */
  isLoading?: boolean;
}

/**
 * Format price for display
 */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  } else if (price >= 1) {
    return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } else {
    return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
}

/**
 * Single heatmap bar component
 */
const HeatmapBar = memo(function HeatmapBar({
  bucket,
  maxIntensity,
  isCurrentPrice,
}: {
  bucket: LiquidationBucket;
  maxIntensity: number;
  isCurrentPrice: boolean;
}) {
  const longWidth = bucket.totalValue > 0 ? (bucket.longValue / bucket.totalValue) * 100 : 50;
  const shortWidth = 100 - longWidth;
  const opacity = maxIntensity > 0 ? 0.3 + (bucket.intensity / maxIntensity) * 0.7 : 0.3;

  return (
    <div
      className={`
        group relative flex h-full min-h-[6px] rounded-sm overflow-hidden cursor-pointer
        ${isCurrentPrice ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
      `}
      title={`$${formatPrice(bucket.priceCenter)} | Long: ${formatLiquidationValue(bucket.longValue)} | Short: ${formatLiquidationValue(bucket.shortValue)}`}
    >
      {/* Long liquidations (red) */}
      {bucket.longValue > 0 && (
        <div
          className="bg-red-500 transition-all duration-300"
          style={{
            width: `${longWidth}%`,
            opacity,
          }}
        />
      )}
      {/* Short liquidations (green) */}
      {bucket.shortValue > 0 && (
        <div
          className="bg-green-500 transition-all duration-300"
          style={{
            width: `${shortWidth}%`,
            opacity,
          }}
        />
      )}
      {/* Empty bucket */}
      {bucket.totalValue === 0 && <div className="w-full bg-muted/20" />}

      {/* Hover tooltip */}
      <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-10 hidden group-hover:block">
        <div className="bg-popover text-popover-foreground border rounded-md shadow-md p-2 whitespace-nowrap text-xs">
          <div className="font-mono font-medium">${formatPrice(bucket.priceCenter)}</div>
          <div className="text-red-500">Long: {formatLiquidationValue(bucket.longValue)}</div>
          <div className="text-green-500">Short: {formatLiquidationValue(bucket.shortValue)}</div>
          <div className="text-muted-foreground">{bucket.totalCount} liquidations</div>
        </div>
      </div>
    </div>
  );
});

/**
 * Loading skeleton
 */
function HeatmapSkeleton({ height }: { height: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Liquidation Heatmap
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="animate-pulse" style={{ height }}>
          <div className="flex h-full gap-1">
            <div className="w-16 bg-muted rounded" />
            <div className="flex-1 bg-muted rounded" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * LiquidationHeatmap Component
 */
export function LiquidationHeatmap({
  data,
  height = 400,
  showCurrentPrice = true,
  isLoading,
}: LiquidationHeatmapProps) {
  // Hooks must be called unconditionally
  const maxIntensity = useMemo(
    () => (data ? Math.max(...data.buckets.map((b) => b.intensity), 0.01) : 0),
    [data]
  );

  const currentPriceIndex = useMemo(() => {
    if (!data) return -1;
    return data.buckets.findIndex(
      (b) => data.currentPrice >= b.priceMin && data.currentPrice <= b.priceMax
    );
  }, [data]);

  // Reverse buckets so highest price is at top
  const reversedBuckets = useMemo(() => (data ? [...data.buckets].reverse() : []), [data]);

  const reversedCurrentPriceIndex = data ? data.buckets.length - 1 - currentPriceIndex : -1;

  // Early return after all hooks
  if (isLoading || !data) {
    return <HeatmapSkeleton height={height} />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Liquidation Heatmap
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {data.meta.totalLiquidations} liquidations |{' '}
            {formatLiquidationValue(data.meta.totalValue)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex" style={{ height }}>
          {/* Price axis (left) */}
          <div className="flex flex-col justify-between text-xs text-muted-foreground pr-3 py-1 min-w-[60px]">
            <span className="font-mono">${formatPrice(data.priceRange.max)}</span>
            {showCurrentPrice && (
              <span className="font-mono text-primary font-medium">
                ${formatPrice(data.currentPrice)}
              </span>
            )}
            <span className="font-mono">${formatPrice(data.priceRange.min)}</span>
          </div>

          {/* Heatmap bars */}
          <div className="flex-1 flex flex-col gap-0.5 relative">
            {reversedBuckets.map((bucket, index) => (
              <HeatmapBar
                key={index}
                bucket={bucket}
                maxIntensity={maxIntensity}
                isCurrentPrice={index === reversedCurrentPriceIndex}
              />
            ))}

            {/* Current price line */}
            {showCurrentPrice && currentPriceIndex >= 0 && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-primary z-10 pointer-events-none"
                style={{
                  top: `${((data.priceRange.max - data.currentPrice) / (data.priceRange.max - data.priceRange.min)) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-sm opacity-70" />
            <span>Long Liquidations</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-sm opacity-70" />
            <span>Short Liquidations</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default LiquidationHeatmap;
