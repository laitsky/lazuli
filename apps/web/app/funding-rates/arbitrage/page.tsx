/**
 * Funding Rate Arbitrage Opportunities Page
 *
 * Dedicated page for viewing and analyzing cross-exchange funding rate arbitrage opportunities.
 * Shows detailed comparisons of funding rates across exchanges to help traders identify
 * profitable arbitrage strategies.
 *
 * Arbitrage Strategy:
 * 1. When funding rates differ significantly between exchanges
 * 2. Go LONG on the exchange with lower funding (receive funding)
 * 3. Go SHORT on the exchange with higher funding (pay less or receive)
 * 4. Net position is neutral, but you earn the funding rate spread
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  TrendingUp,
  Scale,
  AlertTriangle,
  Zap,
  DollarSign,
  BarChart3,
  Clock,
} from 'lucide-react';
import { LazuliAPI } from '@/lib/api-client';
import { ArbitrageClient } from './client';

export const metadata: Metadata = {
  title: 'Funding Rate Arbitrage | Lazuli',
  description:
    'Discover cross-exchange funding rate arbitrage opportunities. Compare funding rates across Binance, Bybit, OKX, and Hyperliquid.',
};

/**
 * Loading skeleton for the arbitrage section
 */
function ArbitrageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="glass border-white/5">
            <CardHeader className="pb-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="glass border-white/5">
        <CardHeader>
          <div className="h-6 w-48 bg-muted animate-pulse rounded" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Fetch cross-exchange funding data
 */
async function fetchArbitrageData() {
  try {
    const response = await LazuliAPI.getCrossExchangeFunding({ limit: 100 });
    return response.success ? response.data : null;
  } catch (error) {
    console.error('Error fetching arbitrage data:', error);
    return null;
  }
}

/**
 * ArbitrageSection - Async component that fetches and displays arbitrage data
 */
async function ArbitrageSection() {
  const data = await fetchArbitrageData();

  if (!data) {
    return (
      <Card className="glass border-white/5">
        <CardHeader>
          <CardTitle>Error Loading Data</CardTitle>
          <CardDescription>
            Failed to fetch arbitrage data. Please try again later.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Calculate stats
  const totalOpportunities = data.arbitrageOpportunities.length;
  const avgSpread =
    totalOpportunities > 0
      ? data.arbitrageOpportunities.reduce((sum, opp) => sum + opp.spread, 0) / totalOpportunities
      : 0;
  const bestOpportunity = data.arbitrageOpportunities[0];
  const totalDailyYield =
    totalOpportunities > 0
      ? data.arbitrageOpportunities.reduce((sum, opp) => sum + opp.estimatedDailyYield, 0)
      : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Opportunities Found
            </CardTitle>
            <Zap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{totalOpportunities}</div>
            <p className="text-xs text-muted-foreground mt-1">Across {data.exchanges.length} exchanges</p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Average Spread
            </CardTitle>
            <Scale className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-blue-400">
              {avgSpread.toFixed(4)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">Per funding period (8h)</p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Best Opportunity
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-green-400">
              {bestOpportunity ? `${bestOpportunity.spread.toFixed(4)}%` : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {bestOpportunity ? bestOpportunity.asset : 'No opportunities'}
            </p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5 hover:bg-white/5 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Est. Daily Yield
            </CardTitle>
            <DollarSign className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-yellow-400">
              {(totalDailyYield / Math.max(totalOpportunities, 1)).toFixed(3)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">Average per opportunity</p>
          </CardContent>
        </Card>
      </div>

      {/* Client component with interactive features */}
      <ArbitrageClient initialData={data} />
    </div>
  );
}

/**
 * Main Arbitrage Page Component
 */
export default function ArbitragePage() {
  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/funding-rates">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <h1 className="text-3xl font-bold font-display tracking-tight">
              Funding Rate Arbitrage
            </h1>
          </div>
          <p className="text-muted-foreground">
            Cross-exchange funding rate spreads for delta-neutral arbitrage strategies
          </p>
        </div>
      </div>

      {/* Educational Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" />
              What is Funding Arbitrage?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Exploit funding rate differences between exchanges by holding opposite positions.
              Your net exposure is zero, but you earn the spread.
            </p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              The Strategy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              <strong>Long</strong> on low-funding exchange (receive payments).{' '}
              <strong>Short</strong> on high-funding exchange (pay less or receive).
            </p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-400" />
              Funding Intervals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Most exchanges settle funding every 8 hours (3x daily). Hyperliquid settles hourly
              (24x daily). Factor this into yield calculations.
            </p>
          </CardContent>
        </Card>

        <Card className="glass border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              Risks to Consider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Exchange risk, liquidation risk, funding rate changes, withdrawal delays, and
              execution slippage can affect profitability.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Suspense fallback={<ArbitrageSkeleton />}>
        <ArbitrageSection />
      </Suspense>
    </div>
  );
}
