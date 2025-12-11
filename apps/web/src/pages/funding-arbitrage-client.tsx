/**
 * Arbitrage Client Component - Revamped Pro Version
 *
 * Interactive component for displaying and analyzing funding rate arbitrage opportunities.
 * Shows the same asset across multiple exchanges in a single row for easy comparison.
 *
 * Key Features:
 * - Multi-exchange comparison per asset row
 * - Delta column showing recommended long/short positions with rates
 * - Annualized yield calculation (APY)
 * - Auto-refresh every 10 seconds
 * - Sorting, filtering, and search
 */

import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrossExchangeFundingResponse, CrossExchangeFunding } from '@lazuli/shared';
import { LazuliAPI, formatFundingRate } from '@/lib/api-client';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import {
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Timer,
  Pause,
  Play,
  Info,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

interface ArbitrageClientProps {
  initialData: CrossExchangeFundingResponse;
}

type SortField = 'asset' | 'spread' | 'apy' | 'exchanges';
type SortOrder = 'asc' | 'desc';

/**
 * Exchange display configuration
 * Order matters - this is the column order in the table
 */
const EXCHANGE_CONFIG: Record<string, { name: string; color: string; shortName: string }> = {
  binance: {
    name: 'Binance',
    shortName: 'BIN',
    color: 'text-yellow-400',
  },
  bybit: {
    name: 'Bybit',
    shortName: 'BYB',
    color: 'text-orange-400',
  },
  okx: {
    name: 'OKX',
    shortName: 'OKX',
    color: 'text-blue-400',
  },
  hyperliquid: {
    name: 'Hyperliquid',
    shortName: 'HL',
    color: 'text-green-400',
  },
};

const EXCHANGE_ORDER = ['binance', 'bybit', 'okx', 'hyperliquid'];

/**
 * Auto-refresh interval in milliseconds (10 seconds)
 */
const AUTO_REFRESH_INTERVAL = 10000;

/**
 * Format funding rate with color coding
 */
function FundingRateDisplay({
  rate,
  isHighest,
  isLowest,
}: {
  rate: number | null;
  isHighest?: boolean;
  isLowest?: boolean;
}) {
  if (rate === null || rate === undefined) {
    return <span className="text-muted-foreground/50 text-xs">—</span>;
  }

  const isPositive = rate > 0;
  const isNegative = rate < 0;

  // Determine styling based on position
  let bgClass = '';
  let textClass = isPositive
    ? 'text-green-400'
    : isNegative
      ? 'text-red-400'
      : 'text-muted-foreground';

  if (isHighest) {
    bgClass = 'bg-red-500/10 border border-red-500/30 rounded px-1.5 py-0.5';
    textClass = 'text-red-400';
  } else if (isLowest) {
    bgClass = 'bg-green-500/10 border border-green-500/30 rounded px-1.5 py-0.5';
    textClass = 'text-green-400';
  }

  return (
    <span className={`font-mono text-sm ${textClass} ${bgClass}`}>{formatFundingRate(rate)}</span>
  );
}

/**
 * Delta Column Component
 * Shows the recommended arbitrage setup: Long Exchange @ rate / Short Exchange @ rate
 */
function DeltaDisplay({ comparison }: { comparison: CrossExchangeFunding }) {
  const { minExchange, maxExchange, rates } = comparison;

  const longRate = rates.find((r) => r.exchange === minExchange);
  const shortRate = rates.find((r) => r.exchange === maxExchange);

  const longExchangeConfig = EXCHANGE_CONFIG[minExchange];
  const shortExchangeConfig = EXCHANGE_CONFIG[maxExchange];

  return (
    <div className="flex flex-col gap-1.5">
      {/* Long Position */}
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="bg-green-500/10 text-green-400 border-green-500/30 text-xs font-medium w-14 justify-center"
        >
          LONG
        </Badge>
        <span className={`font-medium text-sm ${longExchangeConfig?.color || 'text-foreground'}`}>
          {longExchangeConfig?.name || minExchange}
        </span>
        <span className="text-muted-foreground text-xs">@</span>
        <span className="font-mono text-sm text-green-400">
          {longRate ? formatFundingRate(longRate.fundingRatePercent) : 'N/A'}
        </span>
      </div>

      {/* Short Position */}
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="bg-red-500/10 text-red-400 border-red-500/30 text-xs font-medium w-14 justify-center"
        >
          SHORT
        </Badge>
        <span className={`font-medium text-sm ${shortExchangeConfig?.color || 'text-foreground'}`}>
          {shortExchangeConfig?.name || maxExchange}
        </span>
        <span className="text-muted-foreground text-xs">@</span>
        <span className="font-mono text-sm text-red-400">
          {shortRate ? formatFundingRate(shortRate.fundingRatePercent) : 'N/A'}
        </span>
      </div>
    </div>
  );
}

/**
 * APY Display with visual emphasis
 */
function APYDisplay({ dailyYield }: { dailyYield: number }) {
  const apy = dailyYield * 365;

  // Color intensity based on APY
  let colorClass = 'text-muted-foreground';
  let bgClass = '';

  if (apy >= 100) {
    colorClass = 'text-yellow-400';
    bgClass = 'bg-yellow-500/10 border border-yellow-500/30';
  } else if (apy >= 50) {
    colorClass = 'text-green-400';
    bgClass = 'bg-green-500/10 border border-green-500/30';
  } else if (apy >= 20) {
    colorClass = 'text-green-400';
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ${bgClass}`}>
      {apy >= 50 && <Sparkles className="h-3.5 w-3.5 text-yellow-400" />}
      <span className={`font-mono font-bold text-base ${colorClass}`}>{apy.toFixed(1)}%</span>
    </div>
  );
}

/**
 * Main ArbitrageClient Component
 */
export function ArbitrageClient({ initialData }: ArbitrageClientProps) {
  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('apy');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showAllAssets, setShowAllAssets] = useState(false);

  /**
   * Fetch function for cross-exchange funding data
   */
  const fetchArbitrageData = useCallback(async () => {
    return LazuliAPI.getCrossExchangeFunding({ limit: 100 });
  }, []);

  /**
   * Auto-refresh hook with 10-second interval
   */
  const { data, isRefreshing, lastUpdatedString, refresh, pause, resume, isPaused, countdown } =
    useAutoRefresh<CrossExchangeFundingResponse>({
      fetchFn: fetchArbitrageData,
      initialData,
      interval: AUTO_REFRESH_INTERVAL,
      fetchOnMount: false,
    });

  const arbitrageData = data ?? initialData;

  /**
   * Process comparisons to include arbitrage-only or all assets
   */
  const processedComparisons = useMemo(() => {
    let filtered = showAllAssets
      ? arbitrageData.comparisons
      : arbitrageData.comparisons.filter((c) => c.arbitrageOpportunity);

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((c) => c.baseAsset.toLowerCase().includes(query));
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'asset':
          return sortOrder === 'asc'
            ? a.baseAsset.localeCompare(b.baseAsset)
            : b.baseAsset.localeCompare(a.baseAsset);
        case 'spread':
          return sortOrder === 'asc' ? a.spread - b.spread : b.spread - a.spread;
        case 'apy': {
          const apyA = a.spread * 3 * 365;
          const apyB = b.spread * 3 * 365;
          return sortOrder === 'asc' ? apyA - apyB : apyB - apyA;
        }
        case 'exchanges':
          return sortOrder === 'asc'
            ? a.rates.length - b.rates.length
            : b.rates.length - a.rates.length;
        default:
          return b.spread - a.spread;
      }
    });

    return sorted;
  }, [arbitrageData.comparisons, searchQuery, sortField, sortOrder, showAllAssets]);

  /**
   * Handle sort toggle
   */
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField(field);
        setSortOrder('desc');
      }
    },
    [sortField, sortOrder]
  );

  /**
   * Sort button component
   */
  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 -ml-2 font-medium hover:bg-accent"
      onClick={() => handleSort(field)}
    >
      {children}
      {sortField === field ? (
        sortOrder === 'asc' ? (
          <ChevronUp className="ml-1 h-4 w-4" />
        ) : (
          <ChevronDown className="ml-1 h-4 w-4" />
        )
      ) : (
        <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
      )}
    </Button>
  );

  /**
   * Get rate for a specific exchange from comparison
   */
  const getRateForExchange = (comparison: CrossExchangeFunding, exchangeId: string) => {
    return comparison.rates.find((r) => r.exchange === exchangeId);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>Last updated: {lastUpdatedString ?? 'Loading...'}</span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">{processedComparisons.length} results</span>
          {/* Auto-refresh countdown indicator */}
          {!isPaused && (
            <Badge variant="outline" className="gap-1.5 font-mono text-xs">
              <Timer className="h-3 w-3" />
              {countdown}s
            </Badge>
          )}
          {isPaused && (
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <Pause className="h-3 w-3" />
              Paused
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search asset..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[160px] bg-background"
            />
          </div>

          {/* Show All Toggle */}
          <Button
            variant={showAllAssets ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowAllAssets(!showAllAssets)}
            className="gap-2"
          >
            {showAllAssets ? 'Arb Only' : 'Show All'}
          </Button>

          {/* Pause/Resume */}
          <Button
            variant="outline"
            size="sm"
            onClick={isPaused ? resume : pause}
            className="gap-2"
            title={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>

          {/* Manual Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Info Banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div className="text-sm space-y-1">
              <p className="text-primary font-medium">How Funding Rate Arbitrage Works</p>
              <p className="text-muted-foreground">
                <strong className="text-green-400">Long</strong> on the exchange with{' '}
                <strong>lower</strong> funding rate (you pay less or receive more).{' '}
                <strong className="text-red-400">Short</strong> on the exchange with{' '}
                <strong>higher</strong> funding rate. The spread between rates is your profit per
                funding period (8 hours). Stay delta-neutral by matching position sizes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table */}
      {processedComparisons.length > 0 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border bg-muted/30">
                  <TableHead className="w-[60px] text-center">#</TableHead>
                  <TableHead className="w-[90px]">
                    <SortButton field="asset">Asset</SortButton>
                  </TableHead>

                  {/* Exchange Rate Columns */}
                  {EXCHANGE_ORDER.map((exchangeId) => {
                    const config = EXCHANGE_CONFIG[exchangeId];
                    return (
                      <TableHead
                        key={exchangeId}
                        className="text-center w-[100px]"
                        title={`${config.name} Funding Rate`}
                      >
                        <span className={`font-medium ${config.color}`}>{config.shortName}</span>
                      </TableHead>
                    );
                  })}

                  {/* Delta Column */}
                  <TableHead className="text-left min-w-[200px]">
                    <div className="flex items-center gap-1">
                      <ArrowRight className="h-4 w-4" />
                      Delta (Trade Setup)
                    </div>
                  </TableHead>

                  {/* Spread */}
                  <TableHead className="text-right w-[100px]">
                    <SortButton field="spread">Spread</SortButton>
                  </TableHead>

                  {/* APY */}
                  <TableHead className="text-right w-[120px]">
                    <SortButton field="apy">APY</SortButton>
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {processedComparisons.map((comparison, index) => {
                  const isArbitrage = comparison.arbitrageOpportunity;

                  return (
                    <TableRow
                      key={comparison.baseAsset}
                      className={`border-border transition-colors ${
                        isArbitrage
                          ? 'hover:bg-primary/5 bg-transparent'
                          : 'hover:bg-accent/50 opacity-60'
                      }`}
                    >
                      {/* Rank */}
                      <TableCell className="text-center font-medium text-muted-foreground">
                        {index + 1}
                      </TableCell>

                      {/* Asset */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-foreground">
                            {comparison.baseAsset}
                          </span>
                          {isArbitrage && <TrendingUp className="h-3.5 w-3.5 text-green-400" />}
                        </div>
                      </TableCell>

                      {/* Exchange Rates */}
                      {EXCHANGE_ORDER.map((exchangeId) => {
                        const rate = getRateForExchange(comparison, exchangeId);
                        const isHighest = rate && exchangeId === comparison.maxExchange;
                        const isLowest = rate && exchangeId === comparison.minExchange;

                        return (
                          <TableCell key={exchangeId} className="text-center">
                            <FundingRateDisplay
                              rate={rate?.fundingRatePercent ?? null}
                              isHighest={isHighest}
                              isLowest={isLowest}
                            />
                          </TableCell>
                        );
                      })}

                      {/* Delta Column */}
                      <TableCell>
                        {isArbitrage ? (
                          <DeltaDisplay comparison={comparison} />
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            Spread too small (&lt;0.02%)
                          </span>
                        )}
                      </TableCell>

                      {/* Spread */}
                      <TableCell className="text-right">
                        <span
                          className={`font-mono font-semibold ${
                            isArbitrage ? 'text-primary' : 'text-muted-foreground'
                          }`}
                        >
                          {comparison.spread.toFixed(4)}%
                        </span>
                      </TableCell>

                      {/* APY */}
                      <TableCell className="text-right">
                        <APYDisplay dailyYield={comparison.spread * 3} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        /* Empty State */
        <Card className="border-border">
          <CardContent className="py-12 text-center">
            <TrendingDown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchQuery
                ? `No arbitrage opportunities found for "${searchQuery}"`
                : 'No arbitrage opportunities found at this time'}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-2">
              Markets are currently well-aligned across exchanges.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground pt-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30" />
          <span>Lowest rate (Long here)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-red-500/20 border border-red-500/30" />
          <span>Highest rate (Short here)</span>
        </div>
        <div className="flex items-center gap-2">
          <span>APY = Spread × 3 × 365</span>
        </div>
      </div>
    </div>
  );
}
