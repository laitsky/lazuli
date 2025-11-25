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
} from 'lucide-react';
import { Ticker } from '@lazuli/shared';
import { formatCurrency, formatVolume, formatPercentage, getChangeColor } from '@/lib/api-client';

interface TickersTableProps {
  tickers: Ticker[];
  exchange: string;
}

type SortField = 'symbol' | 'price' | 'change' | 'volume';
type SortOrder = 'asc' | 'desc';

export function TickersTable({ tickers, exchange }: TickersTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [quoteFilter, setQuoteFilter] = useState<string>('USDT');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const itemsPerPage = 20;

  // Clear search handler
  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, quoteFilter, marketType, exchange]);

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

  // Filter and sort tickers
  const filteredAndSortedTickers = useMemo(() => {
    let result = tickers.filter((t) => {
      const matchesSearch = t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesQuote = getQuoteCurrency(t.symbol).toUpperCase() === quoteFilter;
      const matchesType = t.type === marketType;
      return matchesSearch && matchesQuote && matchesType;
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
          comparison = (a.percentage24h || 0) - (b.percentage24h || 0);
          break;
        case 'volume':
          comparison = (a.quoteVolume24h || 0) - (b.quoteVolume24h || 0);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [tickers, searchQuery, sortField, sortOrder, quoteFilter, marketType]);

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

          {/* Filters Row */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Market Type Filter - Enhanced */}
            <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMarketType('spot')}
                className={`h-9 px-4 text-xs rounded-lg transition-all ${
                  marketType === 'spot'
                    ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30 shadow-sm'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
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
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('price')}
                    className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                  >
                    Price <SortIcon field="price" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('change')}
                    className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                  >
                    24h Change <SortIcon field="change" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('volume')}
                    className="hover:bg-white/5 hover:text-primary px-2 py-1 font-semibold ml-auto rounded-lg transition-colors"
                  >
                    24h Volume <SortIcon field="volume" />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTickers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-48 text-center">
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
                      <TableCell className="text-right font-mono font-medium text-base py-4">
                        <span className={isHovered ? 'text-primary' : ''}>
                          {formatCurrency(ticker.last)}
                        </span>
                      </TableCell>
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
                      <TableCell className="text-right font-mono text-muted-foreground py-4">
                        <span className="hidden sm:inline">
                          {formatVolume(ticker.quoteVolume24h)}
                        </span>
                        <span className="sm:hidden">
                          {formatCompactNumber(ticker.quoteVolume24h || 0)}
                        </span>
                      </TableCell>
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
