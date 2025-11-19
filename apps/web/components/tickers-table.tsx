'use client';

import { useState, useMemo, useEffect } from 'react';
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
  const itemsPerPage = 20;

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
    <Card className="glass border-white/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
      <CardHeader className="border-b border-white/5 bg-white/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <BarChart3 className="h-5 w-5 text-primary" />
            Market Data
            <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/20">
              {filteredAndSortedTickers.length} Pairs
            </Badge>
          </CardTitle>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Market Type Filter */}
            <div className="flex gap-1">
              <Button
                variant={marketType === 'spot' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setMarketType('spot')}
                className={`h-8 px-3 text-xs ${marketType === 'spot' ? 'bg-primary text-primary-foreground' : 'hover:bg-white/5'}`}
              >
                Spot
              </Button>
              <Button
                variant={marketType === 'perp' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setMarketType('perp')}
                className={`h-8 px-3 text-xs ${marketType === 'perp' ? 'bg-primary text-primary-foreground' : 'hover:bg-white/5'}`}
              >
                Perp
              </Button>
            </div>

            {/* Quote Currency Filter */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar max-w-full">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex gap-1">
                {availableQuotes.slice(0, 5).map((quote) => (
                  <Button
                    key={quote}
                    variant={quoteFilter === quote ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setQuoteFilter(quote)}
                    className={`h-8 px-3 text-xs ${quoteFilter === quote ? 'bg-primary text-primary-foreground' : 'hover:bg-white/5'}`}
                  >
                    {quote}
                  </Button>
                ))}
                {availableQuotes.length > 5 && (
                  <select
                    className="h-8 px-2 text-xs bg-transparent border border-white/10 rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-muted-foreground"
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

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-full sm:w-[200px] bg-background/50 border-white/10 focus:border-primary/50 transition-all"
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="hover:bg-transparent border-white/5">
                <TableHead className="w-[200px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('symbol')}
                    className="hover:bg-transparent hover:text-primary p-0 font-semibold"
                  >
                    Symbol <SortIcon field="symbol" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('price')}
                    className="hover:bg-transparent hover:text-primary p-0 font-semibold ml-auto"
                  >
                    Price <SortIcon field="price" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('change')}
                    className="hover:bg-transparent hover:text-primary p-0 font-semibold ml-auto"
                  >
                    24h Change <SortIcon field="change" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('volume')}
                    className="hover:bg-transparent hover:text-primary p-0 font-semibold ml-auto"
                  >
                    24h Volume <SortIcon field="volume" />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTickers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    No tickers found matching your criteria
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTickers.map((ticker) => {
                  const percentage = ticker.percentage24h || 0;
                  const isPositive = percentage >= 0;
                  const changeColor = getChangeColor(percentage);

                  return (
                    <TableRow
                      key={ticker.symbol}
                      className="hover:bg-white/5 border-white/5 transition-colors"
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center text-xs font-bold text-primary border border-white/5">
                            {ticker.symbol.substring(0, 1)}
                          </div>
                          <div>
                            <div className="font-bold text-foreground">{ticker.symbol}</div>
                            <div className="text-xs text-muted-foreground hidden sm:block">
                              {exchange} • {ticker.type === 'spot' ? 'Spot' : 'Perp'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(ticker.last)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={`${changeColor} border-current/20 bg-current/5 font-mono`}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 mr-1" />
                          )}
                          {formatPercentage(percentage)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-4 border-t border-white/5 bg-white/5">
            <div className="text-sm text-muted-foreground hidden sm:block">
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

            <div className="flex items-center gap-2 mx-auto sm:mx-0">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 bg-transparent border-white/10 hover:bg-white/10"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 bg-transparent border-white/10 hover:bg-white/10"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1 mx-2">
                <span className="text-sm font-medium bg-primary/10 text-primary px-2 py-1 rounded-md min-w-[2rem] text-center">
                  {currentPage}
                </span>
                <span className="text-sm text-muted-foreground">/ {totalPages}</span>
              </div>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 bg-transparent border-white/10 hover:bg-white/10"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 bg-transparent border-white/10 hover:bg-white/10"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
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
