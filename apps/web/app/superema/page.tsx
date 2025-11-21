'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { VirtualizedTickerList } from '@/components/virtualized-ticker-list';
import { LazuliAPI, EMADataPoint, SuperEMAResponse } from '@/lib/api-client';
import { SupportedExchange, Timeframe, Ticker } from '@lazuli/shared';
import { Search, TrendingUp, ArrowRight, LineChart, AlertCircle, Layers } from 'lucide-react';
import { createChart, IChartApi, LineData, CandlestickData, Time } from 'lightweight-charts';

/**
 * SuperEMA Page
 * Displays 1-400 EMA lines for comprehensive technical analysis
 * Allows traders to identify support/resistance levels and trend strength
 */
export default function SuperEMAPage() {
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
  const [tickersLoading, setTickersLoading] = useState(false);
  const [emaData, setEmaData] = useState<SuperEMAResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Available timeframes
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  // Maximum pages to fetch
  const MAX_PAGES = 20;

  /**
   * Parse symbol to extract base and quote currencies
   */
  const parseSymbol = (symbol: string) => {
    if (symbol.endsWith('.P')) {
      const baseQuote = symbol.slice(0, -2);
      const commonQuotes = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB', 'TUSD', 'DAI', 'FDUSD'];
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
   * Get icon for currency
   */
  const getCurrencyIcon = (currency: string): string | null => {
    const icons: Record<string, string> = {
      USDT: '₮',
      BTC: '₿',
      ETH: 'Ξ',
    };
    return icons[currency] || null;
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
    };
    return limits[exchange] || 1000;
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

      setTickersLoading(true);
      setError(null);

      try {
        const allTickers: Ticker[] = [];
        let currentPage = 1;
        let hasMorePages = true;
        const pageLimit = 500;

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

          if (response.data.pagination && response.data.pagination.hasNext) {
            currentPage++;
          } else {
            hasMorePages = false;
          }
        }

        setTickers(allTickers);
      } catch (err) {
        setError('Failed to load tickers');
      } finally {
        setTickersLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange, marketType]);

  /**
   * Get available quote currencies from tickers
   */
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

  // Filter tickers based on search and quote currency
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => {
        const matchesSearch = !searchQuery || t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
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

  /**
   * Generate color for EMA line based on period
   * Uses a gradient from blue (short) to red (long)
   * Returns rgba color with low opacity for better candlestick visibility
   */
  const getEMAColor = (period: number, maxPeriod: number = 400): string => {
    const ratio = period / maxPeriod;
    // HSL to RGB conversion for gradient from blue (240°) to red (0°)
    const hue = (240 - (ratio * 240)) / 360;
    const s = 0.7;
    const l = 0.5;

    // HSL to RGB conversion
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, hue + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, hue) * 255);
    const b = Math.round(hue2rgb(p, q, hue - 1/3) * 255);

    // Use rgba with 10% opacity for thinner appearance
    return `rgba(${r}, ${g}, ${b}, 0.1)`;
  };

  /**
   * Load SuperEMA data
   */
  async function loadSuperEMA() {
    if (!selectedSymbol) {
      setError('Please select a symbol');
      return;
    }

    setLoading(true);
    setError(null);
    setEmaData(null);

    try {
      const limit = getCandleLimit(selectedExchange);
      const response = await LazuliAPI.getSuperEMA(selectedExchange, selectedSymbol, {
        timeframe: selectedTimeframe,
        type: marketType,
        limit,
        maxPeriod: 400,
      });

      if (response.success && response.data) {
        setEmaData(response.data);
        if (response.data.data.length === 0) {
          setError('No data available for the selected symbol and timeframe');
        }
      } else {
        setError(response.error || 'Failed to load SuperEMA data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SuperEMA data');
    } finally {
      setLoading(false);
    }
  }

  // Render chart when emaData changes
  useEffect(() => {
    if (!emaData || !chartContainerRef.current) return;

    // Clear existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add candlestick series for price data
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const candlestickData: CandlestickData[] = emaData.data.map((point) => ({
      time: (point.timestamp / 1000) as Time,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    }));
    candlestickSeries.setData(candlestickData);

    // Add all 400 EMA lines with thin lines for better candlestick visibility
    for (let period = 1; period <= 400; period++) {
      const emaSeries = chart.addLineSeries({
        color: getEMAColor(period),
        lineWidth: 1,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      const emaLineData: LineData[] = emaData.data
        .filter((point) => point.emas[period] !== undefined)
        .map((point) => ({
          time: (point.timestamp / 1000) as Time,
          value: point.emas[period],
        }));

      emaSeries.setData(emaLineData);
    }

    // Fit content
    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [emaData]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary">
            <Layers className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              SuperEMA
            </h1>
            <p className="text-lg font-light text-muted-foreground mt-2">
              400 EMA lines for comprehensive trend analysis and support/resistance identification.
            </p>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <Card className="glass border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5 text-primary" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Exchange and Market Type */}
          <div className="grid gap-6 md:grid-cols-2">
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
                      setEmaData(null);
                    }}
                    className="transition-all"
                  >
                    {exchange.name}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Market Type</label>
              <div className="flex p-1 bg-muted/50 rounded-lg w-fit">
                <Button
                  variant={marketType === 'spot' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setMarketType('spot');
                    setSelectedSymbol('');
                    setEmaData(null);
                  }}
                  className="rounded-md"
                >
                  Spot
                </Button>
                <Button
                  variant={marketType === 'perp' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setMarketType('perp');
                    setSelectedSymbol('');
                    setEmaData(null);
                  }}
                  className="rounded-md"
                >
                  Perpetual
                </Button>
              </div>
            </div>
          </div>

          {/* Quote Currency Filter */}
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

          {/* Symbol Search */}
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

          {/* Symbol Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">Select Symbol</label>
              {selectedSymbol && (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {selectedSymbol}
                </Badge>
              )}
            </div>
            <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm h-[300px]">
              <VirtualizedTickerList
                tickers={filteredTickers}
                selectedSymbol={selectedSymbol}
                onSelect={setSelectedSymbol}
                loading={tickersLoading}
                ariaLabel="symbol"
              />
            </div>
          </div>

          {/* Generate Button */}
          {selectedSymbol && (
            <div className="p-6 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-white/10 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Ready to Generate
                </p>
                <div className="flex items-center gap-3 text-2xl font-display font-bold">
                  <span>{parseSymbol(selectedSymbol).base}</span>
                  <span className="text-muted-foreground text-lg">SuperEMA</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  400 EMA lines on the {selectedTimeframe} timeframe
                </p>
              </div>

              <Button
                onClick={loadSuperEMA}
                disabled={!selectedSymbol || loading}
                size="lg"
                className="w-full md:w-auto min-w-[200px] shadow-lg shadow-primary/20"
              >
                {loading ? (
                  'Calculating...'
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
      {emaData && emaData.data.length > 0 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-display font-bold flex items-center gap-3">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-cyan-400">
                {emaData.symbol}
              </span>
              <span className="text-muted-foreground text-lg font-normal">
                SuperEMA
              </span>
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full border border-white/5">
              <span>{emaData.timeframe}</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span>{emaData.candleCount} candles</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span>400 EMAs</span>
            </div>
          </div>

          {/* EMA Color Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>EMA Legend:</span>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: getEMAColor(5) }}></div>
              <span>Short (5)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: getEMAColor(50) }}></div>
              <span>50</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: getEMAColor(200) }}></div>
              <span>200</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: getEMAColor(400) }}></div>
              <span>Long (400)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <div className="w-3 h-3 rounded bg-red-500 -ml-1"></div>
              <span>Candles</span>
            </div>
          </div>

          <Card className="glass border-white/5 p-1">
            <CardContent className="p-0">
              <div ref={chartContainerRef} className="w-full" />
            </CardContent>
          </Card>

          {/* EMA Values Table (latest values) */}
          <Card className="glass border-white/5">
            <CardHeader>
              <CardTitle className="text-lg">Latest EMA Values</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-[300px] overflow-y-auto">
                {emaData.data.length > 0 &&
                  Object.entries(emaData.data[emaData.data.length - 1].emas)
                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                    .map(([period, value]) => (
                      <div
                        key={period}
                        className="p-2 bg-muted/20 rounded-lg text-xs"
                        style={{ borderLeft: `3px solid ${getEMAColor(parseInt(period))}` }}
                      >
                        <div className="font-medium text-muted-foreground">EMA {period}</div>
                        <div className="font-mono">{value.toFixed(4)}</div>
                      </div>
                    ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!emaData && !loading && !error && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-24 text-center">
            <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <TrendingUp className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-3">No Chart Generated</h3>
            <p className="text-muted-foreground max-w-md mx-auto text-lg font-light mb-8">
              Select an exchange, market type, symbol, and timeframe, then click "Generate Chart"
            </p>

            <div className="bg-muted/30 p-6 rounded-xl max-w-md mx-auto text-left border border-white/5">
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                  ?
                </span>
                What is SuperEMA?
              </p>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside ml-2">
                <li>Displays <strong>400 EMA lines</strong> (1-400 periods)</li>
                <li>Helps identify <strong>support/resistance</strong> zones</li>
                <li>Shows <strong>trend strength</strong> and direction</li>
                <li>Useful for <strong>confluence analysis</strong></li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
