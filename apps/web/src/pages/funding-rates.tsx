/**
 * Funding Rates Page - Terminal Luxe
 * Funding rate analytics for perpetual markets
 *
 * Uses lazy loading pattern - funding rates load first (fast),
 * cross-exchange data loads separately in background
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FundingRateClient } from './funding-rates-client';
import { PageHeader } from '@/components/page-header';
import { LazuliAPI } from '@/lib/api-client';
import {
  SupportedExchange,
  ExchangeInfo,
  FundingRateResponse,
  CrossExchangeFundingResponse,
} from '@lazuli/shared';
import { Globe, Percent, TrendingUp, TrendingDown, Scale } from 'lucide-react';

export default function FundingRatesPage() {
  const [searchParams] = useSearchParams();

  // Validate exchange (perp-enabled exchanges only)
  const validExchanges = ['binance', 'bybit', 'okx', 'hyperliquid'];
  const selectedExchange = searchParams.get('exchange') || 'binance';
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'binance';

  // Separate loading states for independent sections
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [fundingData, setFundingData] = useState<FundingRateResponse | null>(null);
  const [crossExchangeData, setCrossExchangeData] = useState<CrossExchangeFundingResponse | null>(
    null
  );
  const [loadingFunding, setLoadingFunding] = useState(true);

  // Fetch exchanges list (one-time, fast)
  useEffect(() => {
    async function fetchExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success) {
        setExchanges(response.data.filter((e) => e.hasPerp && e.id !== 'upbit'));
      }
    }
    fetchExchanges();
  }, []);

  // Fetch funding rates for selected exchange (priority - loads first)
  useEffect(() => {
    let cancelled = false;

    async function fetchFundingData() {
      setLoadingFunding(true);
      setFundingData(null);

      const fundingResponse = await LazuliAPI.getFundingRates(exchange, {
        sortBy: 'rate',
        sortOrder: 'desc',
      });

      if (!cancelled && fundingResponse.success && fundingResponse.data) {
        setFundingData(fundingResponse.data);
      }

      if (!cancelled) {
        setLoadingFunding(false);
      }
    }

    fetchFundingData();

    return () => {
      cancelled = true;
    };
  }, [exchange]);

  // Fetch cross-exchange data separately (heavy - loads in background)
  // This doesn't block the main funding rate display
  useEffect(() => {
    let cancelled = false;

    async function fetchCrossExchangeData() {
      // Reset cross-exchange data when exchange changes
      setCrossExchangeData(null);

      const crossExchangeResponse = await LazuliAPI.getCrossExchangeFunding({
        limit: 5,
      });

      if (!cancelled && crossExchangeResponse.success && crossExchangeResponse.data) {
        setCrossExchangeData(crossExchangeResponse.data);
      }
    }

    fetchCrossExchangeData();

    return () => {
      cancelled = true;
    };
  }, [exchange]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={Percent}
        title="Funding Rates"
        description="Analyze perpetual funding rates across exchanges. Find arbitrage opportunities and gauge market sentiment."
      />

      {/* Exchange Selector */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/30 rounded-xl border border-border w-fit backdrop-blur-sm">
        {exchanges.map((ex) => (
          <Link key={ex.id} to={`/funding-rates?exchange=${ex.id}`}>
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

      {/* Loading State for Funding Data */}
      {loadingFunding && (
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

      {/* Funding Content - renders as soon as funding data is ready */}
      {!loadingFunding && fundingData && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Stats Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Markets
                </CardTitle>
                <Scale className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display">
                  {fundingData.stats.totalPairs}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Perpetual markets</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Positive
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display text-green-500">
                  {fundingData.stats.positiveCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Longs pay shorts</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Negative
                </CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display text-red-500">
                  {fundingData.stats.negativeCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Shorts pay longs</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:bg-accent transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Rate
                </CardTitle>
                <Percent className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold font-display ${
                    fundingData.stats.avgFundingRate >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {fundingData.stats.avgFundingRate >= 0 ? '+' : ''}
                  {(fundingData.stats.avgFundingRate * 100).toFixed(4)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Market sentiment</p>
              </CardContent>
            </Card>
          </div>

          {/* Funding Rate Table (Client Component) */}
          {/* Cross-exchange data passed separately - will show when ready */}
          <FundingRateClient
            initialData={fundingData}
            initialCrossExchangeData={crossExchangeData}
            exchange={exchange}
          />
        </div>
      )}
    </div>
  );
}
