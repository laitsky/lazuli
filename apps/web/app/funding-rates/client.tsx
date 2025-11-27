'use client';

/**
 * Funding Rate Analytics Client Component
 *
 * This client component handles the interactive functionality of the Funding Rate page:
 * - Sorting and filtering funding rate data
 * - Displaying top arbitrage opportunities
 * - Real-time data refresh
 *
 * Educational Purpose:
 * Funding rates help traders understand market sentiment and find arbitrage opportunities.
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
import {
  FundingRateResponse,
  FundingRateData,
  CrossExchangeFundingResponse,
  FundingSentiment,
  SupportedExchange,
} from '@lazuli/shared';
import {
  LazuliAPI,
  formatFundingRate,
  formatAnnualizedRate,
  formatVolume,
  getFundingColor,
} from '@/lib/api-client';
import {
  RefreshCw,
  Search,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  Scale,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface FundingRateClientProps {
  /** Initial funding rate data from server */
  initialData: FundingRateResponse;
  /** Initial cross-exchange data from server (optional) */
  initialCrossExchangeData?: CrossExchangeFundingResponse | null;
  /** Current exchange */
  exchange: SupportedExchange;
}

type SortField = 'symbol' | 'rate' | 'annualized' | 'volume' | 'openInterest';
type SortOrder = 'asc' | 'desc';

/**
 * Get sentiment display info
 */
function getSentimentDisplay(sentiment: FundingSentiment): {
  label: string;
  color: string;
  icon: React.ReactNode;
  description: string;
} {
  switch (sentiment) {
    case 'extremely_bullish':
      return {
        label: 'Extremely Bullish',
        color: 'bg-green-500/20 text-green-400 border-green-500/30',
        icon: <TrendingUp className="h-4 w-4" />,
        description: 'Market heavily leveraged long. Potential correction ahead.',
      };
    case 'bullish':
      return {
        label: 'Bullish',
        color: 'bg-green-500/10 text-green-400 border-green-500/20',
        icon: <TrendingUp className="h-4 w-4" />,
        description: 'More longs than shorts. Longs are paying shorts.',
      };
    case 'neutral':
      return {
        label: 'Neutral',
        color: 'bg-muted text-muted-foreground border-border',
        icon: <Scale className="h-4 w-4" />,
        description: 'Balanced market. No strong directional bias.',
      };
    case 'bearish':
      return {
        label: 'Bearish',
        color: 'bg-red-500/10 text-red-400 border-red-500/20',
        icon: <TrendingDown className="h-4 w-4" />,
        description: 'More shorts than longs. Shorts are paying longs.',
      };
    case 'extremely_bearish':
      return {
        label: 'Extremely Bearish',
        color: 'bg-red-500/20 text-red-400 border-red-500/30',
        icon: <TrendingDown className="h-4 w-4" />,
        description: 'Market heavily leveraged short. Potential squeeze ahead.',
      };
  }
}

/**
 * Funding Rate Table Component
 */
function FundingRateTable({
  data,
  sortField,
  sortOrder,
  onSort,
}: {
  data: FundingRateData[];
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

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border">
            <TableHead className="w-[140px]">
              <SortButton field="symbol">Symbol</SortButton>
            </TableHead>
            <TableHead className="text-right">
              <SortButton field="rate">Funding Rate</SortButton>
            </TableHead>
            <TableHead className="text-right hidden md:table-cell">
              <SortButton field="annualized">Annualized</SortButton>
            </TableHead>
            <TableHead className="text-right hidden lg:table-cell">Mark Price</TableHead>
            <TableHead className="text-right hidden sm:table-cell">
              <SortButton field="volume">24h Volume</SortButton>
            </TableHead>
            <TableHead className="text-right hidden xl:table-cell">
              <SortButton field="openInterest">Open Interest</SortButton>
            </TableHead>
            <TableHead className="text-center w-[100px]">Sentiment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => {
            const isPositive = item.fundingRatePercent > 0;
            const isStrong = Math.abs(item.fundingRatePercent) > 0.01;

            return (
              <TableRow key={item.symbol} className="border-border hover:bg-accent/50">
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span className="font-mono text-sm">{item.baseAsset}</span>
                    <span className="text-xs text-muted-foreground">{item.symbol}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`font-mono font-semibold ${getFundingColor(item.fundingRatePercent)}`}
                  >
                    {formatFundingRate(item.fundingRatePercent)}
                  </span>
                </TableCell>
                <TableCell className="text-right hidden md:table-cell">
                  <span className={`font-mono text-sm ${getFundingColor(item.fundingRatePercent)}`}>
                    {formatAnnualizedRate(item.annualizedRate)}
                  </span>
                </TableCell>
                <TableCell className="text-right hidden lg:table-cell font-mono text-sm">
                  $
                  {item.markPrice?.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }) ?? 'N/A'}
                </TableCell>
                <TableCell className="text-right hidden sm:table-cell font-mono text-sm text-muted-foreground">
                  {formatVolume(item.volume24h)}
                </TableCell>
                <TableCell className="text-right hidden xl:table-cell font-mono text-sm text-muted-foreground">
                  {formatVolume(item.openInterest)}
                </TableCell>
                <TableCell className="text-center">
                  {isPositive ? (
                    <Badge
                      variant="outline"
                      className={`${isStrong ? 'bg-green-500/20 border-green-500/30' : 'bg-green-500/10 border-green-500/20'} text-green-400`}
                    >
                      <TrendingUp className="h-3 w-3 mr-1" />
                      Long Pay
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className={`${isStrong ? 'bg-red-500/20 border-red-500/30' : 'bg-red-500/10 border-red-500/20'} text-red-400`}
                    >
                      <TrendingDown className="h-3 w-3 mr-1" />
                      Short Pay
                    </Badge>
                  )}
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
 * Compact Arbitrage Opportunities Component
 * Shows top 5 arbitrage opportunities in a compact format
 */
function TopArbitrageOpportunities({
  data,
}: {
  data: CrossExchangeFundingResponse['arbitrageOpportunities'];
}) {
  if (!data || data.length === 0) {
    return null;
  }

  // Show only top 5
  const topOpportunities = data.slice(0, 5);

  return (
    <Card className="glass border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Top Arbitrage Opportunities
        </CardTitle>
        <CardDescription className="text-xs">
          Cross-exchange funding rate spreads. Long on low-funding, short on high-funding exchange.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {topOpportunities.map((opp, index) => (
            <div
              key={opp.asset}
              className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg font-display font-bold text-primary">#{index + 1}</span>
                <div>
                  <span className="font-mono font-semibold text-sm">{opp.asset}</span>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="text-green-400">{opp.longExchange}</span>
                    <ArrowRight className="h-2 w-2" />
                    <span className="text-red-400">{opp.shortExchange}</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-semibold text-primary">
                  {opp.spread.toFixed(3)}%
                </div>
                <div className="text-[10px] text-green-400">
                  ~{opp.estimatedDailyYield.toFixed(2)}%/d
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function FundingRateClient({
  initialData,
  initialCrossExchangeData,
  exchange,
}: FundingRateClientProps) {
  // State
  const [data, setData] = useState<FundingRateResponse>(initialData);
  const [crossExchangeData, setCrossExchangeData] = useState<CrossExchangeFundingResponse | null>(
    initialCrossExchangeData ?? null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('rate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Set initial timestamp on mount
  useEffect(() => {
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = data.fundingRates;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.symbol.toLowerCase().includes(query) ||
          item.baseAsset.toLowerCase().includes(query)
      );
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortField) {
        case 'symbol':
          return sortOrder === 'asc'
            ? a.baseAsset.localeCompare(b.baseAsset)
            : b.baseAsset.localeCompare(a.baseAsset);
        case 'rate':
          aValue = Math.abs(a.fundingRatePercent);
          bValue = Math.abs(b.fundingRatePercent);
          break;
        case 'annualized':
          aValue = Math.abs(a.annualizedRate);
          bValue = Math.abs(b.annualizedRate);
          break;
        case 'volume':
          aValue = a.volume24h ?? 0;
          bValue = b.volume24h ?? 0;
          break;
        case 'openInterest':
          aValue = a.openInterest ?? 0;
          bValue = b.openInterest ?? 0;
          break;
        default:
          aValue = Math.abs(a.fundingRatePercent);
          bValue = Math.abs(b.fundingRatePercent);
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return sorted;
  }, [data.fundingRates, searchQuery, sortField, sortOrder]);

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
      const [fundingResponse, crossResponse] = await Promise.all([
        LazuliAPI.getFundingRates(exchange, { limit: 200 }),
        LazuliAPI.getCrossExchangeFunding({ limit: 50 }),
      ]);

      if (fundingResponse.success && fundingResponse.data) {
        setData(fundingResponse.data);
      }
      if (crossResponse.success && crossResponse.data) {
        setCrossExchangeData(crossResponse.data);
      }

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Error refreshing funding data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [exchange]);

  const sentimentInfo = getSentimentDisplay(data.stats?.marketSentiment ?? 'neutral');

  return (
    <div className="space-y-6">
      {/* Market Sentiment Banner */}
      <Card className={`glass border ${sentimentInfo.color}`}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {sentimentInfo.icon}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold">{sentimentInfo.label}</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    Avg: {formatFundingRate(data.stats?.avgFundingPercent ?? null)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{sentimentInfo.description}</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-green-400 font-semibold">
                  {data.stats?.positiveCount ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">Positive</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground font-semibold">
                  {data.stats?.neutralCount ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">Neutral</div>
              </div>
              <div className="text-center">
                <div className="text-red-400 font-semibold">{data.stats?.negativeCount ?? 0}</div>
                <div className="text-xs text-muted-foreground">Negative</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top Arbitrage Opportunities (Compact) */}
      {crossExchangeData && (
        <TopArbitrageOpportunities data={crossExchangeData.arbitrageOpportunities} />
      )}

      {/* Search and Refresh Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-muted-foreground">
          Last updated: {lastUpdated ?? 'Loading...'} • {data.count} perpetual contracts
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[200px] bg-background"
            />
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

      {/* Funding Rate Table */}
      <FundingRateTable
        data={filteredAndSortedData}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
      />
    </div>
  );
}
