'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CandlestickChart } from '@/components/candlestick-chart';
import { VirtualizedTickerList } from '@/components/virtualized-ticker-list';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange, Timeframe, Ticker, OHLCV } from '@lazuli/shared';
import { Search, TrendingUp, Divide, ArrowRight, Calculator, AlertCircle } from 'lucide-react';

/**
 * Synthetic Pair Generator Page
 * Creates a synthetic trading pair by dividing two ticker prices
 * Example: BTC-USDT / AVAX-USDT = BTC/AVAX synthetic pair
 * Allows traders to analyze cross-pair relationships that may not exist on exchanges
 */
export default function SyntheticPairPage() {
  // State management
  const [exchanges, setExchanges] = useState<{ id: SupportedExchange; name: string }[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange>('binance');
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [symbol1, setSymbol1] = useState<string>(''); // Numerator
  const [symbol2, setSymbol2] = useState<string>(''); // Denominator
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [quoteFilter, setQuoteFilter] = useState<string>('USDT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1h');
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<OHLCV[]>([]);
  const [syntheticPairSymbol, setSyntheticPairSymbol] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Available timeframes
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  // Maximum pages to fetch to prevent excessive API calls
  const MAX_PAGES = 20; // Limits to 10,000 tickers (500 per page * 20)

  /**
   * Extract base currency from symbol
   * Handles our standardized notation:
   * - Spot: BTC-USDT -> BTC
   * - Perpetual: BTCUSDT.P -> BTC
   * @param symbol - Trading pair symbol (e.g., BTC-USDT or BTCUSDT.P)
   * @returns Base currency (e.g., BTC)
   */
  const extractBaseCurrency = (symbol: string): string => {
    // Handle perpetual notation (BTCUSDT.P)
    if (symbol.endsWith('.P')) {
      const baseQuote = symbol.slice(0, -2); // Remove .P
      // Common quote currencies to remove
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
          return baseQuote.slice(0, -quote.length);
        }
      }
      return baseQuote; // Fallback
    }

    // Handle spot notation (BTC-USDT)
    const parts = symbol.split(/[-/]/);
    return parts[0] || symbol;
  };

  /**
   * Get candle limit based on exchange
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
      setSymbol1('');
      setSymbol2('');
      setChartData([]);
    }
  }, [selectedExchange]);

  // Load tickers when exchange or market type changes
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

        // Fetch pages with rate limiting (max 20 pages = 10,000 tickers)
        while (hasMorePages && currentPage <= MAX_PAGES) {
          const response = await LazuliAPI.getTickers(selectedExchange, {
            page: currentPage,
            limit: pageLimit,
            sortBy: 'volume',
            sortOrder: 'desc',
            type: marketType,
          });

          if (!response.success || !response.data) {
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

        // Warn if we hit the page limit
        if (currentPage > MAX_PAGES) {
          console.warn(
            `Reached maximum page limit (${MAX_PAGES}). Some tickers may not be loaded.`
          );
        }
      } catch (err) {
        setError('Failed to load tickers');
      } finally {
        setLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange, marketType]);

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

  // Filter tickers based on search query and quote currency
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
  }, [tickers, searchQuery, quoteFilter]);

  /**
   * Load synthetic pair chart data
   * Fetches data for both symbols and generates the synthetic pair
   */
  async function loadSyntheticPairChart() {
    if (!symbol1 || !symbol2) {
      setError('Please select both symbols');
      return;
    }

    if (symbol1 === symbol2) {
      setError('Please select different symbols');
      return;
    }

    setLoading(true);
    setError(null);
    setChartData([]);

    try {
      const limit = getCandleLimit(selectedExchange);
      const response = await LazuliAPI.getCustomPair(selectedExchange, symbol1, symbol2, {
        timeframe: selectedTimeframe,
        type: marketType,
        limit,
      });

      if (response.success && response.data) {
        setChartData(response.data.candles);
        setSyntheticPairSymbol(response.data.customPairSymbol);

        if (response.data.candles.length === 0) {
          setError('No data available for the selected pair and timeframe');
        }
      } else {
        setError(response.error || 'Failed to generate synthetic pair');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load synthetic pair data');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary">
            <Calculator className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Synthetic Pairs
            </h1>
            <p className="text-lg font-light text-muted-foreground mt-2">
              Create custom trading pairs by dividing any two assets to analyze relative
              performance.
            </p>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <Card className="glass border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <CardTitle className="flex items-center gap-2">
            <Divide className="h-5 w-5 text-primary" />
            Pair Configuration
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
                      setSymbol1('');
                      setSymbol2('');
                      setChartData([]);
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
                    setSymbol1('');
                    setSymbol2('');
                    setChartData([]);
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
                    setSymbol1('');
                    setSymbol2('');
                    setChartData([]);
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

          {/* Timeframe Selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Timeframe</label>
            <div className="flex gap-2 flex-wrap">
              {timeframes.map((tf) => (
                <Button
                  key={tf}
                  variant={selectedTimeframe === tf ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedTimeframe(tf)}
                  className="min-w-[3rem]"
                >
                  {tf}
                </Button>
              ))}
            </div>
          </div>

          {/* Symbol Search - filters both symbol lists below */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Search Symbols</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search symbols (e.g., BTC, ETH)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-background/50"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {filteredTickers.length} symbols available
            </p>
          </div>

          {/* Two-column layout for symbol selection with virtual scrolling */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Symbol 1 (Numerator) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  Symbol 1 (Numerator)
                </label>
                {symbol1 && (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                    {symbol1}
                  </Badge>
                )}
              </div>
              <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm h-[300px]">
                <VirtualizedTickerList
                  tickers={filteredTickers}
                  selectedSymbol={symbol1}
                  onSelect={setSymbol1}
                  loading={loading}
                  ariaLabel="numerator"
                />
              </div>
            </div>

            {/* Symbol 2 (Denominator) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  Symbol 2 (Denominator)
                </label>
                {symbol2 && (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                    {symbol2}
                  </Badge>
                )}
              </div>
              <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm h-[300px]">
                <VirtualizedTickerList
                  tickers={filteredTickers}
                  selectedSymbol={symbol2}
                  onSelect={setSymbol2}
                  loading={loading}
                  ariaLabel="denominator"
                />
              </div>
            </div>
          </div>

          {/* Synthetic Pair Preview */}
          {symbol1 && symbol2 && (
            <div className="p-6 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-white/10 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Synthetic Pair Preview
                </p>
                <div className="flex items-center gap-3 text-2xl font-display font-bold">
                  <span>{extractBaseCurrency(symbol1)}</span>
                  <span className="text-muted-foreground">/</span>
                  <span>{extractBaseCurrency(symbol2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  This will show {symbol1} ÷ {symbol2} on the {selectedTimeframe} timeframe
                </p>
              </div>

              <Button
                onClick={loadSyntheticPairChart}
                disabled={!symbol1 || !symbol2 || loading}
                size="lg"
                className="w-full md:w-auto min-w-[200px] shadow-lg shadow-primary/20"
              >
                {loading ? (
                  'Generating...'
                ) : (
                  <>
                    Generate Chart <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chart Display */}
      {chartData.length > 0 && syntheticPairSymbol && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-display font-bold flex items-center gap-3">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">
                {syntheticPairSymbol}
              </span>
              <span className="text-muted-foreground text-lg font-normal">
                on {exchanges.find((e) => e.id === selectedExchange)?.name}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full border border-white/5">
              <span className="font-mono text-xs">
                {symbol1} ÷ {symbol2}
              </span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span>{selectedTimeframe}</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span>{chartData.length} candles</span>
            </div>
          </div>

          <Card className="glass border-white/5 p-1">
            <CardContent className="p-0">
              <CandlestickChart
                data={chartData}
                timeframe={selectedTimeframe}
                symbol={syntheticPairSymbol}
                height={500}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {chartData.length === 0 && !loading && !error && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-24 text-center">
            <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <TrendingUp className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-3">No Chart Generated</h3>
            <p className="text-muted-foreground max-w-md mx-auto text-lg font-light mb-8">
              Select an exchange, market type, two symbols, and a timeframe, then click "Generate
              Chart"
            </p>

            <div className="bg-muted/30 p-6 rounded-xl max-w-md mx-auto text-left border border-white/5">
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                  ?
                </span>
                Example Use Case:
              </p>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside ml-2">
                <li>
                  Select <strong>Binance Spot</strong>
                </li>
                <li>
                  Choose <strong>BTC/USDT</strong> as Symbol 1
                </li>
                <li>
                  Choose <strong>AVAX/USDT</strong> as Symbol 2
                </li>
                <li>
                  Select <strong>1h</strong> timeframe
                </li>
                <li>
                  Generate to see <strong>BTC/AVAX</strong> ratio chart
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
