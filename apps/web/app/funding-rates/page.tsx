/**
 * Funding Rate Analytics Page
 *
 * This page provides comprehensive funding rate analytics for perpetual futures:
 * - Real-time funding rates from multiple exchanges
 * - Market sentiment indicators
 * - Cross-exchange comparison for arbitrage opportunities
 * - Educational content explaining funding rates
 *
 * What is Funding Rate?
 * Funding rate is a periodic payment mechanism in perpetual futures contracts
 * designed to keep the contract price close to the spot price.
 *
 * - Positive funding: Longs pay shorts (bullish sentiment)
 * - Negative funding: Shorts pay longs (bearish sentiment)
 *
 * How Traders Use Funding Rates:
 * 1. ARBITRAGE: Long spot + short perp when funding is positive
 * 2. SENTIMENT: Extreme funding often precedes market reversals
 * 3. CROSS-EXCHANGE: Compare rates across exchanges for arbitrage
 */

import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FundingRateClient } from './client';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI } from '@/lib/api-client';
import { SupportedExchange } from '@lazuli/shared';
import Link from 'next/link';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  Scale,
  Percent,
  BarChart3,
  Info,
  BookOpen,
  ArrowRight,
  Lightbulb,
  AlertTriangle,
  DollarSign,
} from 'lucide-react';

// Real-time data - no caching
export const dynamic = 'force-dynamic';

interface FundingRatePageProps {
  searchParams: Promise<{
    exchange?: string;
  }>;
}

/**
 * Fetch funding rate data from API
 */
async function fetchFundingData(exchange: SupportedExchange) {
  const [fundingResponse, crossExchangeResponse] = await Promise.all([
    LazuliAPI.getFundingRates(exchange, { limit: 200, sortBy: 'rate', sortOrder: 'desc' }),
    LazuliAPI.getCrossExchangeFunding({ limit: 50 }),
  ]);

  return {
    funding: fundingResponse.success ? fundingResponse.data : null,
    crossExchange: crossExchangeResponse.success ? crossExchangeResponse.data : null,
  };
}

/**
 * FundingSection - Async component that fetches and displays funding data
 */
async function FundingSection({ exchange }: { exchange: SupportedExchange }) {
  const { funding, crossExchange } = await fetchFundingData(exchange);

  if (!funding) {
    return (
      <Card className="glass border-white/5">
        <CardHeader>
          <CardTitle>Error Loading Data</CardTitle>
          <CardDescription>Failed to fetch funding rate data. Please try again later.</CardDescription>
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
              Total Contracts
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{funding.stats.totalPairs}</div>
            <p className="text-xs text-muted-foreground mt-1">Perpetual pairs analyzed</p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Funding Rate
            </CardTitle>
            <Percent className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-display font-mono ${
                funding.stats.avgFundingPercent >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {funding.stats.avgFundingPercent >= 0 ? '+' : ''}
              {funding.stats.avgFundingPercent.toFixed(4)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {funding.stats.avgFundingPercent >= 0 ? 'Longs paying shorts' : 'Shorts paying longs'}
            </p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Highest Funding
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-green-400 font-mono">
              +{funding.stats.highestFunding.percent.toFixed(4)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {funding.stats.highestFunding.symbol.replace('.P', '')}
            </p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Lowest Funding
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-red-400 font-mono">
              {funding.stats.lowestFunding.percent.toFixed(4)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {funding.stats.lowestFunding.symbol.replace('.P', '')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Client Component with Interactive Features */}
      <FundingRateClient
        initialData={funding}
        initialCrossExchangeData={crossExchange}
        exchange={exchange}
      />
    </div>
  );
}

/**
 * Loading fallback for Suspense
 */
function FundingLoadingFallback() {
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
              <Skeleton className="h-8 w-24 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sentiment Banner Skeleton */}
      <Card className="glass border-white/5">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table Skeleton */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function FundingRatePage({ searchParams }: FundingRatePageProps) {
  const params = await searchParams;

  // Validate exchange
  const validExchanges = ['binance', 'bybit', 'okx', 'hyperliquid'];
  const selectedExchange = params.exchange || 'binance';
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'binance';

  // Fetch exchanges list (cached)
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success
    ? exchangesResponse.data.filter((e) => e.hasPerp) // Only exchanges with perpetual markets
    : [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={Percent}
        title="Funding Rate Analytics"
        description="Monitor funding rates across perpetual markets. Identify sentiment shifts and arbitrage opportunities."
      />

      {/* Educational Card */}
      <Card className="glass border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-primary/20 p-2">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <h3 className="font-display font-semibold">What is Funding Rate?</h3>
              <p className="text-sm text-muted-foreground">
                Funding rate is a periodic payment between long and short traders in perpetual futures.
                It keeps contract prices aligned with spot prices.
              </p>
              <div className="grid gap-3 sm:grid-cols-3 mt-3">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <TrendingUp className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-green-400">Positive Rate</div>
                    <div className="text-xs text-muted-foreground">
                      Longs pay shorts. More buyers than sellers.
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <TrendingDown className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-red-400">Negative Rate</div>
                    <div className="text-xs text-muted-foreground">
                      Shorts pay longs. More sellers than buyers.
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <DollarSign className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-primary">Arbitrage</div>
                    <div className="text-xs text-muted-foreground">
                      Long spot + short perp to earn funding.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exchange Selector */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/30 rounded-xl border border-white/5 w-fit backdrop-blur-sm">
        {exchanges.map((ex) => (
          <Link key={ex.id} href={`/funding-rates?exchange=${ex.id}`}>
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

      {/* Funding Content */}
      <Suspense key={exchange} fallback={<FundingLoadingFallback />}>
        <FundingSection exchange={exchange} />
      </Suspense>

      {/* Trading Strategy Tips */}
      <Card className="glass border-white/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            How to Use Funding Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="p-4 rounded-lg bg-accent/30 border border-border">
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <Scale className="h-4 w-4 text-primary" />
                Cash & Carry Arbitrage
              </h4>
              <p className="text-sm text-muted-foreground">
                When funding is high positive, buy spot and short perpetual. You stay delta-neutral
                while collecting funding payments every 8 hours.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-accent/30 border border-border">
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Sentiment Reversal Signal
              </h4>
              <p className="text-sm text-muted-foreground">
                Extreme funding rates often precede reversals. Very high positive funding may signal
                a top, while very negative funding may signal a bottom.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-accent/30 border border-border">
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <ArrowRight className="h-4 w-4 text-blue-500" />
                Cross-Exchange Arbitrage
              </h4>
              <p className="text-sm text-muted-foreground">
                Different exchanges have different funding rates. Long on the exchange with lower
                funding, short on the exchange with higher funding to capture the spread.
              </p>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong className="text-yellow-500">Risk Warning:</strong> Funding rate strategies
                involve risks including liquidation, funding rate changes, and execution slippage.
                This is for educational purposes only and not financial advice.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
