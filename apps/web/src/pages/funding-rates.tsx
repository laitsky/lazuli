/**
 * Funding Rates page — per-exchange perp funding sentiment
 *
 * Replaces the old server/client split. Uses useFundingRates hook directly.
 * Shows stats + sortable DataTable of all perp funding rates for the selected
 * exchange. Cross-exchange opportunities are surfaced in the dedicated
 * /funding-arbitrage page.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Percent, TrendingDown, TrendingUp, ArrowRight } from 'lucide-react';
import type { FundingRateData, FundingSentiment, SupportedExchange } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchInput } from '@/components/ui/search-input';
import { ChangeText } from '@/components/ui/price-text';
import { Tag } from '@/components/ui/tag';
import { Skeleton } from '@/components/ui/skeleton';
import { useFundingRates, useExchanges } from '@/lib/queries';
import { useStringParam } from '@/lib/url-state';
import { formatVolume } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

const SENTIMENT_LABELS: Record<FundingSentiment, string> = {
  extremely_bullish: 'Extremely Bullish',
  bullish: 'Bullish',
  neutral: 'Neutral',
  bearish: 'Bearish',
  extremely_bearish: 'Extremely Bearish',
};

const SENTIMENT_COLORS: Record<FundingSentiment, string> = {
  extremely_bullish: 'text-up',
  bullish: 'text-up',
  neutral: 'text-muted-foreground',
  bearish: 'text-down',
  extremely_bearish: 'text-down',
};

export default function FundingRatesPage() {
  const [exchange, setExchange] = useStringParam('exchange', 'bybit');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ column: 'rate', direction: 'desc' });

  const { data: exchangesData } = useExchanges();
  const exchanges = (exchangesData?.data ?? []).filter((e) => e.hasPerp && e.id !== 'upbit');

  const funding = useFundingRates(exchange as SupportedExchange, {
    sortBy: 'rate',
    sortOrder: 'desc',
    limit: 500,
  });

  const fundingData = funding.data?.data;
  const stats = fundingData?.stats;

  // Client-side search filter
  const filtered = useMemo(() => {
    const all = fundingData?.fundingRates ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (f) => f.baseAsset.toLowerCase().includes(q) || f.symbol.toLowerCase().includes(q)
    );
  }, [fundingData, search]);

  // Sort
  const sorted = useMemo(() => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.column) {
        case 'symbol':
          return a.baseAsset.localeCompare(b.baseAsset) > 0 ? dir : -dir;
        case 'annualized':
          return (a.annualizedRate - b.annualizedRate) * dir;
        case 'volume':
          return ((a.volume24h ?? 0) - (b.volume24h ?? 0)) * dir;
        case 'oi':
          return ((a.openInterest ?? 0) - (b.openInterest ?? 0)) * dir;
        case 'rate':
        default:
          return (a.fundingRatePercent - b.fundingRatePercent) * dir;
      }
    });
  }, [filtered, sort]);

  const sentiment = stats?.marketSentiment ?? 'neutral';
  const positive = stats?.positiveCount ?? 0;
  const negative = stats?.negativeCount ?? 0;
  const total = positive + negative || 1;

  const columns: Array<Column<FundingRateData>> = useMemo(
    () => [
      {
        id: 'symbol',
        header: 'Asset',
        sortable: true,
        sortAccessor: (f) => f.baseAsset,
        cell: (f) => (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[10px] font-mono font-semibold text-muted-foreground">
              {f.baseAsset.slice(0, 3)}
            </span>
            <div>
              <div className="font-medium text-foreground text-sm">{f.baseAsset}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{f.symbol}</div>
            </div>
          </div>
        ),
        cellClassName: 'min-w-[140px]',
      },
      {
        id: 'rate',
        header: 'Funding',
        numeric: true,
        sortable: true,
        sortAccessor: (f) => f.fundingRatePercent,
        cell: (f) => <ChangeText value={f.fundingRatePercent} signed size="sm" />,
        cellClassName: 'min-w-[90px]',
      },
      {
        id: 'annualized',
        header: 'Annualized',
        numeric: true,
        sortable: true,
        sortAccessor: (f) => f.annualizedRate,
        cell: (f) => (
          <span
            className={cn(
              'numeric text-sm',
              f.annualizedRate > 0
                ? 'text-up'
                : f.annualizedRate < 0
                  ? 'text-down'
                  : 'text-muted-foreground'
            )}
          >
            {f.annualizedRate >= 0 ? '+' : ''}
            {f.annualizedRate.toFixed(2)}%
          </span>
        ),
        cellClassName: 'min-w-[100px]',
      },
      {
        id: 'markPrice',
        header: 'Mark',
        numeric: true,
        hideBelow: 'lg',
        cell: (f) => (
          <span className="numeric text-muted-foreground">
            {f.markPrice !== null ? `$${formatPrice(f.markPrice)}` : '—'}
          </span>
        ),
        cellClassName: 'min-w-[90px]',
      },
      {
        id: 'oi',
        header: 'OI',
        numeric: true,
        sortable: true,
        hideBelow: 'xl',
        sortAccessor: (f) => f.openInterest ?? 0,
        cell: (f) => (
          <span className="numeric text-muted-foreground">
            {f.openInterest !== null ? `$${formatVolume(f.openInterest)}` : '—'}
          </span>
        ),
        cellClassName: 'min-w-[80px]',
      },
      {
        id: 'volume',
        header: '24h Vol',
        numeric: true,
        sortable: true,
        hideBelow: 'lg',
        sortAccessor: (f) => f.volume24h ?? 0,
        cell: (f) => (
          <span className="numeric text-muted-foreground">
            {f.volume24h !== null ? `$${formatVolume(f.volume24h)}` : '—'}
          </span>
        ),
        cellClassName: 'min-w-[90px]',
      },
      {
        id: 'nextFunding',
        header: 'Next',
        numeric: true,
        hideBelow: 'xl',
        cell: (f) => {
          if (!f.nextFundingTime) return <span className="text-muted-foreground">—</span>;
          const ms = f.nextFundingTime - Date.now();
          const h = Math.floor(ms / 3_600_000);
          const m = Math.floor((ms % 3_600_000) / 60_000);
          return (
            <span className="numeric text-xs text-muted-foreground">
              {h > 0 ? `${h}h ${m}m` : `${m}m`}
            </span>
          );
        },
        cellClassName: 'min-w-[60px]',
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Percent}
        title="Funding Rates"
        description="Perpetual funding sentiment per exchange. Positive rate = longs pay shorts (bullish leverage)."
        freshnessMeta={funding.data?.meta ?? null}
        actions={
          <Link
            to="/funding-arbitrage"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Cross-exchange arb <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {funding.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Panel>
              <Metric
                label="Sentiment"
                value={SENTIMENT_LABELS[sentiment]}
                mono={false}
                size="md"
              />
              <p className={cn('mt-1 text-[11px]', SENTIMENT_COLORS[sentiment])}>
                {sentiment === 'neutral'
                  ? 'Balanced'
                  : sentiment.includes('bullish')
                    ? 'Longs paying'
                    : 'Shorts paying'}
              </p>
            </Panel>
            <Panel>
              <Metric
                label="Positive / Negative"
                value={
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-up">{positive}</span>
                    <span className="text-muted-foreground text-base">/</span>
                    <span className="text-down">{negative}</span>
                  </span>
                }
                mono={false}
                size="md"
              />
              <div className="mt-2 h-1.5 rounded-full overflow-hidden bg-surface-3 flex">
                <div className="bg-success" style={{ width: `${(positive / total) * 100}%` }} />
                <div className="bg-destructive flex-1" />
              </div>
            </Panel>
            <Panel>
              <Metric
                label="Average Rate"
                value={`${(stats?.avgFundingRate ?? 0) >= 0 ? '+' : ''}${((stats?.avgFundingRate ?? 0) * 100).toFixed(4)}%`}
                mono
                size="md"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Across all perps</p>
            </Panel>
            <Panel>
              <Metric
                label="Perps Tracked"
                value={(stats?.totalPairs ?? 0).toString()}
                mono
                size="md"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{exchange} perpetuals</p>
            </Panel>
          </>
        )}
      </div>

      {/* Highest / lowest callout */}
      {stats && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Panel className="border-success/20 bg-success/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-up" aria-hidden />
                <span className="text-xs font-mono uppercase text-muted-foreground">Highest</span>
              </div>
              <Tag variant="up">Longs paying</Tag>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="font-mono font-semibold text-foreground">
                {stats.highestFunding.symbol}
              </span>
              <ChangeText value={stats.highestFunding.percent} signed size="md" />
            </div>
          </Panel>
          <Panel className="border-destructive/20 bg-destructive/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-down" aria-hidden />
                <span className="text-xs font-mono uppercase text-muted-foreground">Lowest</span>
              </div>
              <Tag variant="down">Shorts paying</Tag>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="font-mono font-semibold text-foreground">
                {stats.lowestFunding.symbol}
              </span>
              <ChangeText value={stats.lowestFunding.percent} signed size="md" />
            </div>
          </Panel>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentedControl
          value={exchange}
          onChange={(v) => setExchange(v)}
          options={exchanges.map((e) => ({ value: e.id, label: e.name }))}
          size="sm"
          aria-label="Exchange"
        />
        <div className="w-full md:w-64">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search asset…" />
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(f) => f.symbol}
        loading={funding.isLoading}
        error={funding.error?.message ?? null}
        onRetry={() => funding.refetch()}
        sort={sort}
        onSortChange={setSort}
        renderMobileCard={(f) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono font-semibold text-foreground">{f.baseAsset}</div>
              <div className="text-[10px] text-muted-foreground">
                OI ${f.openInterest !== null ? formatVolume(f.openInterest) : '—'}
              </div>
            </div>
            <ChangeText value={f.fundingRatePercent} signed />
          </div>
        )}
        emptyTitle="No funding data"
        emptyDescription="This exchange may have no active perpetual markets."
        height="calc(100vh - 540px)"
        aria-label="Funding rates table"
      />
    </div>
  );
}
