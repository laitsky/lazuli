import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI, CustomIndexRequest } from '@/lib/api-client';
import {
  SupportedExchange,
  Timeframe,
  Ticker,
  IndexAsset,
  CustomIndexResponse,
} from '@lazuli/shared';
import {
  Search,
  TrendingUp,
  Plus,
  X,
  AlertCircle,
  ArrowRight,
  Sparkles,
  FileImage,
  FileSpreadsheet,
  Layers,
  PieChart,
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
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from 'recharts';

/**
 * Custom Index Page - Redesigned with better UX
 * Features:
 * - Two-panel layout with live pie chart preview
 * - Slider-based weight management
 * - Quick-add chips for popular assets
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
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');

  // Ref for scrolling to results
  const resultsRef = useRef<HTMLDivElement>(null);
  // Ref for chart export
  const chartRef = useRef<HTMLDivElement>(null);
  // State for hovered line in chart
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);

  // Available timeframes
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

  // Popular assets for quick-add
  const POPULAR_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'];

  // Preset templates for quick start
  const PRESET_TEMPLATES = [
    {
      name: 'Top 5 by Volume',
      description: 'High-volume majors',
      assets: [
        { symbol: 'BTC-USDT', weight: 30 },
        { symbol: 'ETH-USDT', weight: 25 },
        { symbol: 'BNB-USDT', weight: 20 },
        { symbol: 'SOL-USDT', weight: 15 },
        { symbol: 'XRP-USDT', weight: 10 },
      ],
    },
    {
      name: 'DeFi Blue Chips',
      description: 'Top DeFi protocols',
      assets: [
        { symbol: 'UNI-USDT', weight: 25 },
        { symbol: 'AAVE-USDT', weight: 25 },
        { symbol: 'LINK-USDT', weight: 20 },
        { symbol: 'MKR-USDT', weight: 15 },
        { symbol: 'SNX-USDT', weight: 15 },
      ],
    },
    {
      name: 'Layer 1 Index',
      description: 'Major L1 blockchains',
      assets: [
        { symbol: 'ETH-USDT', weight: 30 },
        { symbol: 'SOL-USDT', weight: 20 },
        { symbol: 'ADA-USDT', weight: 15 },
        { symbol: 'AVAX-USDT', weight: 15 },
        { symbol: 'DOT-USDT', weight: 10 },
        { symbol: 'ATOM-USDT', weight: 10 },
      ],
    },
  ];

  // Pie chart colors
  const PIE_COLORS = [
    '#8b5cf6',
    '#6366f1',
    '#3b82f6',
    '#0ea5e9',
    '#06b6d4',
    '#14b8a6',
    '#10b981',
    '#22c55e',
    '#84cc16',
    '#eab308',
  ];

  // Chart colors for performance
  const CHART_COLORS = {
    index: '#8b5cf6',
    BTC: '#f7931a',
    ETH: '#627eea',
    SOL: '#00d4aa',
  };

  const MAX_PAGES = 20;

  /**
   * Parse symbol to extract base currency
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
          return { base: baseQuote.slice(0, -quote.length), quote };
        }
      }
      return { base: baseQuote, quote: '' };
    }
    if (symbol.includes('-')) {
      const [base, quote] = symbol.split('-');
      return { base: base || '', quote: quote || '' };
    }
    return { base: symbol, quote: '' };
  };

  const getQuoteCurrency = (symbol: string): string => parseSymbol(symbol).quote;

  // Load exchanges
  useEffect(() => {
    async function loadExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success && response.data) {
        const supported = response.data
          .filter((ex) => ex.supported)
          .map((ex) => ({ id: ex.id as SupportedExchange, name: ex.name }));
        setExchanges(supported);
      }
    }
    loadExchanges();
  }, []);

  // Auto-switch to 'perp' for Hyperliquid (which only supports perpetual markets)
  // Also set quoteFilter state if we add it, but for now custom-index hardcodes USDT filter
  useEffect(() => {
    if (selectedExchange === 'hyperliquid') {
      if (marketType === 'spot') {
        setMarketType('perp');
      }
      setSelectedAssets([]);
      setIndexResult(null);
    }
  }, [selectedExchange]);

  // Auto-switch to 'spot' for Upbit (which only supports spot markets)
  useEffect(() => {
    if (selectedExchange === 'upbit') {
      if (marketType === 'perp') {
        setMarketType('spot');
      }
      setSelectedAssets([]);
      setIndexResult(null);
    }
  }, [selectedExchange]);

  // Load tickers
  useEffect(() => {
    async function loadTickers() {
      if (!selectedExchange) return;
      setTickersLoading(true);
      setError(null);

      try {
        const allTickers: Ticker[] = [];
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= MAX_PAGES) {
          const response = await LazuliAPI.getTickers(selectedExchange, {
            page: currentPage,
            limit: 500,
            sortBy: 'volume',
            sortOrder: 'desc',
            type: marketType,
          });

          if (!response.success || !response.data) {
            if (currentPage === 1) setError(response.error || 'Failed to load tickers');
            break;
          }

          allTickers.push(...response.data.tickers);
          hasMorePages = response.data.pagination?.hasNext || false;
          currentPage++;
        }

        // Deduplicate tickers by symbol to prevent React key errors
        // This is especially important for Hyperliquid which may return duplicates
        const uniqueTickers = Array.from(new Map(allTickers.map((t) => [t.symbol, t])).values());
        setTickers(uniqueTickers);
      } catch {
        setError('Failed to load tickers');
      } finally {
        setTickersLoading(false);
      }
    }
    loadTickers();
  }, [selectedExchange, marketType]);

  // Filter tickers for search - show USDT pairs (or USDC for Hyperliquid)
  const filteredTickers = useMemo(() => {
    // Hyperliquid uses USDC, other exchanges use USDT
    const targetQuote = selectedExchange === 'hyperliquid' ? 'USDC' : 'USDT';
    return tickers.filter((t) => {
      const matchesSearch =
        !searchQuery || t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesQuote = getQuoteCurrency(t.symbol).toUpperCase() === targetQuote;
      const notSelected = !selectedAssets.some((a) => a.symbol === t.symbol);
      return matchesSearch && matchesQuote && notSelected;
    });
  }, [tickers, searchQuery, selectedAssets, selectedExchange]);

  // Calculate total weight
  const totalWeight = useMemo(() => {
    return selectedAssets.reduce((sum, a) => sum + a.weight, 0);
  }, [selectedAssets]);

  // Pie chart data
  const pieData = useMemo(() => {
    return selectedAssets.map((asset) => ({
      name: parseSymbol(asset.symbol).base,
      value: asset.weight,
      symbol: asset.symbol,
    }));
  }, [selectedAssets]);

  /**
   * Add asset and auto-balance all weights equally
   */
  const addAsset = (symbol: string) => {
    if (selectedAssets.length >= 10) {
      setError('Maximum 10 assets for optimal visualization');
      return;
    }
    if (selectedAssets.some((a) => a.symbol === symbol)) return;

    // Add new asset and auto-balance all weights to sum exactly 100
    const newAssets = [...selectedAssets, { symbol, weight: 0 }];
    const count = newAssets.length;
    const baseWeight = Math.floor((100 / count) * 10) / 10;
    const remainder = Math.round((100 - baseWeight * count) * 10) / 10;

    setSelectedAssets(
      newAssets.map((a, i) => ({
        ...a,
        weight: i === count - 1 ? baseWeight + remainder : baseWeight,
      }))
    );
    setError(null);
  };

  /**
   * Quick-add popular asset
   */
  const quickAddAsset = (base: string) => {
    // Use correct symbol format based on market type and exchange
    // Hyperliquid uses USDC, other exchanges use USDT
    const quote = selectedExchange === 'hyperliquid' ? 'USDC' : 'USDT';
    const symbol = marketType === 'spot' ? `${base}-${quote}` : `${base}${quote}.P`;
    const ticker = tickers.find((t) => t.symbol === symbol);
    if (ticker) {
      addAsset(symbol);
    } else {
      setError(`${symbol} not found on ${selectedExchange}`);
    }
  };

  /**
   * Remove asset
   */
  const removeAsset = (symbol: string) => {
    setSelectedAssets(selectedAssets.filter((a) => a.symbol !== symbol));
  };

  /**
   * Update weight via slider
   */
  const updateWeight = (symbol: string, weight: number) => {
    setSelectedAssets(
      selectedAssets.map((a) =>
        a.symbol === symbol ? { ...a, weight: Math.round(weight * 10) / 10 } : a
      )
    );
  };

  /**
   * Auto-balance weights equally
   */
  const autoBalance = () => {
    if (selectedAssets.length === 0) return;
    const count = selectedAssets.length;
    const baseWeight = Math.floor((100 / count) * 10) / 10;
    const remainder = Math.round((100 - baseWeight * count) * 10) / 10;

    setSelectedAssets(
      selectedAssets.map((a, i) => ({
        ...a,
        weight: i === count - 1 ? baseWeight + remainder : baseWeight,
      }))
    );
  };

  /**
   * Apply preset template
   */
  const applyTemplate = (template: (typeof PRESET_TEMPLATES)[0]) => {
    setSelectedAssets(template.assets);
    setIndexName(template.name);
    setError(null);
    setIndexResult(null);
  };

  /**
   * Export chart as PNG
   */
  const exportToPNG = async () => {
    if (!chartRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#0a0a0a',
        scale: 2,
      });
      const link = document.createElement('a');
      link.download = `${indexResult?.name || 'custom-index'}-chart.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      setError('Failed to export PNG. Please try again.');
    }
  };

  /**
   * Export data as CSV
   */
  const exportToCSV = () => {
    if (!indexResult || !chartData.length) return;

    // Build CSV headers
    const headers = ['Time', indexResult.name, 'BTC', 'ETH', 'SOL'];
    const csvRows = [headers.join(',')];

    // Add data rows
    chartData.forEach((row) => {
      const values = [
        `"${row.time}"`,
        row[indexResult.name] !== undefined ? (row[indexResult.name] as number).toFixed(2) : '',
        row['BTC'] !== undefined ? (row['BTC'] as number).toFixed(2) : '',
        row['ETH'] !== undefined ? (row['ETH'] as number).toFixed(2) : '',
        row['SOL'] !== undefined ? (row['SOL'] as number).toFixed(2) : '',
      ];
      csvRows.push(values.join(','));
    });

    // Download
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.download = `${indexResult.name}-data.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };

  /**
   * Calculate index
   */
  async function calculateIndex() {
    if (selectedAssets.length === 0) {
      setError('Add at least one asset');
      return;
    }
    if (Math.abs(totalWeight - 100) > 0.5) {
      setError(`Weights must sum to 100% (currently ${totalWeight.toFixed(1)}%)`);
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
        // Scroll to results after a brief delay for render
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        setError(response.error || 'Failed to calculate index');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate index');
    } finally {
      setLoading(false);
    }
  }

  // Performance chart data
  const chartData = useMemo(() => {
    if (!indexResult) return [];
    return indexResult.performance.map((point, i) => {
      const dataPoint: Record<string, number | string> = {
        time: new Date(point.timestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        [indexResult.name]: point.change,
      };
      indexResult.benchmarks.forEach((b) => {
        const bp = b.data[i];
        if (bp) dataPoint[b.symbol.replace('-USDT', '')] = bp.change;
      });
      return dataPoint;
    });
  }, [indexResult]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={PieChart}
        title="Custom Index"
        description="Build weighted baskets of assets and track performance. Compare your custom index against BTC, ETH, and SOL."
      />

      {/* Preset Templates - Only show for spot markets */}
      {marketType === 'spot' && (
        <Card className="glass border-white/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Start from Template
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {PRESET_TEMPLATES.map((template) => (
                <button
                  key={template.name}
                  onClick={() => applyTemplate(template)}
                  className="text-left p-3 rounded-lg border border-white/10 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                >
                  <div className="font-medium text-sm group-hover:text-primary transition-colors">
                    {template.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{template.description}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {template.assets.slice(0, 3).map((a) => (
                      <span key={a.symbol} className="text-xs bg-muted/50 px-1.5 py-0.5 rounded">
                        {a.symbol.replace('-USDT', '')}
                      </span>
                    ))}
                    {template.assets.length > 3 && (
                      <span className="text-xs text-muted-foreground">
                        +{template.assets.length - 3}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two-Panel Layout */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left Panel - Configuration */}
        <div className="lg:col-span-3 space-y-6">
          {/* Index Name */}
          <Card className="glass border-white/5">
            <CardContent className="p-5">
              <label className="text-sm font-medium text-muted-foreground">Index Name</label>
              <Input
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
                className="mt-1.5 bg-background/50"
                placeholder="My Custom Index"
              />
            </CardContent>
          </Card>

          {/* Asset Selection - Combined Card */}
          <Card className="glass border-white/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Add Assets</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {/* Exchange, Market Type & Timeframe */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Exchange</label>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {exchanges.map((ex) => (
                      <Button
                        key={ex.id}
                        variant={selectedExchange === ex.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setSelectedExchange(ex.id);
                          setSelectedAssets([]);
                          setIndexResult(null);
                        }}
                      >
                        {ex.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Market Type</label>
                  <div className="flex p-1 bg-muted/50 rounded-lg w-fit mt-1.5">
                    <Button
                      variant={marketType === 'spot' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        setMarketType('spot');
                        setSelectedAssets([]);
                        setIndexResult(null);
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
                        setSelectedAssets([]);
                        setIndexResult(null);
                      }}
                      className="rounded-md"
                      disabled={selectedExchange === 'upbit'}
                      title={selectedExchange === 'upbit' ? 'Upbit only supports spot markets' : ''}
                    >
                      Perpetual
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Timeframe</label>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {timeframes.map((tf) => (
                      <Button
                        key={tf}
                        variant={selectedTimeframe === tf ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedTimeframe(tf)}
                        className="px-2"
                      >
                        {tf}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quick Add */}
              <div>
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Quick Add
                </label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {POPULAR_ASSETS.map((asset) => {
                    // Check using correct symbol format based on market type and exchange
                    const quote = selectedExchange === 'hyperliquid' ? 'USDC' : 'USDT';
                    const symbol =
                      marketType === 'spot' ? `${asset}-${quote}` : `${asset}${quote}.P`;
                    const isAdded = selectedAssets.some((a) => a.symbol === symbol);
                    return (
                      <Button
                        key={asset}
                        variant={isAdded ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => !isAdded && quickAddAsset(asset)}
                        disabled={isAdded || tickersLoading}
                        className="gap-1 h-7 text-xs"
                      >
                        {isAdded ? '✓' : <Plus className="h-3 w-3" />}
                        {asset}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Search Filter */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background/50"
                />
              </div>

              {/* Scrollable Asset List */}
              <div className="h-48 overflow-y-auto border border-white/10 rounded-lg bg-background/30">
                {tickersLoading ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Loading assets...
                  </div>
                ) : filteredTickers.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    {searchQuery ? 'No matching assets' : 'No assets available'}
                  </div>
                ) : (
                  <div className="p-1">
                    {filteredTickers.map((t) => (
                      <button
                        key={t.symbol}
                        onClick={() => addAsset(t.symbol)}
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted/50 flex justify-between items-center transition-colors"
                      >
                        <span className="font-mono">{parseSymbol(t.symbol).base}</span>
                        <Plus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {filteredTickers.length} {selectedExchange === 'hyperliquid' ? 'USDC' : 'USDT'}{' '}
                pairs available
              </p>
            </CardContent>
          </Card>

          {/* Selected Assets with Sliders */}
          {selectedAssets.length > 0 && (
            <Card className="glass border-white/5">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-sm">
                    Portfolio Weights ({selectedAssets.length}/10)
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-mono ${
                        Math.abs(totalWeight - 100) < 0.5 ? 'text-green-500' : 'text-yellow-500'
                      }`}
                    >
                      {totalWeight.toFixed(1)}%
                    </span>
                    <Button variant="outline" size="sm" onClick={autoBalance}>
                      Equal
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {selectedAssets.map((asset, idx) => (
                  <div key={asset.symbol} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                        />
                        <span className="font-mono text-sm font-medium">
                          {parseSymbol(asset.symbol).base}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono w-14 text-right">
                          {asset.weight.toFixed(1)}%
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAsset(asset.symbol)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={asset.weight}
                      onChange={(e) => updateWeight(asset.symbol, parseFloat(e.target.value))}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        {/* Right Panel - Preview & Results */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pie Chart Preview */}
          <Card className="glass border-white/5 sticky top-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Portfolio Composition</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedAssets.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                  Add assets to see composition
                </div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => [`${value.toFixed(1)}%`, 'Weight']}
                        contentStyle={{
                          backgroundColor: '#1a1a1a',
                          border: '1px solid #333',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Calculate Button */}
              <Button
                onClick={calculateIndex}
                disabled={
                  loading || selectedAssets.length === 0 || Math.abs(totalWeight - 100) > 0.5
                }
                className="w-full mt-4"
                size="lg"
              >
                {loading ? (
                  'Calculating...'
                ) : (
                  <>
                    Calculate Performance <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Results */}
      {indexResult && chartData.length > 0 && (
        <div
          ref={resultsRef}
          className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-display font-bold">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">
                {indexResult.name}
              </span>
              <span className="text-muted-foreground text-lg font-normal ml-2">Performance</span>
            </h2>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  indexResult.totalReturn >= 0
                    ? 'text-green-500 border-green-500/30'
                    : 'text-red-500 border-red-500/30'
                }
              >
                {indexResult.totalReturn >= 0 ? '+' : ''}
                {indexResult.totalReturn.toFixed(2)}%
              </Badge>
              <Button variant="outline" size="sm" onClick={exportToPNG} title="Export as PNG">
                <FileImage className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={exportToCSV} title="Export as CSV">
                <FileSpreadsheet className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Card className="glass border-white/5">
            <CardContent className="p-4" ref={chartRef}>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData} onMouseLeave={() => setHoveredLine(null)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="time"
                    stroke="#666"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#666"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, '']}
                  />
                  <Legend
                    onMouseEnter={(e) => setHoveredLine(e.dataKey as string)}
                    onMouseLeave={() => setHoveredLine(null)}
                  />
                  <Line
                    type="monotone"
                    dataKey="BTC"
                    stroke={CHART_COLORS.BTC}
                    strokeWidth={hoveredLine === 'BTC' ? 3 : 1.5}
                    strokeOpacity={hoveredLine && hoveredLine !== 'BTC' ? 0.3 : 1}
                    dot={false}
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey="ETH"
                    stroke={CHART_COLORS.ETH}
                    strokeWidth={hoveredLine === 'ETH' ? 3 : 1.5}
                    strokeOpacity={hoveredLine && hoveredLine !== 'ETH' ? 0.3 : 1}
                    dot={false}
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey="SOL"
                    stroke={CHART_COLORS.SOL}
                    strokeWidth={hoveredLine === 'SOL' ? 3 : 1.5}
                    strokeOpacity={hoveredLine && hoveredLine !== 'SOL' ? 0.3 : 1}
                    dot={false}
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey={indexResult.name}
                    stroke={CHART_COLORS.index}
                    strokeWidth={hoveredLine === indexResult.name ? 4 : 3}
                    strokeOpacity={hoveredLine && hoveredLine !== indexResult.name ? 0.3 : 1}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Performance Table */}
          <Card className="glass border-white/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Asset Contribution</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 font-medium text-muted-foreground">Asset</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Weight</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Return</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">
                        Contribution
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {indexResult.assets.map((asset, idx) => {
                      // Calculate individual asset return (simplified estimation)
                      const assetReturn =
                        (indexResult.totalReturn * asset.weight) / 100 / (asset.weight / 100);
                      const contribution = (assetReturn * asset.weight) / 100;
                      return (
                        <tr key={asset.symbol} className="border-b border-white/5">
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                              />
                              <span className="font-mono">{asset.symbol.replace('-USDT', '')}</span>
                            </div>
                          </td>
                          <td className="text-right py-2 font-mono">{asset.weight.toFixed(1)}%</td>
                          <td
                            className={`text-right py-2 font-mono ${assetReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}
                          >
                            {assetReturn >= 0 ? '+' : ''}
                            {assetReturn.toFixed(2)}%
                          </td>
                          <td
                            className={`text-right py-2 font-mono ${contribution >= 0 ? 'text-green-500' : 'text-red-500'}`}
                          >
                            {contribution >= 0 ? '+' : ''}
                            {contribution.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="font-medium">
                      <td className="py-2">Total</td>
                      <td className="text-right py-2 font-mono">100%</td>
                      <td className="text-right py-2">-</td>
                      <td
                        className={`text-right py-2 font-mono ${indexResult.totalReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}
                      >
                        {indexResult.totalReturn >= 0 ? '+' : ''}
                        {indexResult.totalReturn.toFixed(2)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {!indexResult && !loading && selectedAssets.length === 0 && (
        <Card className="glass border-white/5 border-dashed">
          <CardContent className="py-16 text-center">
            <TrendingUp className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-xl font-display font-bold mb-2">Create Your Index</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Use the quick-add buttons or search to add assets, adjust weights with sliders, then
              calculate performance.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
