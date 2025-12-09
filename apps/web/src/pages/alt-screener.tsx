/**
 * Alt Screener Page - Scan all altcoins and compare performance
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AltScreenerClient } from './alt-screener-client';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange, BaseCurrency, ExchangeInfo, AltScreenerResponse } from '@lazuli/shared';
import { Globe, TrendingUp, TrendingDown, BarChart3, Zap, Target } from 'lucide-react';

export default function AltScreenerPage() {
  const [searchParams] = useSearchParams();

  // Validate exchange (excluding hyperliquid which is perp-only)
  const validExchanges = ['binance', 'bybit', 'okx', 'upbit'];
  const selectedExchange = searchParams.get('exchange') || 'binance';
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'binance';

  // Validate base currency
  const validBases = ['USD', 'BTC', 'ETH', 'SOL'];
  const selectedBase = searchParams.get('base')?.toUpperCase() || 'USD';
  const base = validBases.includes(selectedBase) ? (selectedBase as BaseCurrency) : 'USD';

  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [screenerData, setScreenerData] = useState<AltScreenerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success) {
        setExchanges(response.data.filter((e) => e.id !== 'hyperliquid'));
      }
    }
    fetchExchanges();
  }, []);

  useEffect(() => {
    async function fetchScreenerData() {
      setLoading(true);
      const response = await LazuliAPI.getAltScreener(exchange, {
        base,
        limit: 200,
        sortBy: 'performance',
        sortOrder: 'desc',
      });

      if (response.success && response.data) {
        setScreenerData(response.data);
      }
      setLoading(false);
    }
    fetchScreenerData();
  }, [exchange, base]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={Zap}
        title="Alt Screener"
        description="Scan all altcoins at once. Compare performance against USD, BTC, ETH, or SOL with visual mini charts."
      />

      {/* Exchange Selector */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/30 rounded-xl border border-border w-fit backdrop-blur-sm">
        {exchanges.map((ex) => (
          <Link key={ex.id} to={`/alt-screener?exchange=${ex.id}&base=${base}`}>
            <Button
              variant={exchange === ex.id ? 'default' : 'ghost'}
              size="lg"
              className={`rounded-lg transition-all duration-300 ${
                exchange === ex.id
                  ? 'shadow-lg shadow-primary/20'
                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe className={`mr-2 h-4 w-4 ${exchange === ex.id ? 'animate-pulse' : ''}`} />
              {ex.name}
              {exchange === ex.id && (
                <span className="ml-2 flex h-2 w-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
              )}
            </Button>
          </Link>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-card border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4 rounded-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16 mb-2" />
                  <Skeleton className="h-3 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Screener Content */}
      {!loading && screenerData && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Stats Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Altcoins
                </CardTitle>
                <Target className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display">
                  {screenerData.stats.totalAltcoins}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Scanned pairs</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Gainers</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display text-green-500">
                  {screenerData.stats.gainers}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Top: {screenerData.stats.topGainer.split('-')[0]}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Losers</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display text-red-500">
                  {screenerData.stats.losers}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Top: {screenerData.stats.topLoser.split('-')[0]}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Change
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold font-display ${
                    screenerData.stats.avgChange >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {screenerData.stats.avgChange >= 0 ? '+' : ''}
                  {screenerData.stats.avgChange.toFixed(2)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Market trend</p>
              </CardContent>
            </Card>
          </div>

          {/* Altcoin Grid (Client Component) */}
          <AltScreenerClient initialData={screenerData} exchange={exchange} initialBase={base} />
        </div>
      )}
    </div>
  );
}
