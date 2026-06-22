/**
 * Markets Page - Terminal Luxe
 * Real-time ticker data with clean data visualization
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TickersTable } from '@/components/tickers-table';
import { LazuliAPI, formatVolume } from '@/lib/api-client';
import { Ticker, SupportedExchange, ExchangeInfo } from '@lazuli/shared';
import {
  BarChart3,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from 'lucide-react';
import { ExchangeLogo } from '@/components/exchange-logo';
import { PageHeader } from '@/components/page-header';
import { appRoutes } from '@/lib/navigation';

export default function MarketsPage() {
  const [searchParams] = useSearchParams();
  const selectedExchange = searchParams.get('exchange') || 'bybit';

  const validExchanges = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'];
  const exchange = validExchanges.includes(selectedExchange)
    ? (selectedExchange as SupportedExchange)
    : 'bybit';

  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success) {
        setExchanges(response.data);
      }
    }
    fetchExchanges();
  }, []);

  useEffect(() => {
    async function fetchAllTickers() {
      setLoading(true);
      const allTickers: Ticker[] = [];
      let currentPage = 1;
      let hasMorePages = true;
      const pageLimit = 500;

      while (hasMorePages) {
        const response = await LazuliAPI.getTickers(exchange, {
          page: currentPage,
          limit: pageLimit,
          sortBy: 'volume',
          sortOrder: 'desc',
        });

        if (!response.success || !response.data) {
          break;
        }

        allTickers.push(...response.data.tickers);

        if (response.data.pagination && response.data.pagination.hasNext) {
          currentPage++;
        } else {
          hasMorePages = false;
        }
      }

      const uniqueTickers = Array.from(new Map(allTickers.map((t) => [t.symbol, t])).values());
      setTickers(uniqueTickers);
      setLoading(false);
    }
    fetchAllTickers();
  }, [exchange]);

  // Calculate aggregate stats
  const spotCount = tickers.filter((t) => t.type === 'spot').length;
  const perpCount = tickers.filter((t) => t.type === 'perp').length;
  const totalVolume = tickers.reduce((acc, t) => acc + (t.quoteVolume24h || 0), 0);

  // Calculate gainers and losers
  const usdtTickers = tickers.filter((t) => t.symbol.includes('USDT') && t.percentage24h !== null);
  const gainersCount = usdtTickers.filter((t) => (t.percentage24h || 0) > 0).length;
  const losersCount = usdtTickers.filter((t) => (t.percentage24h || 0) < 0).length;

  // Calculate average change
  const validChanges = usdtTickers.filter((t) => t.percentage24h !== null);
  const avgChange =
    validChanges.length > 0
      ? validChanges.reduce((acc, t) => acc + (t.percentage24h || 0), 0) / validChanges.length
      : 0;

  // Find top gainer and loser
  const sortedByChange = [...usdtTickers].sort(
    (a, b) => (b.percentage24h || 0) - (a.percentage24h || 0)
  );
  const topGainer = sortedByChange[0];
  const topLoser = sortedByChange[sortedByChange.length - 1];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={TrendingUp}
        title="Markets"
        description="Real-time cryptocurrency data across major exchanges. Track prices, volume, and 24h changes."
      />

      {/* Exchange Selector */}
      <div className="flex flex-wrap gap-2">
        {exchanges.map((ex) => (
          <Link key={ex.id} to={`${appRoutes.markets.href}?exchange=${ex.id}`}>
            <button
              className={`group inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                exchange === ex.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
              }`}
            >
              <ExchangeLogo
                exchangeId={ex.id}
                className={`h-4 w-4 ${exchange === ex.id ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}
              />
              {ex.name}
              {exchange === ex.id && (
                <span className="flex h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />
              )}
            </button>
          </Link>
        ))}
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
                <div className="h-4 w-20 bg-secondary rounded mb-3" />
                <div className="h-8 w-24 bg-secondary rounded mb-2" />
                <div className="h-3 w-32 bg-secondary rounded" />
              </div>
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border p-6 animate-pulse">
            <div className="space-y-4">
              <div className="h-10 w-full max-w-sm bg-secondary rounded" />
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 w-full bg-secondary rounded" />
              ))}
            </div>
          </div>
        </div>
      ) : tickers.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground">No ticker data found for this exchange.</p>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Stats Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Markets */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Markets
                </span>
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-display font-bold text-foreground">
                {tickers.length.toLocaleString()}
              </div>
              <div className="flex gap-2 mt-2">
                <span className="text-[10px] font-mono text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)] px-1.5 py-0.5 rounded">
                  {spotCount} SPOT
                </span>
                <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  {perpCount} PERP
                </span>
              </div>
            </div>

            {/* 24h Volume */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  24h Volume
                </span>
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-display font-bold text-foreground">
                {formatVolume(totalVolume)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Combined trading volume</p>
            </div>

            {/* Gainers / Losers */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Sentiment
                </span>
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5 text-[hsl(152_60%_45%)]" />
                  <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-display font-bold text-[hsl(152_60%_50%)]">
                  {gainersCount}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="text-2xl font-display font-bold text-destructive">
                  {losersCount}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Gainers vs Losers (24h)</p>
            </div>

            {/* Average Change */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Avg. Change
                </span>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div
                className={`text-2xl font-display font-bold ${
                  avgChange >= 0 ? 'text-[hsl(152_60%_50%)]' : 'text-destructive'
                }`}
              >
                {avgChange >= 0 ? '+' : ''}
                {avgChange.toFixed(2)}%
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Market-wide average</p>
            </div>
          </div>

          {/* Top Movers */}
          {topGainer && topLoser && (
            <div className="grid gap-3 md:grid-cols-2">
              {/* Top Gainer */}
              <div className="bg-card rounded-xl border border-border p-4 border-l-2 border-l-[hsl(152_60%_45%)]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Top Gainer
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-[hsl(152_60%_45%)]" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-display font-bold text-foreground">
                      {topGainer.symbol}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      $
                      {topGainer.last?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8,
                      })}
                    </span>
                  </div>
                  <span className="text-lg font-mono font-bold text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)] px-3 py-1.5 rounded-lg">
                    +{topGainer.percentage24h?.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Top Loser */}
              <div className="bg-card rounded-xl border border-border p-4 border-l-2 border-l-destructive">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Top Loser
                  </span>
                  <ArrowDownRight className="h-4 w-4 text-destructive" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-display font-bold text-foreground">
                      {topLoser.symbol}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      $
                      {topLoser.last?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8,
                      })}
                    </span>
                  </div>
                  <span className="text-lg font-mono font-bold text-destructive bg-destructive/10 px-3 py-1.5 rounded-lg">
                    {topLoser.percentage24h?.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tickers Table */}
          <TickersTable tickers={tickers} exchange={exchange} />
        </div>
      )}
    </div>
  );
}
