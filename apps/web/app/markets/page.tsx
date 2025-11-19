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

  return {
    exchange,
    tickers: allTickers,
    count: allTickers.length,
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
      <Card>
        <CardHeader>
          <CardTitle>No Tickers Available</CardTitle>
          <CardDescription>No ticker data found for this exchange.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      {/* Stats */}
      <Card>
        <CardHeader>
          <CardTitle>
            {tickersData.exchange.charAt(0).toUpperCase() + tickersData.exchange.slice(1)} Market
            Overview
          </CardTitle>
          <CardDescription>
            Last updated: {new Date().toLocaleTimeString()} • Showing all {tickersData.count}{' '}
            tickers (sorted by volume)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-sm font-extralight text-muted-foreground">Total Tickers</p>
              <p className="text-3xl font-display font-bold">{tickersData.count}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-extralight text-muted-foreground">Spot Markets</p>
              <p className="text-3xl font-display font-bold">
                {tickersData.tickers.filter((t) => t.type === 'spot').length}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-extralight text-muted-foreground">Perpetual Markets</p>
              <p className="text-3xl font-display font-bold">
                {tickersData.tickers.filter((t) => t.type === 'perp').length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tickers Table */}
      <TickersTable tickers={tickersData.tickers} exchange={tickersData.exchange} />
    </>
  );
}

/**
 * TickersLoadingFallback - Loading skeleton shown while tickers are fetching
 */
function TickersLoadingFallback() {
  return (
    <>
      <Card>
        <CardHeader>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-16" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-16" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-16" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-12">
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default async function TickersPage({ searchParams }: TickersPageProps) {
  const params = await searchParams;
  const selectedExchange = params.exchange || 'binance';

  // Validate exchange
  const validExchanges = ['binance', 'bybit', 'okx'];
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as any)
    : 'binance';

  // Only fetch exchanges list for page shell - it's cached and loads instantly
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success ? exchangesResponse.data : [];

  return (
    <div className="space-y-6">
      {/* Header - renders immediately */}
      <div className="space-y-2">
        <h1 className="text-5xl font-display font-bold tracking-tight">Markets</h1>
        <p className="text-lg font-light text-muted-foreground">
          Real-time cryptocurrency price data and market statistics
        </p>
      </div>

      {/* Exchange Selector - renders immediately */}
      <Card>
        <CardHeader>
          <CardTitle>Select Exchange</CardTitle>
          <CardDescription>Choose an exchange to view tickers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {exchanges.map((ex) => (
              <Link key={ex.id} href={`/markets?exchange=${ex.id}`}>
                <Button variant={exchange === ex.id ? 'default' : 'outline'} size="lg">
                  {ex.name}
                  {exchange === ex.id && (
                    <Badge variant="secondary" className="ml-2">
                      Active
                    </Badge>
                  )}
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tickers Data - streams in via Suspense, showing loading skeleton while fetching */}
      <Suspense key={exchange} fallback={<TickersLoadingFallback />}>
        <TickersSection exchange={exchange} />
      </Suspense>
    </div>
  );
}
