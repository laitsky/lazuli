/**
 * Dashboard — live operational cockpit
 *
 * Replaces the old marketing landing. Every panel shows real data:
 *  - KPI strip (4 cards): volume, gainers/losers, top exchange, opportunities
 *  - Top Movers (gainers + losers tabs)
 *  - Market Sentiment (funding heatmap)
 *  - Arbitrage Feed (live cross-exchange opportunities)
 *  - Watchlist (user's starred symbols, or default BTC/ETH/SOL)
 *
 * Data sources: TanStack Query hooks. URL state: none (this is the dashboard).
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Flame, Radar, Star, TrendingDown, TrendingUp } from 'lucide-react';
import type { Ticker, PriceArbitrageOpportunity, FundingSentiment } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { PriceText, ChangeText } from '@/components/ui/price-text';
import { Tag } from '@/components/ui/tag';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import {
  useAllTickers,
  useFundingRates,
  usePriceArbitrage,
  useTicker,
  useExchanges,
  useHealth,
} from '@/lib/queries';
import { usePreferences, parseWatchlistKey } from '@/lib/preferences';
import { formatVolume } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const DEFAULT_WATCH = ['bybit:BTC-USDT', 'bybit:ETH-USDT', 'bybit:SOL-USDT'];

export default function HomePage() {
  const { watchlist } = usePreferences();
  const watchKeys = watchlist.length > 0 ? watchlist.slice(0, 6) : DEFAULT_WATCH;

  // KPIs
  const { data: exchangesData } = useExchanges();
  const { data: health } = useHealth();
  const bybitTickers = useAllTickers('bybit', {
    quote: 'USDT',
    sortBy: 'volume',
    sortOrder: 'desc',
  });
  const arbitrage = usePriceArbitrage({ limit: 8 });
  const funding = useFundingRates('bybit', { limit: 100 });

  // Aggregate stats from bybit tickers (proxy for market-wide)
  const stats = useMemo(() => {
    if (!bybitTickers.data) {
      return {
        volume: 0,
        gainers: 0,
        losers: 0,
        topGainer: null as Ticker | null,
        topLoser: null as Ticker | null,
      };
    }
    const all = bybitTickers.data.pages.flatMap((p) => p.data.tickers);
    const usdt = all.filter((t) => t.symbol.includes('USDT') && t.percentage24h !== null);
    const volume = all.reduce((sum, t) => sum + (t.quoteVolume24h ?? 0), 0);
    const sorted = [...usdt].sort((a, b) => (b.percentage24h ?? 0) - (a.percentage24h ?? 0));
    return {
      volume,
      gainers: usdt.filter((t) => (t.percentage24h ?? 0) > 0).length,
      losers: usdt.filter((t) => (t.percentage24h ?? 0) < 0).length,
      topGainer: sorted[0] ?? null,
      topLoser: sorted[sorted.length - 1] ?? null,
    };
  }, [bybitTickers.data]);

  const arbitrageFreshness = arbitrage.data?.meta;
  const exchanges = exchangesData?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Live market pulse across supported exchanges."
        freshnessMeta={arbitrageFreshness ?? null}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel>
          <Metric label="24h Volume" value={`$${formatVolume(stats.volume)}`} mono size="lg" />
          <p className="mt-1 text-[11px] text-muted-foreground">Bybit USDT pairs (proxy)</p>
        </Panel>

        <Panel>
          <Metric
            label="Market Breadth"
            value={
              <span className="flex items-baseline gap-1.5">
                <span className="text-up">{stats.gainers}</span>
                <span className="text-muted-foreground text-base">/</span>
                <span className="text-down">{stats.losers}</span>
              </span>
            }
            mono={false}
            size="lg"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Gainers / losers (24h)</p>
        </Panel>

        <Panel>
          <Metric
            label="Opportunities"
            value={(arbitrage.data?.data.opportunities?.length ?? 0).toString()}
            mono
            size="lg"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Active cross-exchange spreads</p>
        </Panel>

        <Panel>
          <Metric
            label="Exchanges"
            value={exchanges.filter((e) => e.supported).length.toString()}
            mono
            size="lg"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                health?.api === 'ready' ? 'bg-success animate-blink-soft' : 'bg-destructive'
              )}
            />
            <p className="text-[11px] text-muted-foreground">
              {health?.api === 'ready' ? 'API operational' : 'API offline'}
            </p>
          </div>
        </Panel>
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-12 gap-4">
        {/* Top Movers — large */}
        <Panel className="lg:col-span-8" flush>
          <PanelHeader className="px-5 pt-5 mb-0">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-accent" aria-hidden />
              <PanelTitle>Top Movers</PanelTitle>
            </div>
            <Link
              to="/markets"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              All markets <ArrowRight className="inline h-3 w-3 ml-0.5" aria-hidden />
            </Link>
          </PanelHeader>

          {bybitTickers.isLoading ? (
            <Skeleton className="m-5 h-64" />
          ) : (
            <Tabs defaultValue="gainers" className="p-5 pt-2">
              <TabsList>
                <TabsTrigger value="gainers">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Gainers
                </TabsTrigger>
                <TabsTrigger value="losers">
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden /> Losers
                </TabsTrigger>
              </TabsList>

              <TabsContent value="gainers">
                <MoverList tickers={bybitTickers.data} sortDir="desc" />
              </TabsContent>
              <TabsContent value="losers">
                <MoverList tickers={bybitTickers.data} sortDir="asc" />
              </TabsContent>
            </Tabs>
          )}
        </Panel>

        {/* Sentiment + Arbitrage — narrow column */}
        <div className="lg:col-span-4 space-y-4">
          {/* Sentiment panel */}
          <Panel>
            <PanelHeader>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" aria-hidden />
                <PanelTitle>Market Sentiment</PanelTitle>
              </div>
              {funding.data && <FreshnessBadge meta={funding.data ? null : null} />}
            </PanelHeader>
            {funding.isLoading ? (
              <Skeleton className="h-32" />
            ) : funding.data?.data ? (
              <SentimentPanel data={funding.data.data} />
            ) : (
              <EmptyState title="No funding data" compact />
            )}
          </Panel>

          {/* Arbitrage feed */}
          <Panel flush>
            <PanelHeader className="px-5 pt-5 mb-0">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-accent" aria-hidden />
                <PanelTitle>Arbitrage Feed</PanelTitle>
              </div>
              <Link
                to="/price-arbitrage"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all <ArrowRight className="inline h-3 w-3 ml-0.5" aria-hidden />
              </Link>
            </PanelHeader>
            <div className="p-5 pt-3">
              {arbitrage.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : (
                <ArbitrageFeed opportunities={arbitrage.data?.data.opportunities ?? []} />
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* Watchlist */}
      <Panel flush>
        <PanelHeader className="px-5 pt-5 mb-0">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-accent" aria-hidden />
            <PanelTitle>Watchlist</PanelTitle>
          </div>
          {watchlist.length === 0 && (
            <span className="text-[11px] text-muted-foreground">
              Star symbols in Markets to add them here
            </span>
          )}
        </PanelHeader>
        <div className="p-5 pt-3">
          <WatchlistItems keys={watchKeys} />
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function MoverList({
  tickers,
  sortDir,
}: {
  tickers: ReturnType<typeof useAllTickers>['data'];
  sortDir: 'asc' | 'desc';
}) {
  const movers = useMemo(() => {
    if (!tickers) return [];
    const all = tickers.pages.flatMap((p) => p.data.tickers);
    const usdt = all.filter(
      (t) =>
        t.symbol.includes('USDT') && t.percentage24h !== null && (t.quoteVolume24h ?? 0) > 1_000_000
    );
    return [...usdt]
      .sort((a, b) =>
        sortDir === 'desc'
          ? (b.percentage24h ?? 0) - (a.percentage24h ?? 0)
          : (a.percentage24h ?? 0) - (b.percentage24h ?? 0)
      )
      .slice(0, 7);
  }, [tickers, sortDir]);

  if (movers.length === 0) {
    return <EmptyState title="No data" compact />;
  }

  return (
    <ul className="divide-y divide-border -mx-1">
      {movers.map((t, idx) => (
        <li key={t.symbol}>
          <Link
            to={`/workspace?exchange=${t.exchange}&symbol=${t.symbol}&type=${t.type}&timeframe=1h`}
            className={cn(
              'flex items-center justify-between gap-3 px-1 py-2',
              'hover:bg-surface-2 -mx-1 px-2 rounded transition-colors'
            )}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="numeric text-[10px] text-muted-foreground w-5 text-right">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground text-sm truncate">
                  {t.symbol.replace('-USDT', '/USDT').replace('.P', ' PERP')}
                </div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">
                  {t.exchange} · ${formatVolume(t.quoteVolume24h ?? 0)}
                </div>
              </div>
            </div>
            <PriceText value={t.last} size="sm" inlineChange={false} />
            <ChangeText value={t.percentage24h} size="sm" className="w-20 text-right" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SentimentPanel({
  data,
}: {
  data: NonNullable<ReturnType<typeof useFundingRates>['data']>['data'];
}) {
  const stats = data.stats;
  const sentiment: FundingSentiment = stats?.marketSentiment ?? 'neutral';

  const sentimentLabels: Record<FundingSentiment, string> = {
    extremely_bullish: 'Extremely Bullish',
    bullish: 'Bullish',
    neutral: 'Neutral',
    bearish: 'Bearish',
    extremely_bearish: 'Extremely Bearish',
  };
  const sentimentLabel = sentimentLabels[sentiment];

  const sentimentColors: Record<FundingSentiment, string> = {
    extremely_bullish: 'text-up',
    bullish: 'text-up',
    neutral: 'text-muted-foreground',
    bearish: 'text-down',
    extremely_bearish: 'text-down',
  };
  const sentimentColor = sentimentColors[sentiment];

  const avgRate = stats?.avgFundingRate ?? 0;
  const positive = stats?.positiveCount ?? 0;
  const negative = stats?.negativeCount ?? 0;
  const total = positive + negative || 1;
  const positivePct = (positive / total) * 100;

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className={cn('font-display text-lg font-semibold', sentimentColor)}>{sentimentLabel}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Bybit perp funding</p>
      </div>

      {/* Bull/bear bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-3">
        <div className="bg-success" style={{ width: `${positivePct}%` }} />
        <div className="bg-destructive flex-1" />
      </div>

      <div className="flex justify-between text-[11px]">
        <span className="text-up">{positive} positive</span>
        <span className="numeric text-foreground">avg {(avgRate * 100).toFixed(4)}%</span>
        <span className="text-down">{negative} negative</span>
      </div>

      {stats?.highestFunding && (
        <div className="pt-2 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Highest funding</span>
          <span className="numeric text-xs text-foreground">
            {stats.highestFunding.symbol}{' '}
            <span className="text-up">+{stats.highestFunding.percent.toFixed(4)}%</span>
          </span>
        </div>
      )}
    </div>
  );
}

function ArbitrageFeed({ opportunities }: { opportunities: PriceArbitrageOpportunity[] }) {
  if (opportunities.length === 0) {
    return (
      <EmptyState
        title="No active spreads"
        description="Cross-exchange price discrepancies will appear here."
        compact
      />
    );
  }

  return (
    <ul className="space-y-1">
      {opportunities.slice(0, 6).map((opp) => (
        <li key={`${opp.asset}-${opp.marketType}`}>
          <Link
            to={`/price-arbitrage?type=${opp.marketType}&quote=${opp.quoteCurrency}`}
            className={cn(
              'flex items-center justify-between gap-2 px-2 py-1.5 rounded',
              'hover:bg-surface-2 transition-colors no-tap-highlight'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-sm font-medium text-foreground">{opp.asset}</span>
              <Tag variant="default">{opp.marketType}</Tag>
            </div>
            <div className="text-right">
              <div className="numeric text-sm font-semibold text-up">
                +{opp.spreadBps.toFixed(1)} bps
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {opp.bestBuyExchange} → {opp.bestSellExchange}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function WatchlistItems({ keys }: { keys: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {keys.map((k) => (
        <WatchlistItem key={k} key_={k} />
      ))}
    </div>
  );
}

function WatchlistItem({ key_ }: { key_: string }) {
  const [exchange, symbol] = parseWatchlistKey(key_);
  const { data, isLoading } = useTicker(exchange, symbol);

  if (isLoading || !data) {
    return <Skeleton className="h-20" />;
  }

  const t = data.data;
  return (
    <Link
      to={`/workspace?exchange=${exchange}&symbol=${symbol}&type=${t.type}&timeframe=1h`}
      className={cn(
        'block p-3 rounded-md border border-border bg-surface-1',
        'hover:bg-surface-2 hover:border-border-strong transition-colors no-tap-highlight'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium text-foreground truncate">
          {symbol.replace('-USDT', '/USDT').replace('.P', ' PERP')}
        </span>
        <ChangeText value={t.percentage24h} size="xs" />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <PriceText value={t.last} size="md" inlineChange={false} />
        <span className="text-[10px] font-mono text-muted-foreground">
          ${formatVolume(t.quoteVolume24h ?? 0)}
        </span>
      </div>
    </Link>
  );
}
