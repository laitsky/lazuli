/**
 * Homepage/Dashboard - Overview of the Lazuli trading tool
 * Displays API status, supported exchanges, and quick links
 * Revamped with improved UX: better visual hierarchy, interactive elements, and micro-interactions
 */

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LazuliAPI } from '@/lib/api-client';
import { ApiStatusIndicator } from '@/components/api-status-indicator';
import { ExchangeLogo } from '@/components/exchange-logo';
import {
  ArrowRight,
  BarChart2,
  Activity,
  Database,
  Zap,
  TrendingUp,
  LineChart,
  Layers,
  Sparkles,
} from 'lucide-react';
import { MarketTicker } from '@/components/market-ticker';
import { TopGainers } from '@/components/top-gainers';
import { TopLosers } from '@/components/top-losers';
import { Suspense } from 'react';

// Use Incremental Static Regeneration instead of force-dynamic
// Page regenerates every 60 seconds, providing fast navigation while keeping data fresh
export const revalidate = 60;

export default async function HomePage() {
  // Fetch exchanges on server-side
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success ? exchangesResponse.data : [];

  return (
    <div className="space-y-12 pb-16">
      {/* Market Ticker Strip - Full width with improved styling */}
      <div className="-mx-4 lg:-mx-8">
        <Suspense
          fallback={<div className="h-16 bg-black/20 animate-pulse border-y border-white/5" />}
        >
          <MarketTicker />
        </Suspense>
      </div>

      {/* Hero Section - Improved visual hierarchy */}
      <div className="relative py-8 md:py-16 animate-fade-in">
        {/* Background decorative elements */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-primary/15 blur-[120px] filter translate-x-1/4 -translate-y-1/4" />
          <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-blue-500/10 blur-[100px] filter -translate-x-1/4 translate-y-1/4" />
          <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] rounded-full bg-purple-500/10 blur-[80px] filter -translate-x-1/2 -translate-y-1/2" />
        </div>

        <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16">
          {/* Hero Text Content */}
          <div className="space-y-8 max-w-2xl text-center lg:text-left">
            {/* Version Badge with pulse animation */}
            <div className="inline-flex items-center gap-2 animate-delay-100 animate-fade-in">
              <Badge
                variant="outline"
                className="backdrop-blur-md border-primary/40 bg-primary/5 px-4 py-1.5 text-sm font-medium"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-primary" />
                v0.1 Alpha
              </Badge>
              <Badge
                variant="outline"
                className="backdrop-blur-md border-green-500/40 bg-green-500/5 px-3 py-1.5 text-sm text-green-500"
              >
                <span className="relative flex h-2 w-2 mr-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Live
              </Badge>
            </div>

            {/* Main Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-bold tracking-tight animate-delay-100 animate-fade-in leading-[1.1]">
              <span className="text-foreground">Trade with</span>
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-blue-400 to-purple-500">
                Precision
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg md:text-xl font-light text-muted-foreground max-w-xl animate-delay-200 animate-fade-in leading-relaxed">
              Real-time cryptocurrency data aggregation across major exchanges.
              <span className="hidden sm:inline">
                {' '}
                Unified interface for spot and perpetual markets.
              </span>
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4 animate-delay-300 animate-fade-in justify-center lg:justify-start">
              <Button
                size="lg"
                className="group h-14 px-8 text-base font-medium rounded-2xl shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
                asChild
              >
                <Link href="/markets">
                  <TrendingUp className="mr-2 h-5 w-5" />
                  Explore Markets
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="group h-14 px-8 text-base font-medium rounded-2xl glass border-white/20 hover:bg-white/10 hover:border-white/30 transition-all duration-200"
                asChild
              >
                <Link href="/multitf">
                  <LineChart className="mr-2 h-5 w-5" />
                  Multi-Timeframe
                </Link>
              </Button>
            </div>

            {/* Quick Stats Row */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 pt-4 animate-delay-300 animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="h-4 w-4 text-primary" />
                </div>
                <span>
                  <strong className="text-foreground">{exchanges.length}</strong> Exchanges
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-green-500" />
                </div>
                <span>
                  <strong className="text-foreground">Real-time</strong> Data
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <BarChart2 className="h-4 w-4 text-blue-500" />
                </div>
                <span>
                  <strong className="text-foreground">Spot & Perp</strong> Markets
                </span>
              </div>
            </div>
          </div>

          {/* Hero Visual / Top Movers Preview */}
          <div className="w-full max-w-md lg:max-w-xl animate-delay-500 animate-fade-in">
            <div className="grid grid-cols-2 gap-4">
              <Suspense
                fallback={
                  <Card className="glass border-primary/10 h-[320px] animate-pulse">
                    <CardContent className="flex items-center justify-center h-full">
                      <div className="text-muted-foreground text-sm">Loading...</div>
                    </CardContent>
                  </Card>
                }
              >
                <TopGainers />
              </Suspense>
              <Suspense
                fallback={
                  <Card className="glass border-primary/10 h-[320px] animate-pulse">
                    <CardContent className="flex items-center justify-center h-full">
                      <div className="text-muted-foreground text-sm">Loading...</div>
                    </CardContent>
                  </Card>
                }
              >
                <TopLosers />
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      {/* Status & Stats Section - Improved layout */}
      <div className="grid gap-6 lg:grid-cols-3 animate-delay-300 animate-fade-in">
        {/* System Status - Takes 2 columns on large screens */}
        <Card className="lg:col-span-2 glass border-white/10 hover:border-primary/20 transition-colors duration-300">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  System Status
                </CardTitle>
                <CardDescription>Real-time API health monitoring</CardDescription>
              </div>
              <Badge variant="outline" className="text-xs bg-background/50">
                Auto-refresh: 30s
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ApiStatusIndicator />
          </CardContent>
        </Card>

        {/* Platform Stats Card */}
        <Card className="glass border-white/10 bg-gradient-to-br from-primary/5 to-transparent hover:border-primary/20 transition-colors duration-300">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Platform Stats
            </CardTitle>
            <CardDescription>Network overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
              <span className="text-muted-foreground text-sm">Active Exchanges</span>
              <span className="font-display text-3xl font-bold text-primary">
                {exchanges.length}
              </span>
            </div>
            <div className="space-y-3">
              <span className="text-sm text-muted-foreground block">Market Types</span>
              <div className="flex gap-2">
                <Badge
                  variant="secondary"
                  className="px-4 py-2 bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20 transition-colors cursor-default"
                >
                  <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                  SPOT
                </Badge>
                <Badge
                  variant="secondary"
                  className="px-4 py-2 bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20 transition-colors cursor-default"
                >
                  <LineChart className="h-3.5 w-3.5 mr-1.5" />
                  PERP
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exchanges Grid - Improved cards with better hover states */}
      <div className="space-y-8 animate-delay-300 animate-fade-in">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-display font-bold">Supported Exchanges</h2>
            <p className="text-muted-foreground mt-1">
              Direct integration with major global exchanges
            </p>
          </div>
          <Button variant="outline" className="group rounded-xl" asChild>
            <Link href="/exchanges" className="flex items-center">
              View All Exchanges
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {exchanges.map((exchange, index) => (
            <Link
              key={exchange.id}
              href={`/markets?exchange=${exchange.id}`}
              className="group block"
            >
              <Card
                className="h-full glass border-white/10 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-1 overflow-hidden"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {/* Hover gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/0 to-primary/0 group-hover:from-primary/5 group-hover:to-transparent transition-all duration-500 pointer-events-none" />

                <CardHeader className="pb-4">
                  <div className="flex items-center gap-4">
                    {/* Exchange Logo */}
                    <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/20 transition-all duration-300">
                      <ExchangeLogo exchangeId={exchange.id} className="h-8 w-8" />
                      {/* Active indicator */}
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 border-2 border-background"></span>
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate group-hover:text-primary transition-colors">
                        {exchange.name}
                      </CardTitle>
                      <div className="flex gap-1.5 mt-1.5">
                        {exchange.hasSpot && (
                          <span className="text-[10px] font-mono text-green-500 bg-green-500/10 px-2 py-0.5 rounded-md border border-green-500/20">
                            SPOT
                          </span>
                        )}
                        {exchange.hasPerp && (
                          <span className="text-[10px] font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                            PERP
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Arrow indicator */}
                    <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:bg-primary/10 transition-all duration-300">
                      <ArrowRight className="h-5 w-5 text-primary transform -translate-x-1 group-hover:translate-x-0 transition-transform duration-300" />
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Features Grid - Improved with better icons and hover states */}
      <div className="space-y-8 animate-delay-300 animate-fade-in">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-display font-bold">Why Choose Lazuli</h2>
          <p className="text-muted-foreground mt-2">
            Built for traders who demand precision and speed
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Feature 1: Real-time Data */}
          <Card className="group glass border-white/10 hover:border-primary/20 p-6 transition-all duration-300 hover:-translate-y-1">
            <div className="space-y-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-green-500/20 to-green-500/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Zap className="h-7 w-7 text-green-500" />
              </div>
              <div>
                <h3 className="text-lg font-display font-bold group-hover:text-primary transition-colors">
                  Real-time Data
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  Live price updates from all supported exchanges with minimal latency for accurate
                  trading decisions.
                </p>
              </div>
            </div>
          </Card>

          {/* Feature 2: Unified API */}
          <Card className="group glass border-white/10 hover:border-primary/20 p-6 transition-all duration-300 hover:-translate-y-1">
            <div className="space-y-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Activity className="h-7 w-7 text-blue-500" />
              </div>
              <div>
                <h3 className="text-lg font-display font-bold group-hover:text-primary transition-colors">
                  Unified Interface
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  Normalized data structure across exchanges for a consistent trading experience
                  without switching platforms.
                </p>
              </div>
            </div>
          </Card>

          {/* Feature 3: Historical Data */}
          <Card className="group glass border-white/10 hover:border-primary/20 p-6 transition-all duration-300 hover:-translate-y-1">
            <div className="space-y-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-500/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Database className="h-7 w-7 text-purple-500" />
              </div>
              <div>
                <h3 className="text-lg font-display font-bold group-hover:text-primary transition-colors">
                  Historical Data
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  Access deep historical price action and volume data for comprehensive backtesting
                  and analysis.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Quick Links Section */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-delay-300 animate-fade-in">
        <Link href="/markets" className="group">
          <Card className="h-full glass border-white/10 hover:border-primary/30 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">
                  Markets
                </h3>
                <p className="text-sm text-muted-foreground">Browse all tickers</p>
              </div>
              <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </Card>
        </Link>

        <Link href="/multitf" className="group">
          <Card className="h-full glass border-white/10 hover:border-primary/30 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                <LineChart className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">
                  Multi-TF
                </h3>
                <p className="text-sm text-muted-foreground">Timeframe analysis</p>
              </div>
              <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </Card>
        </Link>

        <Link href="/synthetic-pair" className="group">
          <Card className="h-full glass border-white/10 hover:border-primary/30 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
                <Layers className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">
                  Synthetic
                </h3>
                <p className="text-sm text-muted-foreground">Custom pairs</p>
              </div>
              <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </Card>
        </Link>

        <Link href="/custom-index" className="group">
          <Card className="h-full glass border-white/10 hover:border-primary/30 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                <BarChart2 className="h-6 w-6 text-cyan-500" />
              </div>
              <div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">Index</h3>
                <p className="text-sm text-muted-foreground">Custom indices</p>
              </div>
              <ArrowRight className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
