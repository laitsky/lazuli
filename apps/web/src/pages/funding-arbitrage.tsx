/**
 * Funding Arbitrage Page - Terminal Luxe
 * Cross-exchange funding rate arbitrage opportunities
 *
 * This page displays arbitrage opportunities by comparing funding rates
 * for the same asset across multiple exchanges (Binance, Bybit, OKX, Hyperliquid).
 *
 * Strategy: Long on the exchange with lower funding (receive/pay less),
 * Short on the exchange with higher funding (receive more).
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { ArbitrageClient } from './funding-arbitrage-client';
import { LazuliAPI } from '@/lib/api-client';
import { CrossExchangeFundingResponse } from '@lazuli/shared';
import { Percent, TrendingUp, Layers, DollarSign, Activity } from 'lucide-react';

export default function FundingArbitragePage() {
  const [arbitrageData, setArbitrageData] = useState<CrossExchangeFundingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchArbitrageData() {
      setLoading(true);
      setError(null);

      try {
        const response = await LazuliAPI.getCrossExchangeFunding({ limit: 100 });

        if (response.success && response.data) {
          setArbitrageData(response.data);
        } else {
          setError('Failed to fetch arbitrage data');
        }
      } catch (err) {
        setError('Error connecting to server');
        console.error('Arbitrage fetch error:', err);
      }

      setLoading(false);
    }

    fetchArbitrageData();
  }, []);

  // Calculate summary stats from arbitrage data
  // Explicitly find max values instead of assuming array is sorted
  const stats = arbitrageData
    ? (() => {
        const opportunities = arbitrageData.arbitrageOpportunities;
        const bestSpread =
          opportunities.length > 0 ? Math.max(...opportunities.map((o) => o.spread)) : 0;
        const bestDailyYield =
          opportunities.length > 0
            ? Math.max(...opportunities.map((o) => o.estimatedDailyYield))
            : 0;

        return {
          totalOpportunities: opportunities.length,
          totalAssets: arbitrageData.count,
          bestSpread,
          bestAnnualYield: bestDailyYield * 365,
          exchanges: arbitrageData.exchanges.length,
        };
      })()
    : null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={Percent}
        title="Funding Rate Arbitrage"
        description="Capture yield by exploiting funding rate differentials across exchanges. Delta-neutral strategy for sophisticated traders."
      />

      {/* Loading State */}
      {loading && (
        <div className="space-y-6">
          {/* Stats Skeleton */}
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
          {/* Table Skeleton */}
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <Card className="bg-card border-border border-red-500/30">
          <CardContent className="py-12 text-center">
            <p className="text-red-400">{error}</p>
            <p className="text-muted-foreground text-sm mt-2">
              Please try again or check your connection.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Arbitrage Content */}
      {!loading && !error && arbitrageData && stats && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Stats Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Opportunities
                </CardTitle>
                <Activity className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display">{stats.totalOpportunities}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Active arbitrage setups (&gt;0.02% spread)
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Best Spread
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display text-green-500">
                  {stats.bestSpread.toFixed(4)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Per 8-hour funding period</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Best APY
                </CardTitle>
                <DollarSign className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display text-yellow-500">
                  {stats.bestAnnualYield.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Annualized yield (theoretical)</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Assets Tracked
                </CardTitle>
                <Layers className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display">{stats.totalAssets}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across {stats.exchanges} exchanges
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Arbitrage Table (Client Component) */}
          <ArbitrageClient initialData={arbitrageData} />
        </div>
      )}
    </div>
  );
}
