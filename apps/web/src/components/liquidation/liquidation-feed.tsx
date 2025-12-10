/**
 * LiquidationFeed Component
 *
 * Real-time liquidation event stream with animated entries.
 * Shows live liquidation events color-coded by side with size-based emphasis.
 *
 * Features:
 * - Auto-refreshing feed (5s default)
 * - Animated entry for new liquidations
 * - Color-coded by side (long = red, short = green)
 * - Size-based visual emphasis for whale liquidations
 * - Rolling summary statistics
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingDown, TrendingUp, Flame, Zap, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatLiquidationValue, formatTimeAgo, getLiquidationSideBgColor } from '@/lib/api-client';
import type { LiquidationEvent } from '@lazuli/shared';

interface LiquidationFeedProps {
  /** Liquidation events to display */
  events: LiquidationEvent[];
  /** Set of event IDs that are "new" (for highlighting) */
  newEventIds?: Set<string>;
  /** Rolling summary statistics */
  summary?: {
    last1m: { count: number; value: number };
    last5m: { count: number; value: number };
    last15m: { count: number; value: number };
  };
  /** Whether data is currently refreshing */
  isRefreshing?: boolean;
  /** Seconds until next refresh */
  countdown?: number;
  /** Manual refresh callback */
  onRefresh?: () => void;
  /** Maximum height for scrolling */
  maxHeight?: string;
}

/**
 * Single liquidation event item
 */
const LiquidationItem = memo(function LiquidationItem({
  liquidation,
  isNew,
  index,
}: {
  liquidation: LiquidationEvent;
  isNew: boolean;
  index: number;
}) {
  const isLong = liquidation.side === 'long';
  const isLarge = liquidation.value > 100000; // >$100k
  const isHuge = liquidation.value > 1000000; // >$1M

  return (
    <motion.div
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
      className={`
        flex items-center justify-between p-3 rounded-lg border transition-all
        ${isNew ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-background' : ''}
        ${
          isHuge
            ? 'bg-orange-500/10 border-orange-500/30'
            : isLarge
              ? 'bg-yellow-500/10 border-yellow-500/20'
              : getLiquidationSideBgColor(liquidation.side)
        }
      `}
    >
      {/* Left side: Icon + Symbol + Side */}
      <div className="flex items-center gap-3">
        <div
          className={`
          p-2 rounded-full
          ${isLong ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}
        `}
        >
          {isLong ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-sm">{liquidation.symbol}</span>
            <Badge variant={isLong ? 'destructive' : 'success'} className="text-xs">
              {isLong ? 'LONG' : 'SHORT'}
            </Badge>
            {isHuge && <Flame className="w-4 h-4 text-orange-500 animate-pulse" />}
          </div>
          <div className="text-xs text-muted-foreground">
            @ ${liquidation.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Right side: Value + Time */}
      <div className="text-right">
        <div
          className={`font-mono font-bold ${isHuge ? 'text-lg text-orange-500' : isLarge ? 'text-base text-yellow-500' : 'text-sm'}`}
        >
          {formatLiquidationValue(liquidation.value)}
        </div>
        <div className="text-xs text-muted-foreground">{formatTimeAgo(liquidation.timestamp)}</div>
      </div>
    </motion.div>
  );
});

/**
 * Summary statistics bar
 */
function SummaryBar({
  summary,
}: {
  summary: {
    last1m: { count: number; value: number };
    last5m: { count: number; value: number };
    last15m: { count: number; value: number };
  };
}) {
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground px-1 py-2 border-t border-border">
      <div className="flex items-center gap-4">
        <span>
          <strong className="text-foreground">{summary.last1m.count}</strong> in 1m |{' '}
          {formatLiquidationValue(summary.last1m.value)}
        </span>
        <span>
          <strong className="text-foreground">{summary.last5m.count}</strong> in 5m |{' '}
          {formatLiquidationValue(summary.last5m.value)}
        </span>
      </div>
      <span>15m: {formatLiquidationValue(summary.last15m.value)}</span>
    </div>
  );
}

/**
 * LiquidationFeed Component
 */
export function LiquidationFeed({
  events,
  newEventIds = new Set(),
  summary,
  isRefreshing,
  countdown,
  onRefresh,
  maxHeight = '500px',
}: LiquidationFeedProps) {
  // Empty state
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Live Liquidation Feed</CardTitle>
            </div>
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-8"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Zap className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm">No liquidations recorded</p>
            <p className="text-xs mt-1">Waiting for market activity...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Live Liquidation Feed</CardTitle>
            {isRefreshing && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            {countdown !== undefined && (
              <span className="text-xs text-muted-foreground font-mono">{countdown}s</span>
            )}
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-8"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2 overflow-y-auto" style={{ maxHeight }}>
          <AnimatePresence mode="popLayout">
            {events.map((liq, index) => (
              <LiquidationItem
                key={liq.id}
                liquidation={liq}
                isNew={newEventIds.has(liq.id)}
                index={index}
              />
            ))}
          </AnimatePresence>
        </div>
        {summary && <SummaryBar summary={summary} />}
      </CardContent>
    </Card>
  );
}

export default LiquidationFeed;
