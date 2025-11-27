'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CandlestickChartWithIndicators } from '@/components/candlestick-chart-with-indicators';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI } from '@/lib/api-client';
import {
  SupportedExchange,
  Timeframe,
  Ticker,
  IndicatorDataPoint,
  DEFAULT_INDICATOR_PERIODS,
} from '@lazuli/shared';
import {
  Search,
  TrendingUp,
  Activity,
  Clock,
  AlertCircle,
  LineChart,
  BarChart3,
} from 'lucide-react';

/**
 * Technical Analysis page with indicator overlays
 * Provides SMA, EMA, and RSI indicators on candlestick charts
 */
export default function TechnicalAnalysisPage() {
  // State management
  const [exchanges, setExchanges] = useState<{ id: SupportedExchange; name: string }[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange>('binance');
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [quoteFilter, setQuoteFilter] = useState<string>('USDT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1h');
  const [loading, setLoading] = useState(false);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [indicatorData, setIndicatorData] = useState<IndicatorDataPoint[] | null>(null);
  const [availableIndicators, setAvailableIndicators] = useState<{
    sma: number[];
    ema: number[];
    rsi: number[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Available timeframes
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  /**
   * Get appropriate candle limit based on exchange
   */
  const getCandleLimit = (exchange: SupportedExchange): number => {
    const limits: Record<SupportedExchange, number> = {
      binance: 500,
      bybit: 500,
      okx: 300,
      hyperliquid: 500,
      upbit: 200,
    };
    return limits[exchange] || 500;
  };

  /**
   * Parse symbol to extract base and quote currencies
   */
  const parseSymbol = (symbol: string) => {
    if (symbol.endsWith('.P')) {
      const baseQuote = symbol.slice(0, -2);
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

    if (symbol.includes('-')) {
      const [base, quote] = symbol.split('-');
      return { base: base || '', quote: quote || '', isPerpetual: false };
    }

    return { base: symbol, quote: '', isPerpetual: false };
  };

  /**
   * Extract quote currency from symbol
   */
  const getQuoteCurrency = (symbol: string): string => {
    const parsed = parseSymbol(symbol);
    return parsed.quote;
  };

  /**
   * Get currency icon
   */
  const getCurrencyIcon = (currency: string): string | null => {
    const icons: Record<string, string> = {
      USDT: '₮',
      BTC: '₿',
      ETH: 'Ξ',
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

  // Auto-switch for exchange-specific constraints
  useEffect(() => {
    if (selectedExchange === 'hyperliquid') {
      if (marketType === 'spot') {
        setMarketType('perp');
      }
      setQuoteFilter('USDC');
      setSelectedSymbol('');
      setIndicatorData(null);
    }
  }, [selectedExchange]);

  useEffect(() => {
    if (selectedExchange === 'upbit') {
      if (marketType === 'perp') {
        setMarketType('spot');
      }
      setQuoteFilter('KRW');
      setSelectedSymbol('');
      setIndicatorData(null);
    }
  }, [selectedExchange]);

  // Load tickers when exchange or market type changes
  useEffect(() => {
    async function loadTickers() {
      if (!selectedExchange) return;

      setTickerLoading(true);
      setError(null);

      try {
        const allTickers: Ticker[] = [];
        let currentPage = 1;
        let hasMorePages = true;
        const pageLimit = 500;

        while (hasMorePages) {
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

          if (response.data.pagination && response.data.pagination.hasNext) {
            currentPage++;
          } else {
            hasMorePages = false;
          }
        }

        const uniqueTickers = Array.from(new Map(allTickers.map((t) => [t.symbol, t])).values());
        setTickers(uniqueTickers);
      } catch (err) {
        setError('Failed to load tickers');
      } finally {
        setTickerLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange, marketType]);

  // Get available quote currencies
  const availableQuotes = useMemo(() => {
    const quotes = new Set<string>();
    tickers.forEach((ticker) => {
      const quote = getQuoteCurrency(ticker.symbol);
      if (quote) {
        quotes.add(quote.toUpperCase());
      }
    });

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

  // Filter tickers
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
        const prioritySymbols = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
        const aBase = parseSymbol(a.symbol).base.toUpperCase();
        const bBase = parseSymbol(b.symbol).base.toUpperCase();

        const aPriority = prioritySymbols.indexOf(aBase);
        const bPriority = prioritySymbols.indexOf(bBase);

        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;

        return a.symbol.localeCompare(b.symbol);
      });
  }, [tickers, searchQuery, quoteFilter]);

  // Load technical indicators when symbol or timeframe changes
  useEffect(() => {
    if (selectedSymbol && selectedTimeframe) {
      loadIndicators();
    }
  }, [selectedSymbol, selectedTimeframe]);

  /**
   * Load technical indicator data from the API
   */
  async function loadIndicators() {
    if (!selectedSymbol) {
      setError('Please select a symbol');
      return;
    }

    setLoading(true);
    setError(null);
    setIndicatorData(null);

    try {
      const limit = getCandleLimit(selectedExchange);

      // Fetch indicators with default periods
      const response = await LazuliAPI.getTechnicalIndicators(selectedExchange, selectedSymbol, {
        timeframe: selectedTimeframe,
        type: marketType,
        limit,
        sma: DEFAULT_INDICATOR_PERIODS.sma.join(','),
        ema: DEFAULT_INDICATOR_PERIODS.ema.join(','),
        rsi: DEFAULT_INDICATOR_PERIODS.rsi.join(','),
      });

      if (response.success && response.data && response.data.data.length > 0) {
        setIndicatorData(response.data.data);
        setAvailableIndicators(response.data.indicators);
      } else {
        setError(response.error || 'No data available');
      }
    } catch (err) {
      setError('Failed to load technical indicators');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={LineChart}
        title="Technical Analysis"
        description="Analyze price trends with SMA, EMA, and RSI overlays. Toggle indicators for custom analysis views."
      />

      {/* Controls Card */}
      <Card className="glass border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Analysis Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Exchange and Market Type */}
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
                      setIndicatorData(null);
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
                    setIndicatorData(null);
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
                    setIndicatorData(null);
                  }}
                  className="rounded-md"
                  disabled={selectedExchange === 'upbit'}
                  title={selectedExchange === 'upbit' ? 'Upbit only supports spot markets' : ''}
                >
                  Perpetual
                </Button>
              </div>
            </div>
          </div>

          {/* Quote Currency and Timeframe */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Quote Currency Filter */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Quote Currency</label>
              <div className="flex flex-wrap gap-1.5">
                {availableQuotes.slice(0, 8).map((quote) => {
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
              <div className="flex flex-wrap gap-1.5">
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
          </div>

          {/* Symbol Selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">
              Select Symbol ({filteredTickers.length} available)
            </label>
            <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm">
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
              <div className="max-h-48 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {filteredTickers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    {tickerLoading ? (
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
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-background/50">
                  {selectedTimeframe}
                </Badge>
                <Badge variant="outline" className="bg-background/50">
                  {marketType === 'spot' ? 'Spot' : 'Perpetual'}
                </Badge>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && !indicatorData && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading State */}
      {loading && selectedSymbol && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <Card className="glass border-white/5">
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[400px] w-full rounded-xl" />
              <div className="mt-4">
                <Skeleton className="h-[120px] w-full rounded-xl" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart with Indicators */}
      {indicatorData && indicatorData.length > 0 && !loading && (
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

          {/* Indicator Info Cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <TrendingUp className="h-4 w-4" />
                  SMA Periods
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableIndicators?.sma.map((p) => (
                    <Badge key={p} variant="secondary" className="text-xs">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <TrendingUp className="h-4 w-4" />
                  EMA Periods
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableIndicators?.ema.map((p) => (
                    <Badge key={p} variant="secondary" className="text-xs">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="glass border-white/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Activity className="h-4 w-4" />
                  RSI Period
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableIndicators?.rsi.map((p) => (
                    <Badge key={p} variant="secondary" className="text-xs">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Chart */}
          <CandlestickChartWithIndicators
            data={indicatorData}
            timeframe={selectedTimeframe}
            symbol={selectedSymbol}
            height={450}
            availableSMA={availableIndicators?.sma || (DEFAULT_INDICATOR_PERIODS.sma as unknown as number[])}
            availableEMA={availableIndicators?.ema || (DEFAULT_INDICATOR_PERIODS.ema as unknown as number[])}
            availableRSI={availableIndicators?.rsi || (DEFAULT_INDICATOR_PERIODS.rsi as unknown as number[])}
            showControls={true}
          />
        </div>
      )}

      {/* Empty State */}
      {!indicatorData && !loading && !error && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-24 text-center">
            <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <BarChart3 className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-3">Ready for Technical Analysis</h3>
            <p className="text-muted-foreground max-w-md mx-auto text-lg font-light">
              Select an exchange, timeframe, and symbol to view price charts with SMA, EMA, and RSI
              indicators.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
