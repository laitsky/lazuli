'use client';

/**
 * Arbitrage Client Component
 *
 * Interactive component for displaying and analyzing funding rate arbitrage opportunities.
 * Features sorting, filtering, and detailed information for each opportunity.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  RefreshCw,
  Search,
  ArrowUpDown,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Info,
} from 'lucide-react';

interface ArbitrageClientProps {
  initialData: CrossExchangeFundingResponse;
}

type SortField = 'asset' | 'spread' | 'dailyYield' | 'longExchange' | 'shortExchange';
type SortOrder = 'asc' | 'desc';

/**
 * Format exchange name for display
 */
function formatExchangeName(exchange: string): string {
  const names: Record<string, string> = {
    binance: 'Binance',
    bybit: 'Bybit',
    okx: 'OKX',
    hyperliquid: 'Hyperliquid',
  };
  return names[exchange] || exchange;
}

/**
 * Get exchange badge color
 */
function getExchangeColor(exchange: string): string {
  const colors: Record<string, string> = {
    binance: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    bybit: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    okx: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    hyperliquid: 'bg-green-500/20 text-green-400 border-green-500/30',
  };
  return colors[exchange] || 'bg-muted text-muted-foreground border-border';
}

/**
 * ArbitrageOpportunityTable Component
 * Displays all arbitrage opportunities in a sortable table
 */
function ArbitrageOpportunityTable({
  opportunities,
  comparisons,
  sortField,
  sortOrder,
  onSort,
}: {
  opportunities: CrossExchangeFundingResponse['arbitrageOpportunities'];
  comparisons: CrossExchangeFunding[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
}) {
  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 -ml-2 font-medium hover:bg-accent"
      onClick={() => onSort(field)}
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

  // Create a map for quick lookup of comparison data
  const comparisonMap = useMemo(() => {
    const map = new Map<string, CrossExchangeFunding>();
    comparisons.forEach((c) => map.set(c.baseAsset, c));
    return map;
  }, [comparisons]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border">
            <TableHead className="w-[80px]">#</TableHead>
            <TableHead className="w-[100px]">
              <SortButton field="asset">Asset</SortButton>
            </TableHead>
            <TableHead className="text-center">
              <SortButton field="longExchange">Long Exchange</SortButton>
            </TableHead>
            <TableHead className="text-center w-[60px]"></TableHead>
            <TableHead className="text-center">
              <SortButton field="shortExchange">Short Exchange</SortButton>
            </TableHead>
            <TableHead className="text-right">
              <SortButton field="spread">Spread</SortButton>
            </TableHead>
            <TableHead className="text-right">
              <SortButton field="dailyYield">Daily Yield</SortButton>
            </TableHead>
            <TableHead className="text-right hidden lg:table-cell">Annual Yield</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.map((opp, index) => {
            const comparison = comparisonMap.get(opp.asset);
            const longRate = comparison?.rates.find((r) => r.exchange === opp.longExchange);
            const shortRate = comparison?.rates.find((r) => r.exchange === opp.shortExchange);

            return (
              <TableRow key={`${opp.asset}-${index}`} className="border-border hover:bg-accent/50">
                <TableCell className="font-medium text-muted-foreground">#{index + 1}</TableCell>
                <TableCell className="font-mono font-semibold">{opp.asset}</TableCell>
                <TableCell>
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="outline" className={getExchangeColor(opp.longExchange)}>
                      {formatExchangeName(opp.longExchange)}
                    </Badge>
                    <span className="text-xs font-mono text-green-400">
                      {longRate ? formatFundingRate(longRate.fundingRatePercent) : 'N/A'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="outline" className={getExchangeColor(opp.shortExchange)}>
                      {formatExchangeName(opp.shortExchange)}
                    </Badge>
                    <span className="text-xs font-mono text-red-400">
                      {shortRate ? formatFundingRate(shortRate.fundingRatePercent) : 'N/A'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono font-semibold text-primary">
                    {opp.spread.toFixed(4)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono font-semibold text-green-400">
                    {opp.estimatedDailyYield.toFixed(3)}%
                  </span>
                </TableCell>
                <TableCell className="text-right hidden lg:table-cell">
                  <span className="font-mono text-sm text-muted-foreground">
                    {(opp.estimatedDailyYield * 365).toFixed(1)}%
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Detailed Comparison Card Component
 * Shows all exchange rates for a specific asset
 */
function AssetComparisonCard({ comparison }: { comparison: CrossExchangeFunding }) {
  const sortedRates = [...comparison.rates].sort(
    (a, b) => a.fundingRatePercent - b.fundingRatePercent
  );

  return (
    <Card className="glass border-white/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="font-mono text-lg">{comparison.baseAsset}</CardTitle>
          <Badge
            variant="outline"
            className={
              comparison.arbitrageOpportunity
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : 'bg-muted text-muted-foreground'
            }
          >
            Spread: {comparison.spread.toFixed(4)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sortedRates.map((rate, index) => (
            <div
              key={`${rate.exchange}-${index}`}
              className="flex items-center justify-between p-2 rounded-lg bg-background/50"
            >
              <div className="flex items-center gap-2">
                {index === 0 && <TrendingDown className="h-4 w-4 text-green-400" />}
                {index === sortedRates.length - 1 && (
                  <TrendingUp className="h-4 w-4 text-red-400" />
                )}
                {index > 0 && index < sortedRates.length - 1 && (
                  <div className="w-4 h-4" />
                )}
                <Badge variant="outline" className={getExchangeColor(rate.exchange)}>
                  {formatExchangeName(rate.exchange)}
                </Badge>
              </div>
              <div className="text-right">
                <span
                  className={`font-mono font-semibold ${
                    rate.fundingRatePercent > 0
                      ? 'text-green-400'
                      : rate.fundingRatePercent < 0
                        ? 'text-red-400'
                        : 'text-muted-foreground'
                  }`}
                >
                  {formatFundingRate(rate.fundingRatePercent)}
                </span>
                {rate.markPrice && (
                  <p className="text-xs text-muted-foreground">
                    ${rate.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Main ArbitrageClient Component
 */
export function ArbitrageClient({ initialData }: ArbitrageClientProps) {
  const [data, setData] = useState<CrossExchangeFundingResponse>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('spread');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Set initial timestamp on mount
  useEffect(() => {
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  // Filter and sort opportunities
  const filteredAndSortedOpportunities = useMemo(() => {
    let filtered = data.arbitrageOpportunities;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((opp) => opp.asset.toLowerCase().includes(query));
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortField) {
        case 'asset':
          return sortOrder === 'asc'
            ? a.asset.localeCompare(b.asset)
            : b.asset.localeCompare(a.asset);
        case 'spread':
          aValue = a.spread;
          bValue = b.spread;
          break;
        case 'dailyYield':
          aValue = a.estimatedDailyYield;
          bValue = b.estimatedDailyYield;
          break;
        case 'longExchange':
          return sortOrder === 'asc'
            ? a.longExchange.localeCompare(b.longExchange)
            : b.longExchange.localeCompare(a.longExchange);
        case 'shortExchange':
          return sortOrder === 'asc'
            ? a.shortExchange.localeCompare(b.shortExchange)
            : b.shortExchange.localeCompare(a.shortExchange);
        default:
          aValue = a.spread;
          bValue = b.spread;
      }

      return sortOrder === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return sorted;
  }, [data.arbitrageOpportunities, searchQuery, sortField, sortOrder]);

  // Filter comparisons for card view
  const filteredComparisons = useMemo(() => {
    if (!searchQuery) return data.comparisons.filter((c) => c.arbitrageOpportunity);

    const query = searchQuery.toLowerCase();
    return data.comparisons.filter(
      (c) => c.baseAsset.toLowerCase().includes(query) && c.arbitrageOpportunity
    );
  }, [data.comparisons, searchQuery]);

  // Handle sort toggle
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

  // Refresh data
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const response = await LazuliAPI.getCrossExchangeFunding({ limit: 100 });

      if (response.success && response.data) {
        setData(response.data);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (error) {
      console.error('Error refreshing arbitrage data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            Last updated: {lastUpdated ?? 'Loading...'} • {filteredAndSortedOpportunities.length}{' '}
            opportunities
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search asset..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[180px] bg-background"
            />
          </div>
          <div className="flex items-center border rounded-lg overflow-hidden">
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className="rounded-none"
            >
              Table
            </Button>
            <Button
              variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('cards')}
              className="rounded-none"
            >
              Cards
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Info Banner */}
      <Card className="glass border-blue-500/20 bg-blue-500/5">
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-blue-400 font-medium">How to read this table</p>
              <p className="text-muted-foreground mt-1">
                <strong>Long Exchange</strong>: Open a long position here (lower funding, you receive
                payments). <strong>Short Exchange</strong>: Open a short position here (higher
                funding). The <strong>Spread</strong> is your potential profit per funding period.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content based on view mode */}
      {filteredAndSortedOpportunities.length > 0 ? (
        viewMode === 'table' ? (
          <ArbitrageOpportunityTable
            opportunities={filteredAndSortedOpportunities}
            comparisons={data.comparisons}
            sortField={sortField}
            sortOrder={sortOrder}
            onSort={handleSort}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredComparisons.map((comparison) => (
              <AssetComparisonCard key={comparison.baseAsset} comparison={comparison} />
            ))}
          </div>
        )
      ) : (
        /* Empty state */
        <Card className="glass border-white/5">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {searchQuery
                ? `No arbitrage opportunities found for "${searchQuery}"`
                : 'No arbitrage opportunities found'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
