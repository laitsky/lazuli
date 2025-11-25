'use client';

/**
 * AltcoinGrid - Grid display component for Alt Screener
 *
 * This component displays all altcoins in a responsive grid layout with:
 * - Mini sparkline charts for each altcoin
 * - Performance badges with color coding
 * - Filtering controls (search, volume, performance range)
 * - Sorting options (performance, volume, price, name)
 * - Base currency selector (USD, BTC, ETH, SOL)
 * - Quick filter buttons (gainers, losers, high volume)
 * - Heatmap view toggle
 *
 * The grid allows traders to quickly scan all altcoins and identify
 * potential opportunities based on relative performance.
 */

import { useState, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AltcoinMiniChart } from './altcoin-mini-chart';
import { formatCurrency, formatVolume, formatPercentage, getChangeColor } from '@/lib/api-client';
import { AltcoinPerformance, BaseCurrency, ScreenerSortBy } from '@lazuli/shared';

import {
  Search,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Grid3X3,
  List,
  Filter,
  X,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

/**
 * Animation delay constants - optimized for performance
 * Using smaller delays and capping max delay to prevent long animation queues
 */
const ANIMATION_CONFIG = {
  grid: { delay: 0.005, maxDelay: 0.15, duration: 0.15 },
  list: { delay: 0.003, maxDelay: 0.1, duration: 0.15 },
  heatmap: { delay: 0.002, maxDelay: 0.08, duration: 0.08 },
} as const;

/**
 * Props for the AltcoinGrid component
 */
interface AltcoinGridProps {
  /** Array of altcoin performance data */
  altcoins: AltcoinPerformance[];
  /** Current base currency for comparison */
  baseCurrency: BaseCurrency;
  /** Callback when base currency changes */
  onBaseCurrencyChange: (base: BaseCurrency) => void;
  /** Current price of the base currency */
  basePrice: number;
  /** Whether data is loading */
  isLoading?: boolean;
}

/**
 * Quick filter presets
 */
type QuickFilter = 'all' | 'gainers' | 'losers' | 'high_volume' | 'low_cap';

/**
 * View mode for the grid
 */
type ViewMode = 'grid' | 'list' | 'heatmap';

/**
 * Base currency options with display labels
 */
const BASE_CURRENCY_OPTIONS: { value: BaseCurrency; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'BTC', label: 'BTC' },
  { value: 'ETH', label: 'ETH' },
  { value: 'SOL', label: 'SOL' },
];

/**
 * Sort options with display labels
 */
const SORT_OPTIONS: { value: ScreenerSortBy; label: string }[] = [
  { value: 'performance', label: 'Performance' },
  { value: 'volume', label: 'Volume' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
];

/**
 * Calculate heatmap intensity based on percentage change
 * Returns a value between 0 and 1 for color intensity
 */
function getHeatmapIntensity(change: number | null): number {
  if (change === null) return 0.1;
  const absChange = Math.abs(change);
  // Cap at 20% for full intensity
  return Math.min(absChange / 20, 1);
}

/**
 * Get heatmap background color based on change
 */
function getHeatmapColor(change: number | null): string {
  if (change === null) return 'rgba(100, 100, 100, 0.1)';
  const intensity = getHeatmapIntensity(change);
  if (change >= 0) {
    return `rgba(34, 197, 94, ${intensity * 0.6})`;
  }
  return `rgba(239, 68, 68, ${intensity * 0.6})`;
}

export function AltcoinGrid({
  altcoins,
  baseCurrency,
  onBaseCurrencyChange,
  basePrice,
  isLoading = false,
}: AltcoinGridProps) {
  // Local state for filtering and sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<ScreenerSortBy>('performance');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showFilters, setShowFilters] = useState(false);

  // Memoize volume thresholds separately to avoid recalculating on every filter change
  // This is O(n log n) so we only want to do it when altcoins array changes
  const volumeThresholds = useMemo(() => {
    if (altcoins.length === 0) return { highVolume: 0, lowCap: Infinity };

    const volumes = altcoins.map((a) => a.volume24h || 0);
    const sortedDesc = [...volumes].sort((a, b) => b - a);
    const sortedAsc = [...volumes].sort((a, b) => a - b);

    return {
      // Top 20% by volume
      highVolume: sortedDesc[Math.floor(altcoins.length * 0.2)] || 0,
      // Bottom 50% by volume
      lowCap: sortedAsc[Math.floor(altcoins.length * 0.5)] || Infinity,
    };
  }, [altcoins]);

  // Filter and sort altcoins
  const filteredAltcoins = useMemo(() => {
    let result = [...altcoins];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (a) => a.symbol.toLowerCase().includes(query) || a.base.toLowerCase().includes(query)
      );
    }

    // Apply quick filters (using pre-computed thresholds)
    switch (quickFilter) {
      case 'gainers':
        result = result.filter((a) => (a.change24h || 0) > 0);
        break;
      case 'losers':
        result = result.filter((a) => (a.change24h || 0) < 0);
        break;
      case 'high_volume':
        result = result.filter((a) => (a.volume24h || 0) >= volumeThresholds.highVolume);
        break;
      case 'low_cap':
        result = result.filter((a) => (a.volume24h || 0) <= volumeThresholds.lowCap);
        break;
    }

    // Apply sorting
    result.sort((a, b) => {
      let aValue: number | string = 0;
      let bValue: number | string = 0;

      switch (sortBy) {
        case 'performance':
          aValue = a.change24h || 0;
          bValue = b.change24h || 0;
          break;
        case 'volume':
          aValue = a.volume24h || 0;
          bValue = b.volume24h || 0;
          break;
        case 'price':
          aValue = baseCurrency === 'USD' ? a.price : a.priceInBase;
          bValue = baseCurrency === 'USD' ? b.price : b.priceInBase;
          break;
        case 'name':
          aValue = a.symbol;
          bValue = b.symbol;
          break;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }

      return sortOrder === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return result;
  }, [altcoins, searchQuery, quickFilter, sortBy, sortOrder, baseCurrency, volumeThresholds]);

  // Toggle sort order
  const toggleSortOrder = useCallback(() => {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  // Handle sort change
  const handleSortChange = useCallback((newSortBy: ScreenerSortBy) => {
    setSortBy(newSortBy);
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setQuickFilter('all');
  }, []);

  return (
    <div className="space-y-4">
      {/* Controls Row */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        {/* Left side: Base currency selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Compare vs:</span>
          <div className="flex gap-1 p-1 bg-muted/30 rounded-lg">
            {BASE_CURRENCY_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={baseCurrency === option.value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => onBaseCurrencyChange(option.value)}
                className={`px-3 ${
                  baseCurrency === option.value
                    ? 'shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {baseCurrency !== 'USD' && (
            <span className="text-xs text-muted-foreground ml-2">
              1 {baseCurrency} = {formatCurrency(basePrice)}
            </span>
          )}
        </div>

        {/* Right side: View mode and filters toggle */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted/30 rounded-lg">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="px-2"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="px-2"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'heatmap' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('heatmap')}
              className="px-2"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Card className="glass border-white/5">
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-4 items-end">
                  {/* Search */}
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs text-muted-foreground mb-1 block">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by symbol..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>

                  {/* Sort By */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Sort By</label>
                    <div className="flex gap-1">
                      <select
                        value={sortBy}
                        onChange={(e) => handleSortChange(e.target.value as ScreenerSortBy)}
                        className="bg-muted/50 border border-white/10 rounded-lg px-3 py-2 text-sm"
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={toggleSortOrder}
                        className="h-9 w-9"
                      >
                        {sortOrder === 'desc' ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronUp className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Quick Filters */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Quick Filter</label>
                    <div className="flex gap-1">
                      <Button
                        variant={quickFilter === 'all' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setQuickFilter('all')}
                      >
                        All
                      </Button>
                      <Button
                        variant={quickFilter === 'gainers' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setQuickFilter('gainers')}
                        className={quickFilter === 'gainers' ? '' : 'text-green-500'}
                      >
                        <TrendingUp className="h-3 w-3 mr-1" />
                        Gainers
                      </Button>
                      <Button
                        variant={quickFilter === 'losers' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setQuickFilter('losers')}
                        className={quickFilter === 'losers' ? '' : 'text-red-500'}
                      >
                        <TrendingDown className="h-3 w-3 mr-1" />
                        Losers
                      </Button>
                      <Button
                        variant={quickFilter === 'high_volume' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setQuickFilter('high_volume')}
                      >
                        High Vol
                      </Button>
                    </div>
                  </div>

                  {/* Clear Filters */}
                  {(searchQuery || quickFilter !== 'all') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="text-muted-foreground"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results Count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {filteredAltcoins.length} of {altcoins.length} altcoins
        </span>
        {quickFilter !== 'all' && (
          <Badge variant="secondary" className="text-xs">
            {quickFilter === 'gainers' && 'Gainers only'}
            {quickFilter === 'losers' && 'Losers only'}
            {quickFilter === 'high_volume' && 'High volume'}
            {quickFilter === 'low_cap' && 'Low cap'}
          </Badge>
        )}
      </div>

      {/* Grid/List/Heatmap View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          <AnimatePresence mode="popLayout">
            {filteredAltcoins.map((altcoin, index) => (
              <motion.div
                key={altcoin.symbol}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{
                  duration: ANIMATION_CONFIG.grid.duration,
                  delay: Math.min(
                    index * ANIMATION_CONFIG.grid.delay,
                    ANIMATION_CONFIG.grid.maxDelay
                  ),
                }}
              >
                <AltcoinCardMemo altcoin={altcoin} baseCurrency={baseCurrency} rank={index + 1} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {viewMode === 'list' && (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {filteredAltcoins.map((altcoin, index) => (
              <motion.div
                key={altcoin.symbol}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{
                  duration: ANIMATION_CONFIG.list.duration,
                  delay: Math.min(
                    index * ANIMATION_CONFIG.list.delay,
                    ANIMATION_CONFIG.list.maxDelay
                  ),
                }}
              >
                <AltcoinListItemMemo
                  altcoin={altcoin}
                  baseCurrency={baseCurrency}
                  rank={index + 1}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {viewMode === 'heatmap' && (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-1">
          {/* Heatmap uses simple divs without AnimatePresence for maximum performance */}
          {filteredAltcoins.map((altcoin) => (
            <HeatmapCellMemo key={altcoin.symbol} altcoin={altcoin} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {filteredAltcoins.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No altcoins found matching your criteria</p>
          <Button variant="link" onClick={clearFilters} className="mt-2">
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * AltcoinCard - Individual altcoin card for grid view
 */
interface AltcoinCardProps {
  altcoin: AltcoinPerformance;
  baseCurrency: BaseCurrency;
  rank: number;
}

function AltcoinCard({ altcoin, baseCurrency, rank }: AltcoinCardProps) {
  const displayPrice = baseCurrency === 'USD' ? altcoin.price : altcoin.priceInBase;
  const priceLabel =
    baseCurrency === 'USD'
      ? formatCurrency(displayPrice)
      : `${displayPrice.toFixed(8)} ${baseCurrency}`;

  return (
    <Card className="glass border-white/5 hover:border-primary/30 transition-all duration-200 overflow-hidden group">
      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground/50 font-mono">#{rank}</span>
              <span className="font-bold">{altcoin.base}</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono">{priceLabel}</div>
          </div>
          <Badge
            variant="secondary"
            className={`text-xs ${getChangeColor(altcoin.change24h)} ${
              (altcoin.change24h || 0) >= 0
                ? 'bg-green-500/10 border-green-500/20'
                : 'bg-red-500/10 border-red-500/20'
            }`}
          >
            {formatPercentage(altcoin.change24h)}
          </Badge>
        </div>

        {/* Mini Chart */}
        <div className="mb-2">
          <AltcoinMiniChart data={altcoin.ohlcv} change={altcoin.change24h} height={50} />
        </div>

        {/* Footer */}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Vol: {formatVolume(altcoin.volume24h)}</span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            {altcoin.symbol}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * AltcoinListItem - Individual altcoin row for list view
 */
function AltcoinListItem({ altcoin, baseCurrency, rank }: AltcoinCardProps) {
  const displayPrice = baseCurrency === 'USD' ? altcoin.price : altcoin.priceInBase;
  const priceLabel =
    baseCurrency === 'USD'
      ? formatCurrency(displayPrice)
      : `${displayPrice.toFixed(8)} ${baseCurrency}`;

  return (
    <Card className="glass border-white/5 hover:border-primary/30 transition-all duration-200">
      <CardContent className="p-3">
        <div className="flex items-center gap-4">
          {/* Rank */}
          <span className="text-sm text-muted-foreground/50 font-mono w-8">#{rank}</span>

          {/* Symbol & Price */}
          <div className="flex-1 min-w-0">
            <div className="font-bold">{altcoin.base}</div>
            <div className="text-xs text-muted-foreground">{altcoin.symbol}</div>
          </div>

          {/* Mini Chart */}
          <div className="w-24 hidden sm:block">
            <AltcoinMiniChart data={altcoin.ohlcv} change={altcoin.change24h} height={30} />
          </div>

          {/* Price */}
          <div className="text-right min-w-[100px]">
            <div className="font-mono text-sm">{priceLabel}</div>
          </div>

          {/* Volume */}
          <div className="text-right min-w-[80px] hidden md:block">
            <div className="text-xs text-muted-foreground">Volume</div>
            <div className="font-mono text-sm">{formatVolume(altcoin.volume24h)}</div>
          </div>

          {/* Change */}
          <div className="text-right min-w-[80px]">
            <Badge
              variant="secondary"
              className={`text-xs ${getChangeColor(altcoin.change24h)} ${
                (altcoin.change24h || 0) >= 0
                  ? 'bg-green-500/10 border-green-500/20'
                  : 'bg-red-500/10 border-red-500/20'
              }`}
            >
              {formatPercentage(altcoin.change24h)}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * HeatmapCell - Compact cell for heatmap view
 */
function HeatmapCell({ altcoin }: { altcoin: AltcoinPerformance }) {
  return (
    <div
      className="aspect-square rounded flex flex-col items-center justify-center p-1 cursor-pointer transition-transform hover:scale-105"
      style={{ backgroundColor: getHeatmapColor(altcoin.change24h) }}
      title={`${altcoin.base}: ${formatPercentage(altcoin.change24h)}`}
    >
      <span className="text-[10px] font-bold truncate w-full text-center">{altcoin.base}</span>
      <span className={`text-[9px] ${getChangeColor(altcoin.change24h)}`}>
        {altcoin.change24h !== null
          ? `${altcoin.change24h >= 0 ? '+' : ''}${altcoin.change24h.toFixed(1)}%`
          : 'N/A'}
      </span>
    </div>
  );
}

/**
 * Memoized components to prevent unnecessary re-renders
 * These only re-render when their specific props change
 */
const AltcoinCardMemo = memo(AltcoinCard, (prev, next) => {
  return (
    prev.altcoin.symbol === next.altcoin.symbol &&
    prev.altcoin.price === next.altcoin.price &&
    prev.altcoin.change24h === next.altcoin.change24h &&
    prev.baseCurrency === next.baseCurrency &&
    prev.rank === next.rank
  );
});

const AltcoinListItemMemo = memo(AltcoinListItem, (prev, next) => {
  return (
    prev.altcoin.symbol === next.altcoin.symbol &&
    prev.altcoin.price === next.altcoin.price &&
    prev.altcoin.change24h === next.altcoin.change24h &&
    prev.baseCurrency === next.baseCurrency &&
    prev.rank === next.rank
  );
});

const HeatmapCellMemo = memo(HeatmapCell, (prev, next) => {
  return (
    prev.altcoin.symbol === next.altcoin.symbol && prev.altcoin.change24h === next.altcoin.change24h
  );
});
