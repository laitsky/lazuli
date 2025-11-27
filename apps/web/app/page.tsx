/**
 * Homepage - Terminal Luxe Dashboard
 *
 * A refined, data-focused landing page with:
 * - Live market ticker with elegant scrolling
 * - Key metrics displayed prominently
 * - Clean grid layout with asymmetric visual interest
 * - Warm amber accents against deep obsidian
 */

import Link from 'next/link';
import { LazuliAPI } from '@/lib/api-client';
import { ApiStatusIndicator } from '@/components/api-status-indicator';
import { ExchangeLogo } from '@/components/exchange-logo';
import {
  ArrowRight,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  BarChart3,
  Layers,
} from 'lucide-react';
import { MarketTicker } from '@/components/market-ticker';
import { TopGainers } from '@/components/top-gainers';
import { TopLosers } from '@/components/top-losers';
import { Suspense } from 'react';

// ISR - regenerate every 60 seconds
export const revalidate = 60;

export default async function HomePage() {
  const exchangesResponse = await LazuliAPI.getExchanges();
  const exchanges = exchangesResponse.success ? exchangesResponse.data : [];

  return (
    <div className="space-y-8 pb-16">
      {/* Market Ticker Strip */}
      <div className="-mx-4 lg:-mx-8 -mt-8 lg:mt-0">
        <Suspense fallback={<div className="h-12 bg-card border-b border-border animate-pulse" />}>
          <MarketTicker />
        </Suspense>
      </div>

      {/* Hero Section - Asymmetric Layout */}
      <section className="relative pt-8 lg:pt-16">
        {/* Subtle gradient orb */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />

        <div className="relative grid lg:grid-cols-[1fr,420px] gap-12 lg:gap-16 items-start">
          {/* Left Column - Headlines */}
          <div className="space-y-8">
            {/* Status Badge */}
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border text-xs font-mono uppercase tracking-wider text-muted-foreground">
                <span className="status-dot status-online" />
                Live Data
              </span>
              <span className="px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono uppercase tracking-wider text-primary">
                v0.1 Alpha
              </span>
            </div>

            {/* Main Headline */}
            <div className="space-y-4">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-bold tracking-tight leading-[1.05]">
                <span className="text-foreground">Command the</span>
                <br />
                <span className="gradient-text">Hidden Markets</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                The unified, high-performance market intelligence platform for the sovereign trader.
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-3">
              <Link
                href="/markets"
                className="group inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
              >
                <TrendingUp className="h-4 w-4" />
                Explore Markets
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/multitf"
                className="group inline-flex items-center gap-2 px-6 py-3 bg-card border border-border text-foreground rounded-lg font-medium text-sm hover:bg-accent hover:border-primary/30 transition-colors"
              >
                <BarChart3 className="h-4 w-4" />
                Multi-Timeframe
              </Link>
            </div>

            {/* Quick Stats */}
            <div className="flex flex-wrap items-center gap-6 pt-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="h-4 w-4 text-primary" />
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-foreground">{exchanges.length}</span>
                  <span className="text-muted-foreground ml-1">Exchanges</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-[hsl(152_60%_45%/0.1)] flex items-center justify-center">
                  <Zap className="h-4 w-4 text-[hsl(152_60%_45%)]" />
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-foreground">Real-time</span>
                  <span className="text-muted-foreground ml-1">Data</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-foreground">Spot & Perp</span>
                  <span className="text-muted-foreground ml-1">Markets</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Top Movers Grid */}
          <div className="grid grid-cols-2 gap-3">
            <Suspense
              fallback={
                <div className="col-span-1 h-[300px] bg-card rounded-xl border border-border animate-pulse" />
              }
            >
              <TopGainers />
            </Suspense>
            <Suspense
              fallback={
                <div className="col-span-1 h-[300px] bg-card rounded-xl border border-border animate-pulse" />
              }
            >
              <TopLosers />
            </Suspense>
          </div>
        </div>
      </section>

      {/* Status & Stats Section */}
      <section className="grid lg:grid-cols-3 gap-4">
        {/* System Status - Wide */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-display font-semibold">System Status</h2>
            </div>
            <span className="text-xs font-mono text-muted-foreground">Auto-refresh: 30s</span>
          </div>
          <ApiStatusIndicator />
        </div>

        {/* Platform Stats - Narrow */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-display font-semibold">Platform</h2>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <span className="text-sm text-muted-foreground">Active Exchanges</span>
              <span className="text-2xl font-display font-bold text-primary">
                {exchanges.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[hsl(152_60%_45%/0.1)] border border-[hsl(152_60%_45%/0.2)] text-xs font-mono text-[hsl(152_60%_50%)]">
                <TrendingUp className="h-3 w-3" />
                SPOT
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20 text-xs font-mono text-primary">
                <BarChart3 className="h-3 w-3" />
                PERP
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Exchanges Grid */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-display font-bold">Exchanges</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Direct integration with major global exchanges
            </p>
          </div>
          <Link
            href="/exchanges"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            View All
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {exchanges.map((exchange, index) => (
            <Link
              key={exchange.id}
              href={`/markets?exchange=${exchange.id}`}
              className="group block"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="relative bg-card rounded-xl border border-border p-4 card-terminal-hover overflow-hidden">
                {/* Hover gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                <div className="relative flex items-center gap-4">
                  {/* Exchange Logo */}
                  <div className="relative h-12 w-12 rounded-lg bg-secondary flex items-center justify-center border border-border group-hover:border-primary/30 transition-colors">
                    <ExchangeLogo exchangeId={exchange.id} className="h-7 w-7" />
                    {/* Online indicator */}
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[hsl(152_60%_45%)] opacity-75 animate-ping" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[hsl(152_60%_45%)]" />
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {exchange.name}
                    </h3>
                    <div className="flex gap-1.5 mt-1">
                      {exchange.hasSpot && (
                        <span className="text-[10px] font-mono text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)] px-1.5 py-0.5 rounded">
                          SPOT
                        </span>
                      )}
                      {exchange.hasPerp && (
                        <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          PERP
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all -translate-x-2 group-hover:translate-x-0" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="space-y-6">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="text-2xl font-display font-bold">Why Lazuli</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Built for traders who demand precision and speed
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {/* Feature 1 */}
          <div className="group bg-card rounded-xl border border-border p-6 card-terminal-hover">
            <div className="h-12 w-12 rounded-lg bg-[hsl(152_60%_45%/0.1)] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
              <Zap className="h-6 w-6 text-[hsl(152_60%_45%)]" />
            </div>
            <h3 className="font-display font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
              Real-time Data
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Live price updates from all supported exchanges with minimal latency for accurate
              trading decisions.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group bg-card rounded-xl border border-border p-6 card-terminal-hover">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-display font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
              Unified Interface
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Normalized data structure across exchanges for a consistent experience without
              switching platforms.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group bg-card rounded-xl border border-border p-6 card-terminal-hover">
            <div className="h-12 w-12 rounded-lg bg-secondary flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
              <BarChart3 className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="font-display font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
              Deep Analysis
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Multi-timeframe charts, custom indices, and advanced indicators for comprehensive
              market analysis.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Links Section */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickLinkCard
          href="/markets"
          icon={TrendingUp}
          title="Markets"
          description="Browse all tickers"
          color="primary"
        />
        <QuickLinkCard
          href="/multitf"
          icon={BarChart3}
          title="Multi-TF"
          description="Timeframe analysis"
          color="muted"
        />
        <QuickLinkCard
          href="/synthetic-pair"
          icon={Layers}
          title="Synthetic"
          description="Custom pairs"
          color="muted"
        />
        <QuickLinkCard
          href="/custom-index"
          icon={Activity}
          title="Index"
          description="Build indices"
          color="muted"
        />
      </section>
    </div>
  );
}

/**
 * Quick Link Card Component
 */
function QuickLinkCard({
  href,
  icon: Icon,
  title,
  description,
  color,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  color: 'primary' | 'muted';
}) {
  return (
    <Link href={href} className="group block">
      <div className="bg-card rounded-xl border border-border p-4 card-terminal-hover">
        <div className="flex items-center gap-3">
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              color === 'primary' ? 'bg-primary/10' : 'bg-secondary'
            } group-hover:bg-primary/10 transition-colors`}
          >
            <Icon
              className={`h-5 w-5 ${
                color === 'primary' ? 'text-primary' : 'text-muted-foreground'
              } group-hover:text-primary transition-colors`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors">
              {title}
            </h3>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all -translate-x-2 group-hover:translate-x-0" />
        </div>
      </div>
    </Link>
  );
}
