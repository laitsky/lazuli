/**
 * Liquidations Page - Terminal Luxe
 *
 * Real-time liquidation monitoring dashboard for perpetual futures.
 * Shows live liquidation feed, statistics, heatmap, and cascade alerts.
 */

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI } from '@/lib/api-client';
import {
  useLiquidationFeed,
  useLiquidationStats,
  useCascadeAlerts,
} from '@/hooks/use-liquidation-feed';
import {
  LiquidationFeed,
  LiquidationStats,
  LiquidationHeatmap,
  CascadeAlerts,
} from '@/components/liquidation';
import type {
  LiquidationExchange,
  LiquidationHeatmap as LiquidationHeatmapType,
} from '@lazuli/shared';
import { Flame, Globe, Search, RefreshCw, Pause, Play, BarChart3 } from 'lucide-react';

/**
 * Supported liquidation exchanges
 * Note: Binance uses WebSocket (REST API deprecated), Hyperliquid has no public liquidation API
 */
const LIQUIDATION_EXCHANGES: { id: LiquidationExchange; name: string }[] = [
  { id: 'binance', name: 'Binance' },
  { id: 'bybit', name: 'Bybit' },
  { id: 'okx', name: 'OKX' },
];

/**
 * Popular symbols for quick selection
 */
const POPULAR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

/**
 * Period options for statistics
 */
const PERIOD_OPTIONS: { value: '1h' | '4h' | '24h'; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '24h', label: '24H' },
];

export default function LiquidationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Get exchange from URL, default to bybit
  const selectedExchange = (searchParams.get('exchange') || 'bybit') as LiquidationExchange;
  const selectedSymbol = searchParams.get('symbol') || undefined;
  const selectedPeriod = (searchParams.get('period') || '24h') as '1h' | '4h' | '24h';

  // Symbol search input
  const [symbolInput, setSymbolInput] = useState(selectedSymbol || '');

  // Heatmap data (fetched separately)
  const [heatmapData, setHeatmapData] = useState<LiquidationHeatmapType | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // Use liquidation feed hook
  const {
    events,
    summary,
    cascades: feedCascades,
    isRefreshing: feedRefreshing,
    error: feedError,
    refresh: refreshFeed,
    pause: pauseFeed,
    resume: resumeFeed,
    isPaused,
    countdown,
    newEventIds,
  } = useLiquidationFeed({
    exchange: selectedExchange,
    symbol: selectedSymbol,
    refreshInterval: 5000,
    maxEvents: 50,
    enabled: true,
    onNewLiquidation: (event) => {
      // Could add sound notification here for whale liquidations
      if (event.value > 1000000) {
        console.log('Whale liquidation:', event);
      }
    },
  });

  // Use liquidation stats hook
  const {
    data: statsData,
    isLoading: statsLoading,
    refresh: refreshStats,
  } = useLiquidationStats({
    exchange: selectedExchange,
    symbol: selectedSymbol,
    period: selectedPeriod,
    refreshInterval: 30000,
  });

  // Use cascade alerts hook
  const { cascades: globalCascades } = useCascadeAlerts({
    threshold: 1000000,
    refreshInterval: 10000,
  });

  // Fetch heatmap data when symbol changes
  useEffect(() => {
    async function fetchHeatmap() {
      if (!selectedSymbol) {
        setHeatmapData(null);
        return;
      }

      setHeatmapLoading(true);
      try {
        const response = await LazuliAPI.getLiquidationHeatmap(
          selectedExchange,
          `${selectedSymbol}.P`
        );
        if (response.success && response.data) {
          setHeatmapData(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch heatmap:', error);
      } finally {
        setHeatmapLoading(false);
      }
    }

    fetchHeatmap();
  }, [selectedExchange, selectedSymbol]);

  // Handle exchange change
  const handleExchangeChange = (exchange: LiquidationExchange) => {
    const params = new URLSearchParams(searchParams);
    params.set('exchange', exchange);
    setSearchParams(params);
  };

  // Handle symbol search
  const handleSymbolSearch = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (symbolInput.trim()) {
      params.set('symbol', symbolInput.toUpperCase().trim());
    } else {
      params.delete('symbol');
    }
    setSearchParams(params);
  }, [symbolInput, searchParams, setSearchParams]);

  // Handle period change
  const handlePeriodChange = (period: '1h' | '4h' | '24h') => {
    const params = new URLSearchParams(searchParams);
    params.set('period', period);
    setSearchParams(params);
  };

  // Handle quick symbol selection
  const handleQuickSymbol = (symbol: string) => {
    setSymbolInput(symbol);
    const params = new URLSearchParams(searchParams);
    params.set('symbol', symbol);
    setSearchParams(params);
  };

  // Clear symbol filter
  const handleClearSymbol = () => {
    setSymbolInput('');
    const params = new URLSearchParams(searchParams);
    params.delete('symbol');
    setSearchParams(params);
  };

  // Combine cascades from feed and global
  const allCascades = [
    ...feedCascades,
    ...globalCascades.filter((gc) => !feedCascades.some((fc) => fc.id === gc.id)),
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={Flame}
        title="Liquidation Monitor"
        description="Real-time liquidation tracking across perpetual futures exchanges. Monitor cascades and high-risk zones."
      />

      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        {/* Exchange Selector */}
        <div className="flex flex-wrap gap-2 p-1 bg-muted/30 rounded-xl border border-border w-fit backdrop-blur-sm">
          {LIQUIDATION_EXCHANGES.map((ex) => (
            <Button
              key={ex.id}
              variant={selectedExchange === ex.id ? 'default' : 'ghost'}
              size="lg"
              onClick={() => handleExchangeChange(ex.id)}
              className={`rounded-lg transition-all duration-300 ${
                selectedExchange === ex.id
                  ? 'shadow-lg shadow-primary/20'
                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe
                className={`mr-2 h-4 w-4 ${selectedExchange === ex.id ? 'animate-pulse' : ''}`}
              />
              {ex.name}
              {selectedExchange === ex.id && (
                <span className="ml-2 flex h-2 w-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
              )}
            </Button>
          ))}
        </div>

        {/* Refresh Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={isPaused ? resumeFeed : pauseFeed}
            className="gap-2"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refreshFeed();
              refreshStats();
            }}
            disabled={feedRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${feedRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {!isPaused && (
            <Badge variant="secondary" className="font-mono">
              {countdown}s
            </Badge>
          )}
        </div>
      </div>

      {/* Symbol Filter */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter by symbol (e.g., BTCUSDT)"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleSymbolSearch()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={handleSymbolSearch}>
            Apply
          </Button>
          {selectedSymbol && (
            <Button variant="ghost" onClick={handleClearSymbol}>
              Clear
            </Button>
          )}
        </div>

        {/* Quick Symbols */}
        <div className="flex flex-wrap gap-2">
          {POPULAR_SYMBOLS.map((sym) => (
            <Button
              key={sym}
              variant={selectedSymbol === sym ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleQuickSymbol(sym)}
              className="font-mono text-xs"
            >
              {sym}
            </Button>
          ))}
        </div>
      </div>

      {/* Period Selector (for stats) */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Statistics Period:</span>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={selectedPeriod === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePeriodChange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Error State */}
      {feedError && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="p-4">
            <p className="text-destructive text-sm">{feedError}</p>
          </CardContent>
        </Card>
      )}

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Feed + Cascades */}
        <div className="lg:col-span-2 space-y-6">
          {/* Statistics Cards */}
          <LiquidationStats stats={statsData || null} isLoading={statsLoading} />

          {/* Live Feed */}
          <LiquidationFeed
            events={events}
            newEventIds={newEventIds}
            summary={summary}
            isRefreshing={feedRefreshing}
            countdown={countdown}
            onRefresh={refreshFeed}
            maxHeight="400px"
          />
        </div>

        {/* Right Column: Heatmap + Cascades */}
        <div className="space-y-6">
          {/* Cascade Alerts */}
          <CascadeAlerts cascades={allCascades} maxAlerts={3} />

          {/* Heatmap (only when symbol is selected) */}
          {selectedSymbol && (
            <LiquidationHeatmap data={heatmapData} height={350} isLoading={heatmapLoading} />
          )}

          {/* Symbol selection prompt */}
          {!selectedSymbol && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Liquidation Heatmap
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <BarChart3 className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-sm">Select a symbol to view heatmap</p>
                  <p className="text-xs mt-1">Shows liquidation density by price level</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick Stats Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Quick Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Exchange</span>
                <Badge variant="outline" className="font-mono">
                  {selectedExchange.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Symbol Filter</span>
                <Badge variant={selectedSymbol ? 'default' : 'secondary'}>
                  {selectedSymbol || 'All'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Feed Status</span>
                <Badge variant={isPaused ? 'secondary' : 'success'}>
                  {isPaused ? 'Paused' : 'Live'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Active Cascades</span>
                <Badge variant={allCascades.length > 0 ? 'destructive' : 'secondary'}>
                  {allCascades.filter((c) => c.isActive).length}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
