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

  // Available timeframes to display
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

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
        const response = await LazuliAPI.getTickers(selectedExchange, {
          limit: 500,
          sortBy: 'volume',
          sortOrder: 'desc',
        });

        if (response.success && response.data) {
          setTickers(response.data.tickers);
        } else {
          setError(response.error || 'Failed to load tickers');
        }
      } catch (err) {
        setError('Failed to load tickers');
      } finally {
        setLoading(false);
      }
    }

    loadTickers();
  }, [selectedExchange]);

  // Filter tickers based on search query and market type
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => t.type === marketType)
      .filter((t) => {
        if (!searchQuery) return true;
        return t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .slice(0, 50); // Limit to top 50 for performance
  }, [tickers, searchQuery, marketType]);

  /**
   * Load charts data for all timeframes
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
      // Fetch data for all timeframes using the multi-timeframe endpoint
      const response = await LazuliAPI.getMultiTimeframeOHLCV(selectedExchange, selectedSymbol, {
        timeframes,
        type: marketType,
        limit: 100,
      });

      if (response.success && response.data) {
        // Transform the response into a map of timeframe -> candles
        const chartsMap: Record<Timeframe, OHLCV[]> = {} as Record<Timeframe, OHLCV[]>;

        response.data.timeframes.forEach((tf: any) => {
          chartsMap[tf.timeframe as Timeframe] = tf.candles;
        });

        setChartsData(chartsMap);
      } else {
        setError(response.error || 'Failed to load chart data');
      }
    } catch (err) {
      setError('Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-6 w-6" />
        <h1 className="text-3xl font-bold">Multi-Timeframe Analysis</h1>
      </div>

      <p className="text-muted-foreground">
        Analyze a single ticker across multiple timeframes: 1m, 5m, 15m, 1h, 4h, 1d, 3d, 1w
      </p>

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
                disabled={selectedExchange === 'hyperliquid'}
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
            {selectedExchange === 'hyperliquid' && marketType === 'spot' && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Hyperliquid only supports perpetual markets
              </p>
            )}
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
            onClick={loadCharts}
            disabled={!selectedSymbol || loading}
            className="w-full"
            size="lg"
          >
            {loading ? 'Loading Charts...' : 'Load Charts'}
          </Button>

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Grid */}
      {Object.keys(chartsData).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">
            {selectedSymbol} on {exchanges.find((e) => e.id === selectedExchange)?.name}
          </h2>

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
