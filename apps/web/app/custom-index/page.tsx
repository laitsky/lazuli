'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { VirtualizedTickerList } from '@/components/virtualized-ticker-list';
import { LazuliAPI, CustomIndexRequest } from '@/lib/api-client';
import {
  SupportedExchange,
  Timeframe,
  Ticker,
  IndexAsset,
  CustomIndexResponse,
  IndexPerformancePoint,
} from '@lazuli/shared';
import {
  Search,
  TrendingUp,
  Percent,
  Plus,
  X,
  BarChart3,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/**
 * Custom Index Page
 * Create weighted baskets of coins and compare performance to BTC/ETH/SOL benchmarks
 */
export default function CustomIndexPage() {
  // State management
  const [exchanges, setExchanges] = useState<{ id: SupportedExchange; name: string }[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange>('binance');
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('1h');
  const [loading, setLoading] = useState(false);
  const [tickersLoading, setTickersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Index configuration
  const [indexName, setIndexName] = useState<string>('My Custom Index');
  const [selectedAssets, setSelectedAssets] = useState<IndexAsset[]>([]);
  const [indexResult, setIndexResult] = useState<CustomIndexResponse | null>(null);

  // Available timeframes
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  // Maximum pages to fetch to prevent excessive API calls
  const MAX_PAGES = 20;

  // Chart colors
  const CHART_COLORS = {
    index: '#8b5cf6', // Purple for the custom index
    BTC: '#f7931a', // Bitcoin orange
    ETH: '#627eea', // Ethereum blue
    SOL: '#00d4aa', // Solana green
  };

  /**
   * Parse symbol using standardized notation
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

  // Load tickers when exchange changes
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
            type: 'spot',
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
  }, [selectedExchange]);

  // Filter tickers to only show USDT pairs (for simplicity)
  const filteredTickers = useMemo(() => {
    return tickers
      .filter((t) => {
        const matchesSearch =
          !searchQuery || t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
        const tickerQuote = getQuoteCurrency(t.symbol).toUpperCase();
        const isUSDT = tickerQuote === 'USDT';
        // Don't show already selected assets
        const notSelected = !selectedAssets.some((a) => a.symbol === t.symbol);
        return matchesSearch && isUSDT && notSelected;
      })
      .sort((a, b) => {
        const prioritySymbols = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX'];
        const aBase = parseSymbol(a.symbol).base.toUpperCase();
        const bBase = parseSymbol(b.symbol).base.toUpperCase();
        const aPriority = prioritySymbols.indexOf(aBase);
        const bPriority = prioritySymbols.indexOf(bBase);

        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [tickers, searchQuery, selectedAssets]);

  // Calculate total weight
  const totalWeight = useMemo(() => {
    return selectedAssets.reduce((sum, asset) => sum + asset.weight, 0);
  }, [selectedAssets]);

  /**
   * Add asset to the index
   */
  const addAsset = (symbol: string) => {
    if (selectedAssets.length >= 20) {
      setError('Maximum 20 assets allowed');
      return;
    }

    // Default weight based on remaining percentage
    const remainingWeight = 100 - totalWeight;
    const defaultWeight = Math.min(remainingWeight, 10);

    setSelectedAssets([
      ...selectedAssets,
      {
        symbol,
        weight: defaultWeight,
      },
    ]);
  };

  /**
   * Remove asset from the index
   */
  const removeAsset = (symbol: string) => {
    setSelectedAssets(selectedAssets.filter((a) => a.symbol !== symbol));
  };

  /**
   * Update asset weight
   */
  const updateWeight = (symbol: string, weight: number) => {
    setSelectedAssets(
      selectedAssets.map((a) => (a.symbol === symbol ? { ...a, weight: Math.max(0, Math.min(100, weight)) } : a))
    );
  };

  /**
   * Auto-balance weights to sum to 100
   */
  const autoBalance = () => {
    if (selectedAssets.length === 0) return;

    const equalWeight = 100 / selectedAssets.length;
    setSelectedAssets(selectedAssets.map((a) => ({ ...a, weight: Math.round(equalWeight * 100) / 100 })));
  };

  /**
   * Calculate the custom index
   */
  async function calculateIndex() {
    if (selectedAssets.length === 0) {
      setError('Please add at least one asset to the index');
      return;
    }

    if (Math.abs(totalWeight - 100) > 0.01) {
      setError(`Weights must sum to 100. Current total: ${totalWeight.toFixed(2)}%`);
      return;
    }

    setLoading(true);
    setError(null);
    setIndexResult(null);

    try {
      const request: CustomIndexRequest = {
        name: indexName,
        exchange: selectedExchange,
        timeframe: selectedTimeframe,
        assets: selectedAssets,
        limit: 200,
      };

      const response = await LazuliAPI.calculateCustomIndex(request);

      if (response.success && response.data) {
        setIndexResult(response.data);
      } else {
        setError(response.error || 'Failed to calculate index');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate index');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Prepare chart data from index result
   */
  const chartData = useMemo(() => {
    if (!indexResult) return [];

    // Combine index performance with benchmarks
    return indexResult.performance.map((point, i) => {
      const dataPoint: Record<string, number | string> = {
        time: new Date(point.timestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        timestamp: point.timestamp,
        [indexResult.name]: point.change,
      };

      // Add benchmark data
      indexResult.benchmarks.forEach((benchmark) => {
        const benchmarkPoint = benchmark.data[i];
        if (benchmarkPoint) {
          dataPoint[benchmark.symbol.replace('-USDT', '')] = benchmarkPoint.change;
        }
      });

      return dataPoint;
    });
  }, [indexResult]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary">
            <BarChart3 className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Custom Index
            </h1>
            <p className="text-lg font-light text-muted-foreground mt-2">
              Create your own weighted basket of coins and compare performance to BTC, ETH, and SOL.
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Card */}
      <Card className="glass border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/5">
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-primary" />
            Index Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Index Name */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Index Name</label>
            <Input
              type="text"
              placeholder="My Custom Index"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              className="bg-background/50 max-w-md"
            />
          </div>

          {/* Exchange and Timeframe */}
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
                      setSelectedAssets([]);
                      setIndexResult(null);
                    }}
                    className="transition-all"
                  >
                    {exchange.name}
                  </Button>
                ))}
              </div>
            </div>

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
          </div>

          {/* Selected Assets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">
                Selected Assets ({selectedAssets.length}/20)
              </label>
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-mono ${
                    Math.abs(totalWeight - 100) < 0.01
                      ? 'text-green-500'
                      : 'text-yellow-500'
                  }`}
                >
                  Total: {totalWeight.toFixed(1)}%
                </span>
                {selectedAssets.length > 0 && (
                  <Button variant="outline" size="sm" onClick={autoBalance}>
                    Auto-Balance
                  </Button>
                )}
              </div>
            </div>

            {selectedAssets.length > 0 ? (
              <div className="grid gap-2">
                {selectedAssets.map((asset) => (
                  <div
                    key={asset.symbol}
                    className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-white/5"
                  >
                    <Badge variant="outline" className="font-mono">
                      {parseSymbol(asset.symbol).base}
                    </Badge>
                    <span className="text-sm text-muted-foreground flex-1">{asset.symbol}</span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={asset.weight}
                        onChange={(e) => updateWeight(asset.symbol, parseFloat(e.target.value) || 0)}
                        className="w-20 h-8 text-sm text-center"
                        min={0}
                        max={100}
                        step={0.1}
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAsset(asset.symbol)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 border border-dashed border-white/10 rounded-lg text-center text-muted-foreground">
                <Plus className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No assets selected. Add assets from the list below.</p>
              </div>
            )}
          </div>

          {/* Asset Selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Add Assets (USDT pairs)</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search symbols..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-background/50"
              />
            </div>
            <div className="border border-white/10 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm h-[250px]">
              <VirtualizedTickerList
                tickers={filteredTickers}
                selectedSymbol=""
                onSelect={addAsset}
                loading={tickersLoading}
                ariaLabel="asset-selector"
              />
            </div>
            <p className="text-xs text-muted-foreground">{filteredTickers.length} symbols available</p>
          </div>

          {/* Calculate Button */}
          {selectedAssets.length > 0 && (
            <div className="p-6 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-white/10 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Ready to Calculate</p>
                <p className="text-lg font-display font-bold">{indexName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedAssets.length} asset{selectedAssets.length !== 1 ? 's' : ''} on{' '}
                  {selectedTimeframe} timeframe
                </p>
              </div>

              <Button
                onClick={calculateIndex}
                disabled={loading || selectedAssets.length === 0 || Math.abs(totalWeight - 100) > 0.01}
                size="lg"
                className="w-full md:w-auto min-w-[200px] shadow-lg shadow-primary/20"
              >
                {loading ? (
                  'Calculating...'
                ) : (
                  <>
                    Calculate Index <ArrowRight className="ml-2 h-4 w-4" />
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

      {/* Results Chart */}
      {indexResult && chartData.length > 0 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-display font-bold flex items-center gap-3">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">
                {indexResult.name}
              </span>
              <span className="text-muted-foreground text-lg font-normal">Performance</span>
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full border border-white/5">
              <span>Return:</span>
              <span
                className={`font-mono font-bold ${
                  indexResult.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {indexResult.totalReturn >= 0 ? '+' : ''}
                {indexResult.totalReturn.toFixed(2)}%
              </span>
            </div>
          </div>

          <Card className="glass border-white/5">
            <CardContent className="p-6">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="time"
                    stroke="#666"
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#666"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `${value.toFixed(1)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: '#999' }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, '']}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey={indexResult.name}
                    stroke={CHART_COLORS.index}
                    strokeWidth={3}
                    dot={false}
                    name={indexResult.name}
                  />
                  {indexResult.benchmarks.map((benchmark) => {
                    const key = benchmark.symbol.replace('-USDT', '');
                    const color = CHART_COLORS[key as keyof typeof CHART_COLORS] || '#888';
                    return (
                      <Line
                        key={benchmark.symbol}
                        type="monotone"
                        dataKey={key}
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        name={benchmark.name}
                        strokeDasharray={key === indexResult.name ? '0' : '5 5'}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Index Composition */}
          <Card className="glass border-white/5">
            <CardHeader>
              <CardTitle className="text-lg">Index Composition</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {indexResult.assets.map((asset) => (
                  <div
                    key={asset.symbol}
                    className="p-3 bg-muted/30 rounded-lg border border-white/5 text-center"
                  >
                    <p className="font-mono font-bold">{parseSymbol(asset.symbol).base}</p>
                    <p className="text-sm text-muted-foreground">{asset.weight}%</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!indexResult && !loading && !error && selectedAssets.length === 0 && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-24 text-center">
            <div className="w-20 h-20 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <TrendingUp className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-2xl font-display font-bold mb-3">Create Your Index</h3>
            <p className="text-muted-foreground max-w-md mx-auto text-lg font-light mb-8">
              Add assets to your basket, set their weights, and calculate performance compared to major
              cryptocurrencies.
            </p>

            <div className="bg-muted/30 p-6 rounded-xl max-w-md mx-auto text-left border border-white/5">
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                  ?
                </span>
                Example Index:
              </p>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside ml-2">
                <li>
                  <strong>BTC-USDT</strong> - 40%
                </li>
                <li>
                  <strong>ETH-USDT</strong> - 30%
                </li>
                <li>
                  <strong>SOL-USDT</strong> - 15%
                </li>
                <li>
                  <strong>AVAX-USDT</strong> - 15%
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
