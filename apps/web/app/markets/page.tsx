/**
 * Markets Page - Display real-time ticker data from exchanges
 * Supports filtering by exchange and searching symbols
 *
 * Uses streaming SSR:
 * - Page shell (header + exchange selector) renders immediately
 * - Tickers data streams in separately via Suspense
 */

import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TickersTable } from '@/components/tickers-table';
import { LazuliAPI } from '@/lib/api-client';
import { Ticker, SupportedExchange } from '@lazuli/shared';
import Link from 'next/link';
import { BarChart3, Globe, Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';

// Allow partial caching - exchanges list is cached, tickers are fetched fresh
// This enables fast page navigation while keeping ticker data real-time
export const dynamic = 'auto';

interface TickersPageProps {
  searchParams: Promise<{ exchange?: string }>;
}

/**
 * Fetch all tickers from all pages without any limit
 * Continues fetching until all pages are retrieved
 */
async function fetchAllTickers(exchange: SupportedExchange) {
  const allTickers: Ticker[] = [];
  let currentPage = 1;
  let hasMorePages = true;
  const pageLimit = 500; // Maximum allowed by backend

  while (hasMorePages) {
    const response = await LazuliAPI.getTickers(exchange, {
      page: currentPage,
      limit: pageLimit,
      sortBy: 'volume',
      sortOrder: 'desc',
    });

    if (!response.success || !response.data) {
      // If any page fails, return what we have so far
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

  // Deduplicate tickers by symbol to prevent React key errors
  // This is especially important for Hyperliquid which may return duplicates
  const uniqueTickers = Array.from(new Map(allTickers.map((t) => [t.symbol, t])).values());

  return {
    exchange,
    tickers: uniqueTickers,
    count: uniqueTickers.length,
  };
}

/**
 * TickersSection - Async component that fetches and displays tickers
 * Wrapped in Suspense to enable streaming SSR
 */
async function TickersSection({ exchange }: { exchange: SupportedExchange }) {
  const tickersData = await fetchAllTickers(exchange);

  if (!tickersData || tickersData.tickers.length === 0) {
    return (
      <Card className="glass border-white/5">
        <CardHeader>
          <CardTitle>No Tickers Available</CardTitle>
          <CardDescription>No ticker data found for this exchange.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Calculate aggregate stats
  const spotCount = tickersData.tickers.filter((t) => t.type === 'spot').length;
  const perpCount = tickersData.tickers.filter((t) => t.type === 'perp').length;
  const totalVolume = tickersData.tickers.reduce((acc, t) => acc + (t.quoteVolume24h || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Tickers
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{tickersData.count}</div>
            <p className="text-xs text-muted-foreground mt-1">Active trading pairs</p>
          </CardContent>
        </Card>
        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Spot Markets
            </CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{spotCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Traditional trading pairs</p>
          </CardContent>
        </Card>
        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Perpetual Markets
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{perpCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Futures contracts</p>
          </CardContent>
        </Card>
      </div>

      {/* Tickers Table */}
      <TickersTable tickers={tickersData.tickers} exchange={tickersData.exchange} />
    </div>
  );
}

/**
 * TickersLoadingFallback - Loading skeleton shown while tickers are fetching
 */
function TickersLoadingFallback() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
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
      <Card className="glass border-white/5">
        <CardContent className="py-12">
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-12 w-full" />
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function TickersPage({ searchParams }: TickersPageProps) {
  const params = await searchParams;
  const selectedExchange = params.exchange || 'binance';

  // Validate exchange - include all supported exchanges
  const validExchanges = ['binance', 'bybit', 'okx', 'hyperliquid'];
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'binance';

  // Only fetch exchanges list for page shell - it's cached and loads instantly
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success ? exchangesResponse.data : [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-background to-background border border-white/10 p-8">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10">
          <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight mb-2">
            Markets
          </h1>
          <p className="text-lg font-light text-muted-foreground max-w-2xl">
            Real-time cryptocurrency price data and market statistics across major exchanges.
          </p>
        </div>
      </div>

      {/* Exchange Selector */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/30 rounded-xl border border-white/5 w-fit backdrop-blur-sm">
        {exchanges.map((ex) => (
          <Link key={ex.id} href={`/markets?exchange=${ex.id}`}>
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

      {/* Tickers Data - streams in via Suspense, showing loading skeleton while fetching */}
      <Suspense key={exchange} fallback={<TickersLoadingFallback />}>
        <TickersSection exchange={exchange} />
      </Suspense>
    </div>
  );
}
