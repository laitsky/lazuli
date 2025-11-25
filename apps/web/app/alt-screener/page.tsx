/**
 * Alt Screener Page - Scan all altcoins and compare performance
 *
 * This page provides a comprehensive view of all altcoins (excluding BTC)
 * allowing traders to:
 * - View all altcoins in one page with mini charts
 * - Compare performance against USD, BTC, ETH, or SOL
 * - Filter by gainers, losers, volume, and more
 * - Sort by performance, volume, price, or name
 * - Toggle between grid, list, and heatmap views
 *
 * Uses streaming SSR:
 * - Page shell renders immediately
 * - Altcoin data streams in via Suspense
 */

import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AltScreenerClient } from './client';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange, BaseCurrency } from '@lazuli/shared';
import Link from 'next/link';
import { Globe, TrendingUp, TrendingDown, BarChart3, Zap, Target } from 'lucide-react';

// Real-time data - no caching
export const dynamic = 'force-dynamic';

interface AltScreenerPageProps {
  searchParams: Promise<{
    exchange?: string;
    base?: string;
  }>;
}

/**
 * Fetch screener data from API
 */
async function fetchScreenerData(exchange: SupportedExchange, base: BaseCurrency) {
  const response = await LazuliAPI.getAltScreener(exchange, {
    base,
    limit: 200, // Get more for client-side filtering
    sortBy: 'performance',
    sortOrder: 'desc',
  });

  if (!response.success || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * ScreenerSection - Async component that fetches and displays screener data
 */
async function ScreenerSection({
  exchange,
  base,
}: {
  exchange: SupportedExchange;
  base: BaseCurrency;
}) {
  const screenerData = await fetchScreenerData(exchange, base);

  if (!screenerData) {
    return (
      <Card className="glass border-white/5">
        <CardHeader>
          <CardTitle>Error Loading Data</CardTitle>
          <CardDescription>Failed to fetch altcoin data. Please try again later.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
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

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
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

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
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

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Change</CardTitle>
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
  );
}

/**
 * Loading fallback for Suspense
 */
function ScreenerLoadingFallback() {
  return (
    <div className="space-y-6">
      {/* Stats Skeleton */}
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="glass border-white/5">
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

      {/* Controls Skeleton */}
      <div className="flex justify-between items-center">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {Array.from({ length: 20 }).map((_, i) => (
          <Card key={i} className="glass border-white/5">
            <CardContent className="p-3">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Skeleton className="h-5 w-16 mb-1" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
              <Skeleton className="h-[50px] w-full mb-2" />
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default async function AltScreenerPage({ searchParams }: AltScreenerPageProps) {
  const params = await searchParams;

  // Validate exchange
  const validExchanges = ['binance', 'bybit', 'okx'];
  const selectedExchange = params.exchange || 'binance';
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'binance';

  // Validate base currency
  const validBases = ['USD', 'BTC', 'ETH', 'SOL'];
  const selectedBase = params.base?.toUpperCase() || 'USD';
  const base = validBases.includes(selectedBase) ? (selectedBase as BaseCurrency) : 'USD';

  // Fetch exchanges list (cached)
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success
    ? exchangesResponse.data.filter((e) => e.id !== 'hyperliquid') // Exclude hyperliquid (perp only)
    : [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Alt Screener
            </h1>
          </div>
          <p className="text-lg font-light text-muted-foreground max-w-2xl">
            Scan all altcoins at once. Compare performance against USD, BTC, ETH, or SOL. Find your
            next opportunity with visual mini charts.
          </p>
        </div>
      </div>

      {/* Exchange Selector */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/30 rounded-xl border border-white/5 w-fit backdrop-blur-sm">
        {exchanges.map((ex) => (
          <Link key={ex.id} href={`/alt-screener?exchange=${ex.id}&base=${base}`}>
            <Button
              variant={exchange === ex.id ? 'default' : 'ghost'}
              size="lg"
              className={`rounded-lg transition-all duration-300 ${
                exchange === ex.id
                  ? 'shadow-lg shadow-primary/20'
                  : 'hover:bg-white/5 text-muted-foreground hover:text-foreground'
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

      {/* Screener Content */}
      <Suspense key={`${exchange}-${base}`} fallback={<ScreenerLoadingFallback />}>
        <ScreenerSection exchange={exchange} base={base} />
      </Suspense>
    </div>
  );
}
