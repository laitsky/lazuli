'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CandlestickChart } from '@/components/candlestick-chart';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange, Timeframe, Ticker, OHLCV } from '@lazuli/shared';
import { Search, TrendingUp } from 'lucide-react';

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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [chartsData, setChartsData] = useState<Record<Timeframe, OHLCV[]>>({} as Record<Timeframe, OHLCV[]>);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Available timeframes to display
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  // Auto-refresh interval (7 seconds to match backend)
  const REFRESH_INTERVAL = 7000;

  /**
   * Get appropriate candle limit based on timeframe
   * Longer timeframes need more candles to show meaningful historical data
   *
   * Examples of coverage:
   * - 1m with 100 candles = ~1.6 hours
   * - 1h with 500 candles = ~20 days (3 weeks)
   * - 4h with 1000 candles = ~166 days (5.5 months)
   * - 1d with 1000 candles = ~2.7 years
   * - 1w with 1000 candles = ~19 years
   *
   * Maximum limit per API: 1000 candles
   */
  const getCandleLimit = (timeframe: Timeframe): number => {
    const limits: Record<Timeframe, number> = {
      '1m': 100,    // ~1.6 hours
      '5m': 150,    // ~12.5 hours
      '15m': 200,   // ~2 days
      '1h': 500,    // ~20 days (3 weeks)
      '4h': 1000,   // ~166 days (5.5 months / half a year)
      '1d': 1000,   // ~2.7 years
      '3d': 1000,   // ~8 years
      '1w': 1000,   // ~19 years (almost 2 decades!)
    };
    return limits[timeframe] || 100;
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
  // Fetches ALL tickers using pagination (same approach as tickers page)
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

        setTickers(allTickers);
      } catch (err) {
        setError('Failed to load tickers');
      } finally {
        setLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange, marketType]); // Re-fetch when exchange or market type changes

  // Filter tickers based on search query only (type filtering is done by API)
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => {
        if (!searchQuery) return true;
        return t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      });
      // Shows ALL available tickers for the selected market type (fetched via pagination)
      // Search functionality helps users find what they need quickly
  }, [tickers, searchQuery]);

  /**
   * Load charts data for all timeframes with dynamic limits
   * Each timeframe fetches the optimal number of candles for best visualization
   */
  async function loadCharts(isAutoRefresh: boolean = false) {
    if (!selectedSymbol) {
      setError('Please select a symbol');
      return;
    }

    if (isAutoRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    if (!isAutoRefresh) {
      setChartsData({} as Record<Timeframe, OHLCV[]>);
    }

    try {
      // Fetch each timeframe individually with its own limit
      // This allows longer timeframes to show more historical data
      const promises = timeframes.map(async (timeframe) => {
        try {
          const limit = getCandleLimit(timeframe);
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
      setLastUpdate(new Date());

      // Show warning if some timeframes failed
      if (failedTimeframes.length > 0 && Object.keys(chartsMap).length > 0) {
        setError(`Some timeframes are not supported by this exchange: ${failedTimeframes.join(', ')}`);
      } else if (Object.keys(chartsMap).length === 0) {
        setError('No chart data available for any timeframe');
      }
    } catch (err) {
      setError('Failed to load chart data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  /**
   * Auto-refresh effect
   * Automatically refreshes charts when enabled and charts are loaded
   */
  useEffect(() => {
    if (!autoRefreshEnabled || !selectedSymbol || Object.keys(chartsData).length === 0) {
      return;
    }

    const intervalId = setInterval(() => {
      loadCharts(true);
    }, REFRESH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [autoRefreshEnabled, selectedSymbol, chartsData, selectedExchange, marketType, REFRESH_INTERVAL]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            <h1 className="text-3xl font-bold">Multi-Timeframe Analysis</h1>
          </div>
          <p className="text-muted-foreground mt-2">
            Analyze a single ticker across multiple timeframes: 1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w
          </p>
        </div>

        {/* Auto-refresh controls (shown only when charts are loaded) */}
        {Object.keys(chartsData).length > 0 && (
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            >
              {autoRefreshEnabled ? '⏸ Pause' : '▶ Resume'} Auto-Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadCharts(false)}
              disabled={loading}
            >
              {loading ? '🔄 Refreshing...' : '🔄 Refresh Now'}
            </Button>
          </div>
        )}
      </div>

      {/* Controls Card */}
      <Card>
        <CardHeader>
          <CardTitle>Select Ticker</CardTitle>
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
                    setSelectedSymbol('');
                    setChartsData({} as Record<Timeframe, OHLCV[]>);
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
                  setSelectedSymbol('');
                  setChartsData({} as Record<Timeframe, OHLCV[]>);
                }}
              >
                Spot
              </Button>
              <Button
                variant={marketType === 'perp' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setMarketType('perp');
                  setSelectedSymbol('');
                  setChartsData({} as Record<Timeframe, OHLCV[]>);
                }}
              >
                Perpetual
              </Button>
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

          {/* Symbol Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Select Symbol ({filteredTickers.length} available)
            </label>
            <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1">
              {filteredTickers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {loading ? 'Loading tickers...' : 'No tickers found'}
                </p>
              ) : (
                filteredTickers.map((ticker) => (
                  <button
                    key={ticker.symbol}
                    onClick={() => setSelectedSymbol(ticker.symbol)}
                    className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-accent transition-colors ${
                      selectedSymbol === ticker.symbol ? 'bg-accent font-medium' : ''
                    }`}
                  >
                    {ticker.symbol}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Selected Symbol Display */}
          {selectedSymbol && (
            <div className="p-3 bg-accent rounded-md">
              <p className="text-sm font-medium">Selected: {selectedSymbol}</p>
            </div>
          )}

          {/* Load Charts Button */}
          <Button
            onClick={() => loadCharts(false)}
            disabled={!selectedSymbol || loading}
            className="w-full"
            size="lg"
          >
            {loading ? 'Loading Charts...' : Object.keys(chartsData).length > 0 ? 'Reload Charts' : 'Load Charts'}
          </Button>

          {/* Error/Warning Display */}
          {error && Object.keys(chartsData).length === 0 && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Grid */}
      {Object.keys(chartsData).length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">
              {selectedSymbol} on {exchanges.find((e) => e.id === selectedExchange)?.name}
            </h2>
            <div className="text-sm text-muted-foreground">
              {lastUpdate && (
                <>
                  Last updated: {lastUpdate.toLocaleTimeString()}
                  {autoRefreshEnabled && (
                    <>
                      {' • '}Auto-refreshing every {REFRESH_INTERVAL / 1000}s
                      {isRefreshing && <span className="animate-pulse"> 🔄</span>}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Warning for partial failures */}
          {error && (
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                ⚠️ {error}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-4">
            {timeframes.map((tf) => {
              const data = chartsData[tf];
              if (!data || data.length === 0) return null;

              return (
                <CandlestickChart
                  key={tf}
                  data={data}
                  timeframe={tf}
                  symbol={selectedSymbol}
                  height={300}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {Object.keys(chartsData).length === 0 && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center">
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Charts Loaded</h3>
            <p className="text-muted-foreground">
              Select an exchange, market type, and symbol, then click "Load Charts" to view
              multi-timeframe analysis.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
