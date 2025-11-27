'use client';

/**
 * TickersTable - Advanced data table for displaying cryptocurrency tickers
 * Features:
 * - Sortable columns with visual indicators
 * - Market type filtering (Spot/Perp)
 * - Quote currency filtering with smart ordering
 * - Search functionality with debouncing
 * - Paginated results with smooth transitions
 * - Interactive row hover states
 * - Responsive design with mobile-optimized formatting
 * - 24h High/Low range with visual indicator
 * - Funding rate display for perpetual markets
 * - Open interest for perpetual markets
 * - Bid-ask spread indicator for liquidity
 * - Quick filter presets (Top Gainers, Top Losers, High Volume)
 * - Data freshness indicator
 * - Customizable column visibility
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpDown,
  Search,
  TrendingUp,
  TrendingDown,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  X,
  Sparkles,
  Settings2,
  Percent,
  Check,
  Flame,
  Zap,
  Clock,
  Activity,
} from 'lucide-react';
import { Ticker } from '@lazuli/shared';
import { formatCurrency, formatVolume, formatPercentage, getChangeColor } from '@/lib/api-client';

interface TickersTableProps {
  tickers: Ticker[];
  exchange: string;
}

type SortField = 'symbol' | 'price' | 'change' | 'volume' | 'high' | 'low' | 'funding' | 'spread' | 'openInterest';
type SortOrder = 'asc' | 'desc';
type QuickFilter = 'none' | 'gainers' | 'losers' | 'volume' | 'volatile';

// Column visibility configuration
interface ColumnVisibility {
  price: boolean;
  change: boolean;
  volume: boolean;
  highLow: boolean;
  spread: boolean;
  funding: boolean; // Only relevant for perpetuals
  openInterest: boolean; // Only relevant for perpetuals
}

const DEFAULT_COLUMNS: ColumnVisibility = {
  price: true,
  change: true,
  volume: true,
  highLow: true,
  spread: false, // Hidden by default, can be enabled
  funding: true,
  openInterest: false, // Hidden by default, can be enabled
};

export function TickersTable({ tickers, exchange }: TickersTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  // Default quote filter: USDC for Hyperliquid, USDT for others
  const [quoteFilter, setQuoteFilter] = useState<string>(
    exchange === 'hyperliquid' ? 'USDC' : 'USDT'
  );
  // Default market type: perp for Hyperliquid (no spot), spot for others
  const [marketType, setMarketType] = useState<'spot' | 'perp'>(
    exchange === 'hyperliquid' ? 'perp' : 'spot'
  );
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnVisibility>(DEFAULT_COLUMNS);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('none');
  const itemsPerPage = 20;

  // Calculate data freshness (most recent timestamp from tickers)
  const dataFreshness = useMemo(() => {
    const timestamps = tickers.map((t) => t.timestamp).filter(Boolean);
    if (timestamps.length === 0) return null;
    const mostRecent = Math.max(...timestamps);
    const ageMs = Date.now() - mostRecent;
    const ageSec = Math.floor(ageMs / 1000);
    if (ageSec < 60) return `${ageSec}s ago`;
    const ageMin = Math.floor(ageSec / 60);
    if (ageMin < 60) return `${ageMin}m ago`;
    return `${Math.floor(ageMin / 60)}h ago`;
  }, [tickers]);

  // Check if current exchange is Hyperliquid (perpetual-only)
  const isHyperliquid = exchange === 'hyperliquid';

  // Clear search handler
  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, quoteFilter, marketType, exchange, quickFilter]);

  // Apply quick filter preset
  const applyQuickFilter = (filter: QuickFilter) => {
    if (quickFilter === filter) {
      // Toggle off
      setQuickFilter('none');
      setSortField('volume');
      setSortOrder('desc');
    } else {
      setQuickFilter(filter);
      // Apply sort based on filter type
      switch (filter) {
        case 'gainers':
          setSortField('change');
          setSortOrder('desc');
          break;
        case 'losers':
          setSortField('change');
          setSortOrder('asc');
          break;
        case 'volume':
          setSortField('volume');
          setSortOrder('desc');
          break;
        case 'volatile':
          setSortField('change');
          setSortOrder('desc'); // Will use absolute value in filter
          break;
      }
    }
  };

  // Handle exchange changes - reset to appropriate defaults
  useEffect(() => {
    if (exchange === 'hyperliquid') {
      // Hyperliquid: perpetual-only, USDC quote
      setMarketType('perp');
      setQuoteFilter('USDC');
    } else {
      // Other exchanges: default to spot, USDT quote
      setMarketType('spot');
      setQuoteFilter('USDT');
    }
  }, [exchange]);

  // Extract quote currency from symbol
  const getQuoteCurrency = (symbol: string) => {
    // Handle perpetuals (e.g. BTCUSDT.P -> USDT)
    if (symbol.endsWith('.P')) {
      const baseQuote = symbol.slice(0, -2);
      // Common quotes
      const quotes = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB'];
      for (const quote of quotes) {
        if (baseQuote.endsWith(quote)) return quote;
      }
      return 'USDT'; // Fallback
    }

    // Handle spot (e.g. BTC-USDT -> USDT)
    if (symbol.includes('-')) {
      return symbol.split('-')[1];
    }

    return '';
  };

  // Get available quote currencies with custom ordering (no "ALL" option)
  // Order: USDT, BTC, ETH, USDC, then stablecoins (BUSD, DAI, FDUSD, TUSD), then others alphabetically
  // Only show quotes for the selected market type
  const availableQuotes = useMemo(() => {
    const quotes = new Set<string>();
    tickers.forEach((t) => {
      if (t.type === marketType) {
        const quote = getQuoteCurrency(t.symbol);
        if (quote) quotes.add(quote.toUpperCase());
      }
    });

    // Custom sort order matching multitf and synthetic-pair pages
    const sortedQuotes = Array.from(quotes).sort((a, b) => {
      const priorityOrder = ['USDT', 'BTC', 'ETH', 'USDC'];
      const stablecoins = ['BUSD', 'DAI', 'FDUSD', 'TUSD'];

      const aPriority = priorityOrder.indexOf(a);
      const bPriority = priorityOrder.indexOf(b);

      // Both are in priority list - sort by priority
      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      // Only a is priority - a comes first
      if (aPriority !== -1) return -1;
      // Only b is priority - b comes first
      if (bPriority !== -1) return 1;

      // Check if they're stablecoins
      const aIsStable = stablecoins.includes(a);
      const bIsStable = stablecoins.includes(b);

      // Both are stablecoins - sort alphabetically
      if (aIsStable && bIsStable) return a.localeCompare(b);
      // Only a is stablecoin - a comes first
      if (aIsStable) return -1;
      // Only b is stablecoin - b comes first
      if (bIsStable) return 1;

      // Neither is priority nor stablecoin - sort alphabetically
      return a.localeCompare(b);
    });

    // No "ALL" option - just the sorted quotes
    return sortedQuotes;
  }, [tickers, marketType]);

  // Calculate bid-ask spread percentage
  const getSpread = (ticker: Ticker): number | null => {
    if (!ticker.bid || !ticker.ask || !ticker.last || ticker.last === 0) return null;
    return ((ticker.ask - ticker.bid) / ticker.last) * 100;
  };

  // Filter and sort tickers
  const filteredAndSortedTickers = useMemo(() => {
    let result = tickers.filter((t) => {
      const matchesSearch = t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesQuote = getQuoteCurrency(t.symbol).toUpperCase() === quoteFilter;
      const matchesType = t.type === marketType;

      // Apply quick filter constraints
      let matchesQuickFilter = true;
      if (quickFilter === 'gainers') {
        matchesQuickFilter = (t.percentage24h || 0) > 0;
      } else if (quickFilter === 'losers') {
        matchesQuickFilter = (t.percentage24h || 0) < 0;
      } else if (quickFilter === 'volume') {
        // High volume = top 20% by volume (will be sorted anyway)
        matchesQuickFilter = (t.quoteVolume24h || 0) > 0;
      } else if (quickFilter === 'volatile') {
        // Volatile = absolute change > 3%
        matchesQuickFilter = Math.abs(t.percentage24h || 0) > 3;
      }

      return matchesSearch && matchesQuote && matchesType && matchesQuickFilter;
    });

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol);
          break;
        case 'price':
          comparison = (a.last || 0) - (b.last || 0);
          break;
        case 'change':
          // For volatile filter, sort by absolute value
          if (quickFilter === 'volatile') {
            comparison = Math.abs(a.percentage24h || 0) - Math.abs(b.percentage24h || 0);
          } else {
            comparison = (a.percentage24h || 0) - (b.percentage24h || 0);
          }
          break;
        case 'volume':
          comparison = (a.quoteVolume24h || 0) - (b.quoteVolume24h || 0);
          break;
        case 'high':
          comparison = (a.high24h || 0) - (b.high24h || 0);
          break;
        case 'low':
          comparison = (a.low24h || 0) - (b.low24h || 0);
          break;
        case 'funding':
          comparison = (a.fundingRate || 0) - (b.fundingRate || 0);
          break;
        case 'spread':
          comparison = (getSpread(a) || 999) - (getSpread(b) || 999);
          break;
        case 'openInterest':
          comparison = (a.openInterest || 0) - (b.openInterest || 0);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [tickers, searchQuery, sortField, sortOrder, quoteFilter, marketType, quickFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedTickers.length / itemsPerPage);
  const paginatedTickers = filteredAndSortedTickers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-30" />;
    return sortOrder === 'asc' ? (
      <TrendingUp className="ml-2 h-4 w-4 text-primary" />
    ) : (
      <TrendingDown className="ml-2 h-4 w-4 text-primary" />
    );
  };

  // Helper to format large numbers compactly for mobile
  const formatCompactNumber = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(num);
  };

  // Helper to format funding rate as percentage
  const formatFundingRate = (rate: number | null | undefined) => {
    if (rate === null || rate === undefined) return '-';
    // Funding rate is usually a decimal (e.g., 0.0001 = 0.01%)
    const percentage = rate * 100;
    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${percentage.toFixed(4)}%`;
  };

  // Calculate where current price sits within the 24h range (0-100%)
  const getPricePosition = (ticker: Ticker): number => {
    const { last, high24h, low24h } = ticker;
    if (!last || !high24h || !low24h || high24h === low24h) return 50;
    return ((last - low24h) / (high24h - low24h)) * 100;
  };

  // Get color for funding rate (green for negative = longs pay, red for positive = shorts pay)
  const getFundingColor = (rate: number | null | undefined) => {
    if (rate === null || rate === undefined) return 'text-muted-foreground';
    if (rate < -0.0001) return 'text-green-500'; // Negative = bullish (shorts pay longs)
    if (rate > 0.0001) return 'text-red-500'; // Positive = bearish (longs pay shorts)
    return 'text-yellow-500'; // Neutral
  };

  // Format bid-ask spread
  const formatSpread = (spread: number | null): string => {
    if (spread === null) return '-';
    if (spread < 0.01) return '<0.01%';
    return `${spread.toFixed(2)}%`;
  };

  // Get color for spread (lower is better = green, higher = red)
  const getSpreadColor = (spread: number | null): string => {
    if (spread === null) return 'text-muted-foreground';
    if (spread < 0.05) return 'text-green-500'; // Very tight spread
    if (spread < 0.1) return 'text-yellow-500'; // Normal spread
    return 'text-red-500'; // Wide spread
  };

  // Format open interest
  const formatOpenInterest = (oi: number | null | undefined): string => {
    if (oi === null || oi === undefined) return '-';
    return formatVolume(oi);
  };

  // Toggle column visibility
  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumns((prev) => ({ ...prev, [column]: !prev[column] }));
  };

  return (
    <Card className="glass border-white/10 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
      <CardHeader className="border-b border-white/10 bg-gradient-to-r from-white/5 to-transparent">
        <div className="flex flex-col gap-4">
          {/* Title Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="font-display">Market Data</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge
                    variant="outline"
                    className="text-xs bg-primary/10 text-primary border-primary/20 font-mono"
                  >
                    {filteredAndSortedTickers.length} Pairs
                  </Badge>
                  <span className="text-xs text-muted-foreground capitalize">{exchange}</span>
                  {dataFreshness && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {dataFreshness}
                    </span>
                  )}
                </div>
              </div>
            </CardTitle>

            {/* Search Input - Enhanced */}
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 w-full sm:w-[240px] h-11 bg-background/50 border-white/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all"
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/30 flex items-center justify-center transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground flex items-center mr-1">
              <Zap className="h-3 w-3 mr-1" />
              Quick:
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyQuickFilter('gainers')}
              className={`h-7 px-2.5 text-xs rounded-lg transition-all ${
                quickFilter === 'gainers'
                  ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              Gainers
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyQuickFilter('losers')}
              className={`h-7 px-2.5 text-xs rounded-lg transition-all ${
                quickFilter === 'losers'
                  ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <TrendingDown className="h-3 w-3 mr-1" />
              Losers
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyQuickFilter('volume')}
              className={`h-7 px-2.5 text-xs rounded-lg transition-all ${
                quickFilter === 'volume'
                  ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <BarChart3 className="h-3 w-3 mr-1" />
              High Volume
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyQuickFilter('volatile')}
              className={`h-7 px-2.5 text-xs rounded-lg transition-all ${
                quickFilter === 'volatile'
                  ? 'bg-purple-500/20 text-purple-500 hover:bg-purple-500/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <Flame className="h-3 w-3 mr-1" />
              Volatile (&gt;3%)
            </Button>
            {quickFilter !== 'none' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyQuickFilter(quickFilter)}
                className="h-7 px-2 text-xs rounded-lg text-muted-foreground hover:bg-white/5"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Filters Row */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            {/* Market Type Filter - Enhanced */}
            <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMarketType('spot')}
                disabled={isHyperliquid}
                title={isHyperliquid ? 'Hyperliquid only supports perpetual markets' : ''}
                className={`h-9 px-4 text-xs rounded-lg transition-all ${
                  marketType === 'spot'
                    ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30 shadow-sm'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                } ${isHyperliquid ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                Spot
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMarketType('perp')}
                className={`h-9 px-4 text-xs rounded-lg transition-all ${
                  marketType === 'perp'
                    ? 'bg-blue-500/20 text-blue-500 hover:bg-blue-500/30 shadow-sm'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Perpetual
              </Button>
            </div>

            {/* Column Visibility Toggle */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                className="h-9 px-3 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Columns
              </Button>
              {showColumnSettings && (
                <>
                  {/* Backdrop to close on click outside */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowColumnSettings(false)}
                  />
                  {/* Dropdown menu */}
                  <div className="absolute top-full left-0 mt-1 w-48 p-3 bg-background/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <p className="text-xs font-medium text-muted-foreground mb-3">Toggle columns</p>
                    <div className="space-y-1">
                      <button
                        onClick={() => toggleColumn('price')}
                        className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.price ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                          {columns.price && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        Price
                      </button>
                      <button
                        onClick={() => toggleColumn('change')}
                        className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.change ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                          {columns.change && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        24h Change
                      </button>
                      <button
                        onClick={() => toggleColumn('volume')}
                        className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.volume ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                          {columns.volume && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        24h Volume
                      </button>
                      <button
                        onClick={() => toggleColumn('highLow')}
                        className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.highLow ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                          {columns.highLow && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        24h Range
                      </button>
                      <button
                        onClick={() => toggleColumn('spread')}
                        className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.spread ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                          {columns.spread && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        Spread
                      </button>
                      {marketType === 'perp' && (
                        <>
                          <button
                            onClick={() => toggleColumn('funding')}
                            className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                          >
                            <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.funding ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                              {columns.funding && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                            Funding Rate
                          </button>
                          <button
                            onClick={() => toggleColumn('openInterest')}
                            className="flex items-center gap-2 w-full text-sm py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                          >
                            <div className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${columns.openInterest ? 'bg-primary border-primary' : 'border-white/20 bg-white/5'}`}>
                              {columns.openInterest && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                            Open Interest
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Quote Currency Filter - Enhanced */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar flex-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Filter className="h-3.5 w-3.5" />
                <span>Quote:</span>
              </div>
              <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
                {availableQuotes.slice(0, 5).map((quote) => (
                  <Button
                    key={quote}
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuoteFilter(quote)}
                    className={`h-8 px-3 text-xs rounded-lg transition-all ${
                      quoteFilter === quote
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
                    }`}
                  >
                    {quote}
                  </Button>
                ))}
                {availableQuotes.length > 5 && (
                  <select
                    className="h-8 px-3 text-xs bg-transparent border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-muted-foreground cursor-pointer hover:bg-white/10 transition-colors"
                    value={
                      availableQuotes.includes(quoteFilter) &&
                      !availableQuotes.slice(0, 5).includes(quoteFilter)
                        ? quoteFilter
                        : ''
                    }
                    onChange={(e) => setQuoteFilter(e.target.value)}
                  >
                    <option value="" disabled>
                      More...
                    </option>
                    {availableQuotes.slice(5).map((quote) => (
                      <option key={quote} value={quote}>
                        {quote}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5 sticky top-0 z-10">
              <TableRow className="hover:bg-transparent border-white/10">
                <TableHead className="w-[200px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('symbol')}
                    className="hover:bg-white/5 hover:text-primary px-2 py-1 -ml-2 font-semibold rounded-lg transition-colors"
                  >
                    Symbol <SortIcon field="symbol" />
                  </Button>
                </TableHead>
                {columns.price && (
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort('price')}
                      className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                    >
                      Price <SortIcon field="price" />
                    </Button>
                  </TableHead>
                )}
                {columns.change && (
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort('change')}
                      className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                    >
                      24h Change <SortIcon field="change" />
                    </Button>
                  </TableHead>
                )}
                {columns.highLow && (
                  <TableHead className="text-right hidden lg:table-cell">
                    <span className="px-2 py-1 font-semibold text-muted-foreground">
                      24h Range
                    </span>
                  </TableHead>
                )}
                {columns.volume && (
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort('volume')}
                      className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                    >
                      24h Volume <SortIcon field="volume" />
                    </Button>
                  </TableHead>
                )}
                {columns.spread && (
                  <TableHead className="text-right hidden xl:table-cell">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort('spread')}
                      className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                    >
                      Spread <SortIcon field="spread" />
                    </Button>
                  </TableHead>
                )}
                {marketType === 'perp' && columns.funding && (
                  <TableHead className="text-right hidden md:table-cell">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort('funding')}
                      className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                    >
                      Funding <SortIcon field="funding" />
                    </Button>
                  </TableHead>
                )}
                {marketType === 'perp' && columns.openInterest && (
                  <TableHead className="text-right hidden xl:table-cell">
                    <Button
                      variant="ghost"
                      onClick={() => handleSort('openInterest')}
                      className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                    >
                      OI <SortIcon field="openInterest" />
                    </Button>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTickers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center">
                        <Search className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">No tickers found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Try adjusting your search or filters
                        </p>
                      </div>
                      {searchQuery && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={clearSearch}
                          className="mt-2 rounded-lg"
                        >
                          Clear search
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTickers.map((ticker, index) => {
                  const percentage = ticker.percentage24h || 0;
                  const isPositive = percentage >= 0;
                  const changeColor = getChangeColor(percentage);
                  const isHovered = hoveredRow === ticker.symbol;
                  const pricePosition = getPricePosition(ticker);

                  return (
                    <TableRow
                      key={ticker.symbol}
                      className={`border-white/5 transition-all duration-200 cursor-pointer ${
                        isHovered ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                      onMouseEnter={() => setHoveredRow(ticker.symbol)}
                      onMouseLeave={() => setHoveredRow(null)}
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      <TableCell className="font-medium py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center text-sm font-bold text-primary border border-white/10 transition-all duration-200 ${
                              isHovered ? 'scale-110 shadow-lg shadow-primary/20' : ''
                            }`}
                          >
                            {ticker.symbol.substring(0, 1)}
                          </div>
                          <div>
                            <div className="font-bold text-foreground flex items-center gap-2">
                              {ticker.symbol}
                              {isHovered && (
                                <ArrowUpRight className="h-3.5 w-3.5 text-primary animate-in fade-in slide-in-from-left-1 duration-200" />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-1.5 mt-0.5">
                              <span className="capitalize">{exchange}</span>
                              <span className="text-white/20">•</span>
                              <span
                                className={
                                  ticker.type === 'spot' ? 'text-green-500' : 'text-blue-500'
                                }
                              >
                                {ticker.type === 'spot' ? 'Spot' : 'Perp'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      {columns.price && (
                        <TableCell className="text-right font-mono font-medium text-base py-4">
                          <span className={isHovered ? 'text-primary' : ''}>
                            {formatCurrency(ticker.last)}
                          </span>
                        </TableCell>
                      )}
                      {columns.change && (
                        <TableCell className="text-right py-4">
                          <Badge
                            variant="outline"
                            className={`${changeColor} border-current/20 bg-current/10 font-mono px-2.5 py-1 transition-all ${
                              isHovered ? 'scale-105' : ''
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpRight className="h-3 w-3 mr-1" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3 mr-1" />
                            )}
                            {formatPercentage(percentage)}
                          </Badge>
                        </TableCell>
                      )}
                      {columns.highLow && (
                        <TableCell className="text-right py-4 hidden lg:table-cell">
                          <div className="flex flex-col items-end gap-1.5">
                            {/* Price range text */}
                            <div className="flex items-center gap-2 text-xs font-mono">
                              <span className="text-red-400">{formatCurrency(ticker.low24h)}</span>
                              <span className="text-muted-foreground">-</span>
                              <span className="text-green-400">{formatCurrency(ticker.high24h)}</span>
                            </div>
                            {/* Visual range indicator */}
                            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                              {/* Gradient background showing the range */}
                              <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 via-yellow-500/30 to-green-500/30" />
                              {/* Current price position indicator */}
                              <div
                                className="absolute top-0 h-full w-1.5 bg-primary rounded-full shadow-[0_0_6px_rgba(59,130,246,0.8)] transition-all"
                                style={{ left: `calc(${Math.min(100, Math.max(0, pricePosition))}% - 3px)` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                      )}
                      {columns.volume && (
                        <TableCell className="text-right font-mono text-muted-foreground py-4">
                          <span className="hidden sm:inline">
                            {formatVolume(ticker.quoteVolume24h)}
                          </span>
                          <span className="sm:hidden">
                            {formatCompactNumber(ticker.quoteVolume24h || 0)}
                          </span>
                        </TableCell>
                      )}
                      {columns.spread && (
                        <TableCell className="text-right py-4 hidden xl:table-cell">
                          <span className={`font-mono text-sm ${getSpreadColor(getSpread(ticker))}`}>
                            {formatSpread(getSpread(ticker))}
                          </span>
                        </TableCell>
                      )}
                      {marketType === 'perp' && columns.funding && (
                        <TableCell className="text-right py-4 hidden md:table-cell">
                          <div className="flex items-center justify-end gap-1.5">
                            <Percent className="h-3 w-3 text-muted-foreground" />
                            <span className={`font-mono text-sm ${getFundingColor(ticker.fundingRate)}`}>
                              {formatFundingRate(ticker.fundingRate)}
                            </span>
                          </div>
                        </TableCell>
                      )}
                      {marketType === 'perp' && columns.openInterest && (
                        <TableCell className="text-right py-4 hidden xl:table-cell">
                          <div className="flex items-center justify-end gap-1.5">
                            <Activity className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono text-sm text-muted-foreground">
                              {formatOpenInterest(ticker.openInterest)}
                            </span>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination - Enhanced */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-5 border-t border-white/10 bg-gradient-to-r from-white/5 to-transparent">
            <div className="text-sm text-muted-foreground">
              Showing{' '}
              <span className="font-medium text-foreground">
                {(currentPage - 1) * itemsPerPage + 1}
              </span>{' '}
              to{' '}
              <span className="font-medium text-foreground">
                {Math.min(currentPage * itemsPerPage, filteredAndSortedTickers.length)}
              </span>{' '}
              of{' '}
              <span className="font-medium text-foreground">{filteredAndSortedTickers.length}</span>{' '}
              results
            </div>

            <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-xl">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg hover:bg-white/10 disabled:opacity-30"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                aria-label="Go to first page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg hover:bg-white/10 disabled:opacity-30"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Go to previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-2 px-3">
                <span className="text-sm font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg min-w-[2.5rem] text-center shadow-sm">
                  {currentPage}
                </span>
                <span className="text-sm text-muted-foreground">/</span>
                <span className="text-sm text-muted-foreground font-medium">{totalPages}</span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg hover:bg-white/10 disabled:opacity-30"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Go to next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg hover:bg-white/10 disabled:opacity-30"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                aria-label="Go to last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
