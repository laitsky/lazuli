/**
 * Homepage/Dashboard - Overview of the Lazuli trading tool
 * Displays API status, supported exchanges, and quick links
 */

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LazuliAPI } from '@/lib/api-client';
import { ApiStatusIndicator } from '@/components/api-status-indicator';
import { ExchangeLogo } from '@/components/exchange-logo';
import { ArrowRight, BarChart2, Globe, Activity, Database } from 'lucide-react';
import { MarketTicker } from '@/components/market-ticker';
import { MarketOverview } from '@/components/market-overview';
import { Suspense } from 'react';

// Use Incremental Static Regeneration instead of force-dynamic
// Page regenerates every 60 seconds, providing fast navigation while keeping data fresh
export const revalidate = 60;

export default async function HomePage() {
  // Fetch exchanges on server-side
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success ? exchangesResponse.data : [];

  return (
    <div className="space-y-8 pb-12">
      {/* Market Ticker Strip */}
      <div className="-mx-4 lg:-mx-8 mb-8">
        <Suspense>
          <MarketTicker />
        </Suspense>
      </div>

      {/* Hero Section */}
      <div className="relative space-y-8 py-12 md:py-20 animate-fade-in text-center md:text-left">
        <div className="absolute top-0 right-0 -z-10 opacity-40 pointer-events-none">
          <div className="h-[500px] w-[500px] rounded-full bg-primary/20 blur-[100px] filter" />
          <div className="absolute top-20 right-20 h-[300px] w-[300px] rounded-full bg-blue-500/20 blur-[80px] filter" />
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-12">
          <div className="space-y-6 max-w-3xl">
            <Badge
              variant="outline"
              className="animate-delay-100 animate-fade-in backdrop-blur-md border-primary/30 px-4 py-1 text-sm"
            >
              v0.1 Alpha
            </Badge>
            <h1 className="text-6xl md:text-8xl font-display font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-foreground via-foreground/90 to-foreground/50 animate-delay-100 animate-fade-in leading-[1.1]">
              Trade with <br />
              <span className="text-primary glow-text">Precision</span>
            </h1>
            <p className="text-xl md:text-2xl font-light text-muted-foreground max-w-2xl animate-delay-200 animate-fade-in leading-relaxed">
              Real-time cryptocurrency data aggregation. <br className="hidden md:block" />
              Unified interface for spot and perpetual markets.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-6 animate-delay-300 animate-fade-in justify-center md:justify-start">
              <Button
                size="lg"
                className="h-14 px-8 text-lg rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all"
                asChild
              >
                <Link href="/markets">
                  Start Trading <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-14 px-8 text-lg rounded-full glass hover:bg-white/10 border-white/10"
                asChild
              >
                <Link href="/exchanges">View Exchanges</Link>
              </Button>
            </div>
          </div>

          {/* Hero Visual / Stats Preview */}
          <div className="hidden md:block w-full max-w-md animate-delay-500 animate-fade-in">
            <Suspense>
              <MarketOverview />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Status Section */}
      <div className="grid gap-6 md:grid-cols-3 animate-delay-300 animate-fade-in">
        <Card className="md:col-span-2 glass border-primary/10 h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle>System Status</CardTitle>
                <CardDescription>Real-time API health monitoring</CardDescription>
              </div>
              <Activity className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <ApiStatusIndicator />
          </CardContent>
        </Card>

        <Card className="glass border-primary/10 bg-primary/5 h-full flex flex-col justify-center">
          <CardHeader>
            <CardTitle>Platform Stats</CardTitle>
            <CardDescription>Network overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active Exchanges</span>
              <span className="font-display text-3xl font-bold">{exchanges.length}</span>
            </div>
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground block">Market Types</span>
              <div className="flex gap-2">
                <Badge variant="secondary" className="px-3 py-1">
                  SPOT
                </Badge>
                <Badge variant="secondary" className="px-3 py-1">
                  PERP
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exchanges Grid */}
      <div className="space-y-8 animate-delay-300 animate-fade-in py-12">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl md:text-4xl font-display font-bold">Supported Exchanges</h2>
            <p className="text-muted-foreground mt-2">
              Direct integration with major global exchanges
            </p>
          </div>
          <Button variant="ghost" asChild>
            <Link href="/exchanges" className="group flex items-center">
              View All{' '}
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {exchanges.map((exchange) => (
            <Card
              key={exchange.id}
              className="group glass-hover border-white/5 overflow-hidden relative"
            >
              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="h-5 w-5 text-primary -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>

              <CardHeader>
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-transparent flex items-center justify-center text-primary border border-white/10 shadow-inner">
                    <ExchangeLogo exchangeId={exchange.id} className="h-8 w-8" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{exchange.name}</CardTitle>
                    <div className="flex gap-2 mt-1">
                      {exchange.hasSpot && (
                        <span className="text-[10px] font-mono text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded">
                          SPOT
                        </span>
                      )}
                      {exchange.hasPerp && (
                        <span className="text-[10px] font-mono text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded">
                          PERP
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full bg-white/5 hover:bg-primary hover:text-primary-foreground text-foreground transition-all duration-300"
                  variant="secondary"
                  asChild
                >
                  <Link href={`/markets?exchange=${exchange.id}`}>Trade Now</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid gap-8 md:grid-cols-3 animate-delay-300 animate-fade-in pb-12">
        <Card className="glass border-white/5 p-2">
          <CardHeader>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <BarChart2 className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Real-time Data</CardTitle>
            <CardDescription className="text-base mt-2">
              Live price updates via WebSocket connections from all supported exchanges with
              sub-millisecond latency.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="glass border-white/5 p-2">
          <CardHeader>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Unified API</CardTitle>
            <CardDescription className="text-base mt-2">
              Normalized data structure across different exchange protocols for consistent trading
              experience.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="glass border-white/5 p-2">
          <CardHeader>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Database className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Historical Data</CardTitle>
            <CardDescription className="text-base mt-2">
              Access to deep historical price action and volume data for backtesting and analysis.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
