/**
 * CascadeAlerts Component
 *
 * Displays active liquidation cascade alerts.
 * Cascades occur when liquidation volume exceeds threshold in short time window.
 *
 * Features:
 * - Animated alert cards
 * - Severity-based styling (warning, critical, extreme)
 * - Active/ended state indicators
 * - Price change display
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, TrendingDown, TrendingUp, Clock, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  formatLiquidationValue,
  formatTimeAgo,
  getCascadeSeverityColor,
  getCascadeSeverityBgColor,
  formatPercentage,
} from '@/lib/api-client';
import type { CascadeAlert } from '@lazuli/shared';

interface CascadeAlertsProps {
  /** Cascade alerts to display */
  cascades: CascadeAlert[];
  /** Maximum number of alerts to show */
  maxAlerts?: number;
}

/**
 * Get icon for cascade type
 */
function getCascadeIcon(type: CascadeAlert['type']) {
  switch (type) {
    case 'long_cascade':
      return TrendingDown;
    case 'short_cascade':
      return TrendingUp;
    default:
      return Flame;
  }
}

/**
 * Get label for cascade type
 */
function getCascadeLabel(type: CascadeAlert['type']): string {
  switch (type) {
    case 'long_cascade':
      return 'Long Cascade';
    case 'short_cascade':
      return 'Short Cascade';
    default:
      return 'Mixed Cascade';
  }
}

/**
 * Single cascade alert card
 */
const CascadeCard = memo(function CascadeCard({
  cascade,
  index,
}: {
  cascade: CascadeAlert;
  index: number;
}) {
  const Icon = getCascadeIcon(cascade.type);
  const isLongCascade = cascade.type === 'long_cascade';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <div
        className={`
          relative p-4 rounded-lg border transition-all
          ${getCascadeSeverityBgColor(cascade.severity)}
          ${cascade.isActive ? 'animate-pulse' : 'opacity-70'}
        `}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className={`
              p-1.5 rounded-md
              ${isLongCascade ? 'bg-red-500/20 text-red-500' : cascade.type === 'short_cascade' ? 'bg-green-500/20 text-green-500' : 'bg-orange-500/20 text-orange-500'}
            `}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{cascade.symbol}</span>
                <Badge variant={cascade.isActive ? 'default' : 'secondary'} className="text-xs">
                  {cascade.isActive ? 'ACTIVE' : 'ENDED'}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">{getCascadeLabel(cascade.type)}</span>
            </div>
          </div>
          <Badge
            className={`${getCascadeSeverityColor(cascade.severity)} text-xs uppercase`}
            variant="outline"
          >
            {cascade.severity}
          </Badge>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Total Value</span>
            <p className="font-mono font-bold">{formatLiquidationValue(cascade.totalValue)}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Liquidations</span>
            <p className="font-mono font-bold">{cascade.liquidationCount}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Price Change</span>
            <p
              className={`font-mono font-bold ${cascade.priceChange < 0 ? 'text-red-500' : 'text-green-500'}`}
            >
              {formatPercentage(cascade.priceChangePercent)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Duration</span>
            <p className="font-mono font-bold flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {Math.floor(cascade.duration)}s
            </p>
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
          <span>Started: {formatTimeAgo(cascade.startTime)}</span>
          <span>Last: {formatTimeAgo(cascade.lastUpdate)}</span>
        </div>

        {/* Active indicator pulse */}
        {cascade.isActive && (
          <div className="absolute top-2 right-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
});

/**
 * Empty state when no cascades
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <Zap className="w-10 h-10 mb-3 opacity-20" />
      <p className="text-sm">No active cascades</p>
      <p className="text-xs mt-1">Market is stable</p>
    </div>
  );
}

/**
 * CascadeAlerts Component
 */
export function CascadeAlerts({ cascades, maxAlerts = 5 }: CascadeAlertsProps) {
  const displayCascades = cascades.slice(0, maxAlerts);
  const activeCount = cascades.filter((c) => c.isActive).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            Cascade Alerts
          </CardTitle>
          {activeCount > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              {activeCount} Active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {displayCascades.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {displayCascades.map((cascade, index) => (
                <CascadeCard key={cascade.id} cascade={cascade} index={index} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CascadeAlerts;
