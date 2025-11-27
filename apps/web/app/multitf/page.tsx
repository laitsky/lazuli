'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CandlestickChart } from '@/components/candlestick-chart';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange, Timeframe, Ticker, OHLCV } from '@lazuli/shared';
import { Search, TrendingUp, LayoutGrid, Clock, AlertCircle } from 'lucide-react';

/**
 * Multi-timeframe analysis page
 * Displays candlestick charts for a single ticker across multiple timeframes
 * Timeframes: 1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w
 */
export default function MultiTFPage() {
  // State management
  const [exchanges, setExchanges] = useState<{ id: SupportedExchange; name: string }[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange>('binance');
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [quoteFilter, setQuoteFilter] = useState<string>('USDT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [chartsData, setChartsData] = useState<Record<Timeframe, OHLCV[]>>(
    {} as Record<Timeframe, OHLCV[]>
  );
  const [error, setError] = useState<string | null>(null);

  // Available timeframes to display
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  /**
   * Get appropriate candle limit based on timeframe
   * Longer timeframes need more candles to show meaningful historical data
   *
   * Uses maximum allowed by each exchange's API
   * Binance: 1000, Bybit: 1000, OKX: 300
   */
  const getCandleLimit = (exchange: SupportedExchange): number => {
    const limits: Record<SupportedExchange, number> = {
      binance: 1000,
      bybit: 1000,
      okx: 300,
      hyperliquid: 1000,
    };
    return limits[exchange] || 1000;
  };

  /**
   * Parse symbol using standardized notation
   * - Spot: BTC-USDT (hyphen separator)
   * - Perpetual: BTCUSDT.P (.P suffix)
   */
  const parseSymbol = (symbol: string) => {
    // Check if it's a perpetual contract (.P suffix)
    if (symbol.endsWith('.P')) {
      const baseQuote = symbol.slice(0, -2); // Remove .P
      const commonQuotes = [
        'USDT',
        'USDC',
        'BUSD',
        'USD',
        'BTC',
        'ETH',
        'BNB',
        'TUSD',
        'DAI',
        'FDUSD',
      ];

      for (const quote of commonQuotes) {
        if (baseQuote.endsWith(quote)) {
          const base = baseQuote.slice(0, -quote.length);
          return { base, quote, isPerpetual: true };
        }
      }
      return { base: baseQuote, quote: '', isPerpetual: true };
    }

    // Spot market with hyphen separator (BTC-USDT)
    if (symbol.includes('-')) {
      const [base, quote] = symbol.split('-');
      return { base: base || '', quote: quote || '', isPerpetual: false };
    }

    return { base: symbol, quote: '', isPerpetual: false };
  };

  /**
   * Extract quote currency from symbol
   * - BTC-USDT -> USDT
   * - BTCUSDT.P -> USDT
   */
  const getQuoteCurrency = (symbol: string): string => {
    const parsed = parseSymbol(symbol);
    return parsed.quote;
  };

  /**
   * Get icon/logo for currency
   */
  const getCurrencyIcon = (currency: string): string | null => {
    const icons: Record<string, string> = {
      USDT: '₮', // Tether symbol
      BTC: '₿', // Bitcoin symbol
      ETH: 'Ξ', // Ethereum symbol (Greek Xi)
    };
    return icons[currency] || null;
  };

  // Load exchanges on mount
  useEffect(() => {
    async function loadExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success && response.data) {
        const supportedExchanges = response.data
          .filter((ex) => ex.supported)
          .map((ex) => ({ id: ex.id as SupportedExchange, name: ex.name }));
        setExchanges(supportedExchanges);
      }
    }
    loadExchanges();
  }, []);

  // Auto-switch to 'perp' and USDC for Hyperliquid (perpetual-only, USDC quote)
  useEffect(() => {
    if (selectedExchange === 'hyperliquid') {
      if (marketType === 'spot') {
        setMarketType('perp');
      }
      setQuoteFilter('USDC');
      setSelectedSymbol('');
      setChartsData({} as Record<Timeframe, OHLCV[]>);
    }
  }, [selectedExchange]);

  // Load tickers when exchange or market type changes
  // Fetches ALL tickers using pagination (same approach as markets page)
  useEffect(() => {
    async function loadTickers() {
      if (!selectedExchange) return;

      setLoading(true);
      setError(null);

      try {
        const allTickers: Ticker[] = [];
        let currentPage = 1;
        let hasMorePages = true;
        const pageLimit = 500; // Maximum allowed by backend

        // Fetch all pages until no more data
        while (hasMorePages) {
          const response = await LazuliAPI.getTickers(selectedExchange, {
            page: currentPage,
            limit: pageLimit,
            sortBy: 'volume',
            sortOrder: 'desc',
            type: marketType, // Filter by market type on the API side
          });

          if (!response.success || !response.data) {
            // If any page fails, stop and use what we have
            if (currentPage === 1) {
              setError(response.error || 'Failed to load tickers');
            }
            break;
          }

          allTickers.push(...response.data.tickers);

          // Check if there are more pages
          if (response.data.pagination && response.data.pagination.hasNext) {
            currentPage++;
          } else {
            hasMorePages = false;
          }
        }

        // Deduplicate tickers by symbol to prevent React key errors
        const uniqueTickers = Array.from(new Map(allTickers.map((t) => [t.symbol, t])).values());
        setTickers(uniqueTickers);
      } catch (err) {
        setError('Failed to load tickers');
      } finally {
        setLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange, marketType]); // Re-fetch when exchange or market type changes

  /**
   * Get all available quote currencies from tickers
   * Custom ordering: USDT, BTC, ETH, USDC, then other stablecoins, then others
   */
  const availableQuotes = useMemo(() => {
    const quotes = new Set<string>();
    tickers.forEach((ticker) => {
      const quote = getQuoteCurrency(ticker.symbol);
      if (quote) {
        quotes.add(quote.toUpperCase());
      }
    });

    // Custom sort order: USDT, BTC, ETH, USDC, then stablecoins alphabetically, then others alphabetically
    const sortedQuotes = Array.from(quotes).sort((a, b) => {
      const priorityOrder = ['USDT', 'BTC', 'ETH', 'USDC'];
      const stablecoins = ['BUSD', 'DAI', 'FDUSD', 'TUSD'];

      const aPriority = priorityOrder.indexOf(a);
      const bPriority = priorityOrder.indexOf(b);

      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      if (aPriority !== -1) return -1;
      if (bPriority !== -1) return 1;

      const aIsStable = stablecoins.includes(a);
      const bIsStable = stablecoins.includes(b);

      if (aIsStable && bIsStable) return a.localeCompare(b);
      if (aIsStable) return -1;
      if (bIsStable) return 1;

      return a.localeCompare(b);
    });

    return sortedQuotes;
  }, [tickers]);

  // Filter tickers based on search query and quote currency (type filtering is done by API)
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => {
        const matchesSearch =
          !searchQuery || t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
        const tickerQuote = getQuoteCurrency(t.symbol).toUpperCase();
        const matchesQuote = tickerQuote === quoteFilter;
        return matchesSearch && matchesQuote;
      })
      .sort((a, b) => {
        // Priority symbols order: BTC, ETH, SOL, XRP, BNB, DOGE
        const prioritySymbols = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];

        // Extract base currencies from symbols
        const aBase = parseSymbol(a.symbol).base.toUpperCase();
        const bBase = parseSymbol(b.symbol).base.toUpperCase();

        // Get priority indices (-1 if not in priority list)
        const aPriority = prioritySymbols.indexOf(aBase);
        const bPriority = prioritySymbols.indexOf(bBase);

        // Both are priority symbols - sort by priority order
        if (aPriority !== -1 && bPriority !== -1) {
          return aPriority - bPriority;
        }

        // Only a is priority - a comes first
        if (aPriority !== -1) return -1;

        // Only b is priority - b comes first
        if (bPriority !== -1) return 1;

        // Neither is priority - sort alphabetically by symbol
        return a.symbol.localeCompare(b.symbol);
      });
    // Shows ALL available tickers for the selected market type (fetched via pagination)
    // Search and quote currency filter help users find what they need quickly
    // Sorted with priority symbols first (BTC, ETH, SOL, XRP, BNB, DOGE), then alphabetically
  }, [tickers, searchQuery, quoteFilter]);

  // Auto-load charts when a symbol is selected
  useEffect(() => {
    if (selectedSymbol) {
      loadCharts();
    }
  }, [selectedSymbol]);

  /**
   * Load charts data for all timeframes with dynamic limits
   * Each timeframe fetches the optimal number of candles for best visualization
   */
  async function loadCharts() {
    if (!selectedSymbol) {
      setError('Please select a symbol');
      return;
    }

    setLoading(true);
    setError(null);
    setChartsData({} as Record<Timeframe, OHLCV[]>);

    try {
      // Fetch each timeframe individually with its own limit
      // This allows longer timeframes to show more historical data
      const promises = timeframes.map(async (timeframe) => {
        try {
          const limit = getCandleLimit(selectedExchange);
          const response = await LazuliAPI.getOHLCV(selectedExchange, selectedSymbol, {
            timeframe,
            type: marketType,
            limit,
          });

          if (response.success && response.data && response.data.candles.length > 0) {
            return {
              timeframe,
              candles: response.data.candles,
              success: true,
              error: null,
            };
          } else {
            return {
              timeframe,
              candles: [],
              success: false,
              error: response.error || 'No data available',
            };
          }
        } catch (err) {
          return {
            timeframe,
            candles: [],
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      });

      // Wait for all requests to complete
      const results = await Promise.all(promises);

      // Transform results into chartsMap
      const chartsMap: Record<Timeframe, OHLCV[]> = {} as Record<Timeframe, OHLCV[]>;
      const failedTimeframes: string[] = [];

      results.forEach((result) => {
        if (result.success && result.candles.length > 0) {
          chartsMap[result.timeframe] = result.candles;
        } else if (!result.success) {
          failedTimeframes.push(`${result.timeframe} (${result.error || 'Unknown error'})`);
        }
      });

      setChartsData(chartsMap);

      // Show warning if some timeframes failed
      if (failedTimeframes.length > 0 && Object.keys(chartsMap).length > 0) {
        setError(
          `Some timeframes are not supported by this exchange: ${failedTimeframes.join(', ')}`
        );
      } else if (Object.keys(chartsMap).length === 0) {
        setError('No chart data available for any timeframe');
      }
    } catch (err) {
      setError('Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary">
            <LayoutGrid className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Multi-Timeframe
            </h1>
            <p className="text-lg font-light text-muted-foreground mt-2">
              Analyze market trends across multiple time horizons simultaneously.
            </p>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <Card className="glass border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Analysis Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Exchange and Market Type - side by side */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Exchange Selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Exchange</label>
              <div className="flex gap-2 flex-wrap">
                {exchanges.map((exchange) => (
                  <Button
                    key={exchange.id}
                    variant={selectedExchange === exchange.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedExchange(exchange.id);
                      setSelectedSymbol('');
                      setChartsData({} as Record<Timeframe, OHLCV[]>);
                    }}
                    className="transition-all"
                  >
                    {exchange.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Market Type Selector */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Market Type</label>
              <div className="flex p-1 bg-muted/50 rounded-lg w-fit">
                <Button
                  variant={marketType === 'spot' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setMarketType('spot');
                    setSelectedSymbol('');
                    setChartsData({} as Record<Timeframe, OHLCV[]>);
                  }}
                  className="rounded-md"
                  disabled={selectedExchange === 'hyperliquid'}
                  title={
                    selectedExchange === 'hyperliquid'
                      ? 'Hyperliquid only supports perpetual markets'
                      : ''
                  }
                >
                  Spot
                </Button>
                <Button
                  variant={marketType === 'perp' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setMarketType('perp');
                    setSelectedSymbol('');
                    setChartsData({} as Record<Timeframe, OHLCV[]>);
                  }}
                  className="rounded-md"
                >
                  Perpetual
                </Button>
              </div>
            </div>
          </div>

          {/* Quote Currency Filter - full width below */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Quote Currency</label>
            <div className="flex flex-wrap gap-1.5">
              {availableQuotes.map((quote) => {
                const count = tickers.filter((t) => {
                  const tickerQuote = getQuoteCurrency(t.symbol).toUpperCase();
                  return tickerQuote === quote;
                }).length;
                const icon = getCurrencyIcon(quote);
                return (
                  <Button
                    key={quote}
                    variant={quoteFilter === quote ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setQuoteFilter(quote)}
                    className="gap-1.5"
                  >
                    {icon && <span className="text-base">{icon}</span>}
                    <span>{quote}</span>
                    <span className="text-muted-foreground text-xs opacity-70">({count})</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Symbol Selector with integrated search */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">
              Select Symbol ({filteredTickers.length} available)
            </label>
            <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm">
              {/* Search input inside the selector box */}
              <div className="p-3 border-b border-white/5 bg-white/5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search symbols..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
              {/* Scrollable symbol list */}
              <div className="max-h-48 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {filteredTickers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    {loading ? (
                      <div className="animate-pulse">Loading tickers...</div>
                    ) : (
                      <>
                        <Search className="h-8 w-8 mb-2 opacity-20" />
                        <p className="text-sm">No tickers found</p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filteredTickers.map((ticker) => (
                      <button
                        key={ticker.symbol}
                        onClick={() => setSelectedSymbol(ticker.symbol)}
                        className={`text-left px-4 py-3 rounded-lg text-sm transition-all duration-200 border border-transparent ${
                          selectedSymbol === ticker.symbol
                            ? 'bg-primary/20 border-primary/50 text-primary font-medium shadow-[0_0_15px_rgba(var(--primary),0.3)]'
                            : 'hover:bg-white/5 hover:border-white/10'
                        }`}
                      >
                        {ticker.symbol}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Selected Symbol Display */}
          {selectedSymbol && (
            <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/20 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                  {selectedSymbol.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-primary">Active Symbol</p>
                  <p className="text-lg font-bold">{selectedSymbol}</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-background/50">
                {marketType === 'spot' ? 'Spot Market' : 'Perpetual Futures'}
              </Badge>
            </div>
          )}

          {/* Error/Warning Display */}
          {error && Object.keys(chartsData).length === 0 && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading Skeletons - shown while charts are loading */}
      {loading && selectedSymbol && Object.keys(chartsData).length === 0 && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-64 rounded-lg" />
            <Skeleton className="h-6 w-32 rounded-full" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {timeframes.map((tf) => (
              <Card key={tf} className="glass border-white/5">
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Charts Grid */}
      {Object.keys(chartsData).length > 0 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-display font-bold flex items-center gap-3">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">
                {selectedSymbol}
              </span>
              <span className="text-muted-foreground text-lg font-normal">
                on {exchanges.find((e) => e.id === selectedExchange)?.name}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full border border-white/5">
              <Clock className="h-4 w-4" />
              <span>Last updated: {new Date().toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Warning for partial failures */}
          {error && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center gap-3 text-yellow-500">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {timeframes.map((tf) => {
              const data = chartsData[tf];
              if (!data || data.length === 0) return null;

              return (
                <div key={tf} className="group">
                  <div className="relative z-10 transition-transform duration-300 group-hover:-translate-y-1">
                    <CandlestickChart
                      data={data}
                      timeframe={tf}
                      symbol={selectedSymbol}
                      height={350}
                    />
                  </div>
                  <div className="absolute inset-0 bg-primary/5 blur-xl rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {Object.keys(chartsData).length === 0 && !loading && !error && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-24 text-center">
            <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <LayoutGrid className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-3">Ready to Analyze</h3>
            <p className="text-muted-foreground max-w-md mx-auto text-lg font-light">
              Select an exchange, market type, and symbol above to generate multi-timeframe charts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
