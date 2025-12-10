/**
 * LiquidationStats Component
 *
 * Statistics cards showing liquidation analytics.
 * Displays total volume, long/short ratio, intensity, and top symbol.
 *
 * Features:
 * - Key metric cards with icons
 * - Long/short ratio visualization
 * - Intensity indicator
 * - Period selector (1h, 4h, 24h)
 */

import { memo } from 'react';
import { TrendingDown, TrendingUp, DollarSign, Activity, Flame } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatLiquidationValue, formatLongShortRatio } from '@/lib/api-client';
import type { LiquidationStats as LiquidationStatsType } from '@lazuli/shared';

interface LiquidationStatsProps {
  /** Statistics data */
  stats: LiquidationStatsType | null;
  /** Whether data is loading */
  isLoading?: boolean;
}

/**
 * Individual stat card component
 */
const StatCard = memo(function StatCard({
  title,
  value,
  subValue,
  icon: Icon,
  iconColor = 'text-primary',
}: {
  title: string;
  value: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className="text-xl font-bold font-mono">{value}</p>
            {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted/50 ${iconColor}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Long/Short ratio visualization card
 */
const RatioCard = memo(function RatioCard({
  longValue,
  shortValue,
  ratio,
}: {
  longValue: number;
  shortValue: number;
  ratio: number;
}) {
  const { text: ratioText, indicator } = formatLongShortRatio(ratio);
  const total = longValue + shortValue;
  const longPercent = total > 0 ? (longValue / total) * 100 : 50;
  const shortPercent = total > 0 ? (shortValue / total) * 100 : 50;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">Long/Short Ratio</p>
            <Badge
              variant={
                indicator === 'bearish'
                  ? 'destructive'
                  : indicator === 'bullish'
                    ? 'success'
                    : 'secondary'
              }
            >
              {ratioText}
            </Badge>
          </div>

          {/* Ratio bar */}
          <div className="flex h-3 rounded-full overflow-hidden bg-muted">
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${longPercent}%` }}
            />
            <div
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${shortPercent}%` }}
            />
          </div>

          {/* Labels */}
          <div className="flex justify-between text-xs">
            <div className="flex items-center gap-1 text-red-500">
              <TrendingDown className="w-3 h-3" />
              <span>Long: {formatLiquidationValue(longValue)}</span>
            </div>
            <div className="flex items-center gap-1 text-green-500">
              <span>Short: {formatLiquidationValue(shortValue)}</span>
              <TrendingUp className="w-3 h-3" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Top symbols list card
 */
const TopSymbolsCard = memo(function TopSymbolsCard({
  topSymbols,
}: {
  topSymbols: { symbol: string; count: number; value: number }[];
}) {
  if (topSymbols.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground font-medium mb-2">Top Symbols</p>
          <p className="text-sm text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium mb-3">Top Liquidated Symbols</p>
        <div className="space-y-2">
          {topSymbols.slice(0, 5).map((item, index) => (
            <div key={item.symbol} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-4">{index + 1}.</span>
                <span className="font-mono font-medium">{item.symbol}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{item.count} liqs</span>
                <span className="font-mono text-xs">{formatLiquidationValue(item.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Loading skeleton for stats
 */
function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="animate-pulse space-y-2">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-6 w-24 bg-muted rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * LiquidationStats Component
 */
export function LiquidationStats({ stats, isLoading }: LiquidationStatsProps) {
  if (isLoading || !stats) {
    return <StatsSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Main stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Liquidated"
          value={formatLiquidationValue(stats.totalValue)}
          subValue={`${stats.totalCount} liquidations`}
          icon={DollarSign}
          iconColor="text-primary"
        />

        <StatCard
          title="Intensity"
          value={`${stats.intensity.toFixed(1)}/min`}
          subValue={`${stats.period} average`}
          icon={Activity}
          iconColor="text-yellow-500"
        />

        <StatCard
          title="Largest Single"
          value={
            stats.largestLiquidation
              ? formatLiquidationValue(stats.largestLiquidation.value)
              : 'N/A'
          }
          subValue={stats.largestLiquidation?.symbol}
          icon={Flame}
          iconColor="text-orange-500"
        />

        <StatCard
          title="Long Liquidations"
          value={formatLiquidationValue(stats.longValue)}
          subValue={`${stats.longCount} positions`}
          icon={TrendingDown}
          iconColor="text-red-500"
        />
      </div>

      {/* Ratio and top symbols */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RatioCard
          longValue={stats.longValue}
          shortValue={stats.shortValue}
          ratio={stats.longShortRatio}
        />
        <TopSymbolsCard topSymbols={stats.topSymbols} />
      </div>
    </div>
  );
}

export default LiquidationStats;
