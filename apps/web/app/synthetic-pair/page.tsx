'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CandlestickChart } from '@/components/candlestick-chart';
import { VirtualizedTickerList } from '@/components/virtualized-ticker-list';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange, Timeframe, Ticker, OHLCV } from '@lazuli/shared';
import { Search, TrendingUp, Divide } from 'lucide-react';

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
      const commonQuotes = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB', 'TUSD', 'DAI', 'FDUSD'];

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
   * Get appropriate candle limit based on timeframe
   * Same logic as multi-timeframe page for consistency
   */
  const getCandleLimit = (timeframe: Timeframe): number => {
    const limits: Record<Timeframe, number> = {
      '1m': 100,    // ~1.6 hours
      '5m': 150,    // ~12.5 hours
      '15m': 200,   // ~2 days
      '1h': 500,    // ~20 days (3 weeks)
      '4h': 1000,   // ~166 days (5.5 months)
      '1d': 1000,   // ~2.7 years
      '3d': 1000,   // ~8 years
      '1w': 1000,   // ~19 years
    };
    return limits[timeframe] || 100;
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
      const commonQuotes = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB', 'TUSD', 'DAI', 'FDUSD'];

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
      'USDT': '₮',  // Tether symbol
      'BTC': '₿',   // Bitcoin symbol
      'ETH': 'Ξ',   // Ethereum symbol (Greek Xi)
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

        setTickers(allTickers);

        // Warn if we hit the page limit
        if (currentPage > MAX_PAGES) {
          console.warn(`Reached maximum page limit (${MAX_PAGES}). Some tickers may not be loaded.`);
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
        const matchesSearch = !searchQuery || t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
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
      const limit = getCandleLimit(selectedTimeframe);
      const response = await LazuliAPI.getCustomPair(
        selectedExchange,
        symbol1,
        symbol2,
        {
          timeframe: selectedTimeframe,
          type: marketType,
          limit,
        }
      );

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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-2">
        <Divide className="h-6 w-6" />
        <h1 className="text-5xl font-display font-bold">Synthetic Pair Generator</h1>
      </div>

      <p className="text-lg font-light text-muted-foreground">
        Create synthetic trading pairs by dividing two ticker prices. Example: BTC-USDT / AVAX-USDT = BTC/AVAX
      </p>

      {/* Controls Card */}
      <Card>
        <CardHeader>
          <CardTitle>Configure Synthetic Pair</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Exchange Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Exchange</label>
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
                >
                  {exchange.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Market Type Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Market Type</label>
            <div className="flex gap-2">
              <Button
                variant={marketType === 'spot' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setMarketType('spot');
                  setSymbol1('');
                  setSymbol2('');
                  setChartData([]);
                }}
              >
                Spot
              </Button>
              <Button
                variant={marketType === 'perp' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setMarketType('perp');
                  setSymbol1('');
                  setSymbol2('');
                  setChartData([]);
                }}
              >
                Perpetual
              </Button>
            </div>
          </div>

          {/* Quote Currency Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Quote Currency</label>
            <div className="flex flex-wrap gap-2">
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
                    <span className="text-muted-foreground">({count})</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Timeframe Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Timeframe</label>
            <div className="flex gap-2 flex-wrap">
              {timeframes.map((tf) => (
                <Button
                  key={tf}
                  variant={selectedTimeframe === tf ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedTimeframe(tf)}
                >
                  {tf}
                </Button>
              ))}
            </div>
          </div>

          {/* Symbol Search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Search Symbol</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by symbol (e.g., BTC/USDT)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Two-column layout for symbol selection with virtual scrolling */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Symbol 1 (Numerator) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Symbol 1 (Numerator)
              </label>
              <VirtualizedTickerList
                tickers={filteredTickers}
                selectedSymbol={symbol1}
                onSelect={setSymbol1}
                loading={loading}
                ariaLabel="numerator"
              />
              {symbol1 && (
                <div className="p-2 bg-accent rounded-md">
                  <p className="text-xs font-medium">{symbol1}</p>
                </div>
              )}
            </div>

            {/* Symbol 2 (Denominator) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Symbol 2 (Denominator)
              </label>
              <VirtualizedTickerList
                tickers={filteredTickers}
                selectedSymbol={symbol2}
                onSelect={setSymbol2}
                loading={loading}
                ariaLabel="denominator"
              />
              {symbol2 && (
                <div className="p-2 bg-accent rounded-md">
                  <p className="text-xs font-medium">{symbol2}</p>
                </div>
              )}
            </div>
          </div>

          {/* Synthetic Pair Preview */}
          {symbol1 && symbol2 && (
            <div className="p-4 bg-blue-100 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-800 rounded-md">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Synthetic Pair Preview: {extractBaseCurrency(symbol1)} / {extractBaseCurrency(symbol2)}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                This will show {symbol1} ÷ {symbol2} on the {selectedTimeframe} timeframe
              </p>
            </div>
          )}

          {/* Generate Chart Button */}
          <Button
            onClick={loadSyntheticPairChart}
            disabled={!symbol1 || !symbol2 || loading}
            className="w-full"
            size="lg"
          >
            {loading ? 'Generating Chart...' : 'Generate Synthetic Pair Chart'}
          </Button>

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chart Display */}
      {chartData.length > 0 && syntheticPairSymbol && (
        <div className="space-y-4">
          <h2 className="text-3xl font-display font-bold">
            {syntheticPairSymbol} on {exchanges.find((e) => e.id === selectedExchange)?.name}
          </h2>
          <p className="text-muted-foreground">
            Generated from {symbol1} / {symbol2} • {selectedTimeframe} timeframe • {chartData.length} candles
          </p>

          <CandlestickChart
            data={chartData}
            timeframe={selectedTimeframe}
            symbol={syntheticPairSymbol}
            height={500}
          />
        </div>
      )}

      {/* Empty State */}
      {chartData.length === 0 && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center">
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Chart Generated</h3>
            <p className="text-muted-foreground mb-4">
              Select an exchange, market type, two symbols, and a timeframe, then click "Generate Synthetic Pair Chart"
            </p>
            <div className="bg-muted p-4 rounded-md max-w-md mx-auto text-left">
              <p className="text-sm font-medium mb-2">Example Use Case:</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Select Binance Spot</li>
                <li>Choose BTC/USDT as Symbol 1</li>
                <li>Choose AVAX/USDT as Symbol 2</li>
                <li>Select 1h timeframe</li>
                <li>Generate to see BTC/AVAX ratio chart</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
