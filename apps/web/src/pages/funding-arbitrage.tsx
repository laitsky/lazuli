/**
 * Funding Arbitrage page — cross-exchange funding yield opportunities
 *
 * Replaces the server/client split. Surfaces top opportunities first, with
 * a sortable DataTable of all asset comparisons. Row click opens detail.
 *
 * Strategy refresher: long on the exchange with LOWER funding (pay less),
 * short on the exchange with HIGHER funding (receive more). Delta-neutral.
 */

import { useMemo, useState } from 'react';
import { Radar, TrendingUp, Activity, AlertTriangle } from 'lucide-react';
import type { CrossExchangeFunding } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { Tag } from '@/components/ui/tag';
import { ChangeText } from '@/components/ui/price-text';
import { Skeleton } from '@/components/ui/skeleton';
import { useCrossExchangeFunding } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function FundingArbitragePage() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ column: 'spread', direction: 'desc' });

  const funding = useCrossExchangeFunding({ limit: 200 });

  const data = funding.data;
  const comparisons = data?.comparisons ?? [];
  const opportunities = data?.arbitrageOpportunities ?? [];

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return comparisons;
    const q = search.toLowerCase();
    return comparisons.filter(
      (c) =>
        c.baseAsset.toLowerCase().includes(q) ||
        c.rates.some((r) => r.exchange.toLowerCase().includes(q))
    );
  }, [comparisons, search]);

  // Sort
  const sorted = useMemo(() => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.column) {
        case 'asset':
          return a.baseAsset.localeCompare(b.baseAsset) > 0 ? dir : -dir;
        case 'apy':
          return (
            ((opportunities.find((o) => o.asset === b.baseAsset)?.estimatedDailyYield ?? 0) -
              (opportunities.find((o) => o.asset === a.baseAsset)?.estimatedDailyYield ?? 0)) *
            dir
          );
        case 'spread':
        default:
          return (b.spread - a.spread) * dir;
      }
    });
  }, [filtered, sort, opportunities]);

  // Aggregate stats
  const stats = useMemo(() => {
    if (opportunities.length === 0) {
      return { count: 0, bestSpread: 0, bestApy: 0, exchanges: data?.exchanges.length ?? 0 };
    }
    return {
      count: opportunities.length,
      bestSpread: Math.max(...opportunities.map((o) => o.spread)),
      bestApy: Math.max(...opportunities.map((o) => o.estimatedDailyYield * 365)),
      exchanges: data?.exchanges.length ?? 0,
    };
  }, [opportunities, data]);

  const columns: Array<Column<CrossExchangeFunding>> = useMemo(
    () => [
      {
        id: 'asset',
        header: 'Asset',
        sortable: true,
        sortAccessor: (c) => c.baseAsset,
        cell: (c) => (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[10px] font-mono font-semibold text-muted-foreground">
              {c.baseAsset.slice(0, 3)}
            </span>
            <span className="font-mono font-semibold text-foreground text-sm">{c.baseAsset}</span>
            {c.arbitrageOpportunity && <Tag variant="up">arb</Tag>}
          </div>
        ),
        cellClassName: 'min-w-[120px]',
      },
      {
        id: 'lowVenue',
        header: 'Long On',
        cell: (c) => {
          const low = c.rates.reduce(
            (min, r) => (r.fundingRate < min.fundingRate ? r : min),
            c.rates[0]
          );
          return (
            <div>
              <div className="font-mono text-sm text-foreground capitalize">{low?.exchange}</div>
              <div className="text-up numeric text-xs">
                {(low?.fundingRate ?? 0) >= 0 ? '+' : ''}
                {((low?.fundingRate ?? 0) * 100).toFixed(4)}%
              </div>
            </div>
          );
        },
        cellClassName: 'min-w-[120px]',
      },
      {
        id: 'highVenue',
        header: 'Short On',
        cell: (c) => {
          const high = c.rates.reduce(
            (max, r) => (r.fundingRate > max.fundingRate ? r : max),
            c.rates[0]
          );
          return (
            <div>
              <div className="font-mono text-sm text-foreground capitalize">{high?.exchange}</div>
              <div className="text-down numeric text-xs">
                {(high?.fundingRate ?? 0) >= 0 ? '+' : ''}
                {((high?.fundingRate ?? 0) * 100).toFixed(4)}%
              </div>
            </div>
          );
        },
        cellClassName: 'min-w-[120px]',
      },
      {
        id: 'spread',
        header: 'Spread',
        numeric: true,
        sortable: true,
        sortAccessor: (c) => c.spread,
        cell: (c) => (
          <div className="text-right">
            <ChangeText value={c.spread * 100} signed size="sm" />
            <div className="numeric text-[10px] text-muted-foreground">
              {(c.spread * 100).toFixed(4)}% / 8h
            </div>
          </div>
        ),
        cellClassName: 'min-w-[110px]',
      },
      {
        id: 'apy',
        header: 'Est. APY',
        numeric: true,
        sortable: true,
        sortAccessor: (c) => {
          const o = opportunities.find((o) => o.asset === c.baseAsset);
          return (o?.estimatedDailyYield ?? 0) * 365;
        },
        hideBelow: 'lg',
        cell: (c) => {
          const o = opportunities.find((o) => o.asset === c.baseAsset);
          const apy = (o?.estimatedDailyYield ?? 0) * 365;
          return (
            <span
              className={cn(
                'numeric text-sm',
                apy > 0 ? 'text-up font-semibold' : 'text-muted-foreground'
              )}
            >
              {apy >= 0 ? '+' : ''}
              {apy.toFixed(2)}%
            </span>
          );
        },
        cellClassName: 'min-w-[90px]',
      },
      {
        id: 'venues',
        header: 'Venues',
        numeric: true,
        hideBelow: 'xl',
        cell: (c) => (
          <span className="numeric text-xs text-muted-foreground">{c.rates.length}</span>
        ),
        cellClassName: 'min-w-[60px]',
      },
    ],
    [opportunities]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Radar}
        title="Funding Arbitrage"
        description="Cross-exchange funding yield. Long the low-rate venue, short the high-rate venue — capture the spread delta-neutral."
        freshnessMeta={null}
      />

      {/* Caveat */}
      <div className="flex items-start gap-2.5 p-3 rounded-md border border-warning/30 bg-warning/5">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden />
        <p className="text-xs text-muted-foreground">
          Theoretical yields. Excludes exchange fees, borrow costs, position limits, and execution
          slippage. Funding rates can flip on regime changes.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {funding.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Panel>
              <Metric label="Opportunities" value={stats.count.toString()} mono size="md" />
              <p className="mt-1 text-[11px] text-muted-foreground">Spreads &gt; 0.02% / 8h</p>
            </Panel>
            <Panel>
              <Metric
                label="Best Spread"
                value={`+${(stats.bestSpread * 100).toFixed(4)}%`}
                mono
                size="md"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Per 8-hour funding period</p>
            </Panel>
            <Panel>
              <Metric label="Best APY" value={`+${stats.bestApy.toFixed(1)}%`} mono size="md" />
              <p className="mt-1 text-[11px] text-muted-foreground">Annualized (theoretical)</p>
            </Panel>
            <Panel>
              <Metric label="Venues" value={stats.exchanges.toString()} mono size="md" />
              <p className="mt-1 text-[11px] text-muted-foreground">Compared side-by-side</p>
            </Panel>
          </>
        )}
      </div>

      {/* Top 3 opportunities */}
      {opportunities.length > 0 && (
        <Panel flush>
          <PanelHeader className="px-5 pt-5 mb-0">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent" aria-hidden />
              <PanelTitle>Top Opportunities</PanelTitle>
            </div>
          </PanelHeader>
          <div className="p-5 pt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {opportunities
              .sort((a, b) => b.estimatedDailyYield - a.estimatedDailyYield)
              .slice(0, 6)
              .map((o) => (
                <div
                  key={o.asset}
                  className="rounded-md border border-border bg-surface-1 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono font-semibold text-foreground">{o.asset}</span>
                    <span className="numeric text-up text-sm font-semibold">
                      +{(o.estimatedDailyYield * 365).toFixed(1)}% APY
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded bg-success/5 px-2 py-1">
                      <div className="text-[9px] uppercase text-muted-foreground font-mono">
                        Long
                      </div>
                      <div className="text-foreground font-mono capitalize">{o.longExchange}</div>
                    </div>
                    <div className="rounded bg-destructive/5 px-2 py-1">
                      <div className="text-[9px] uppercase text-muted-foreground font-mono">
                        Short
                      </div>
                      <div className="text-foreground font-mono capitalize">{o.shortExchange}</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                    <span>Spread / 8h</span>
                    <span className="numeric text-up">+{(o.spread * 100).toFixed(4)}%</span>
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      )}

      {/* Filters */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          <span>{sorted.length} assets compared</span>
        </div>
        <div className="w-full md:w-64">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search asset…" />
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(c) => c.baseAsset}
        loading={funding.isLoading}
        error={funding.error?.message ?? null}
        onRetry={() => funding.refetch()}
        sort={sort}
        onSortChange={setSort}
        renderMobileCard={(c) => {
          const o = opportunities.find((o) => o.asset === c.baseAsset);
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-foreground">{c.baseAsset}</span>
                {o && (
                  <span className="numeric text-up text-sm font-semibold">
                    +{(o.estimatedDailyYield * 365).toFixed(1)}% APY
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[9px] uppercase text-muted-foreground">Long</div>
                  <div className="font-mono capitalize">{c.minExchange}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-muted-foreground">Short</div>
                  <div className="font-mono capitalize">{c.maxExchange}</div>
                </div>
              </div>
            </div>
          );
        }}
        emptyTitle="No funding data"
        emptyDescription="Cross-exchange funding data unavailable."
        height="calc(100vh - 580px)"
        aria-label="Funding arbitrage table"
      />
    </div>
  );
}
