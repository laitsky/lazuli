/**
 * Markets page — the flagship table
 *
 * Virtualized DataTable with 12 toggleable columns. URL-state driven so every
 * filter is shareable. Row click opens the symbol in the workspace.
 *
 * Data: useAllTickers auto-paginates the entire exchange's ticker list on mount,
 * then sorts/filters client-side for instant feedback. Background refetch keeps
 * prices fresh every 10s.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Columns3, TrendingUp } from 'lucide-react';
import type { Ticker } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { DataTable, type Column, ColumnVisibilityDropdown } from '@/components/ui/data-table';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Metric } from '@/components/ui/metric';
import { ChangeText, PriceText } from '@/components/ui/price-text';
import { Tag } from '@/components/ui/tag';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarketsFilters } from '@/lib/url-state';
import { useAllTickers, useExchanges } from '@/lib/queries';
import { usePreferences, watchlistKey } from '@/lib/preferences';
import { formatVolume } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

// Quote currencies offered in the filter (matches url-state.ts QUOTES)
// const QUOTES imported from url-state
import { QUOTES } from '@/lib/url-state';

export default function MarketsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useMarketsFilters();
  const { data: exchangesData } = useExchanges();
  const exchanges = exchangesData?.data ?? [];
  const { toggleWatchlist, isWatched, watchlist } = usePreferences();

  const exchange = filters.exchange as string;

  // Auto-paginate the full ticker list once per exchange
  const {
    data: tickerPages,
    isLoading,
    error,
    refetch,
  } = useAllTickers(exchange, {
    type: filters.type,
    quote: filters.quote === 'ALL' ? undefined : filters.quote,
    sortBy: 'volume',
    sortOrder: 'desc',
  });

  // Flatten pages → single ticker array
  const allTickers = useMemo(() => {
    if (!tickerPages) return [];
    return tickerPages.pages.flatMap((p) => p.data.tickers);
  }, [tickerPages]);

  // Apply client-side filters (search) + sort
  const filteredTickers = useMemo(() => {
    let result = allTickers;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) || t.symbol.split(/[-.]/)[0].toLowerCase().includes(q)
      );
    }
    // Sort
    const dir = filters.dir === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      switch (filters.sort) {
        case 'price':
          return (a.last ?? 0) - (b.last ?? 0) > 0 ? dir : -dir;
        case 'change':
          return (a.percentage24h ?? 0) - (b.percentage24h ?? 0) > 0 ? dir : -dir;
        case 'volume':
        default:
          return (a.quoteVolume24h ?? 0) - (b.quoteVolume24h ?? 0) > 0 ? dir : -dir;
      }
    });
    return result;
  }, [allTickers, filters.search, filters.sort, filters.dir]);

  // Aggregate stats
  const stats = useMemo(() => {
    if (allTickers.length === 0) {
      return { total: 0, volume: 0, gainers: 0, losers: 0, avgChange: 0 };
    }
    const totalVolume = allTickers.reduce((sum, t) => sum + (t.quoteVolume24h ?? 0), 0);
    const usdtTickers = allTickers.filter(
      (t) => t.symbol.includes('USDT') && t.percentage24h !== null
    );
    const gainers = usdtTickers.filter((t) => (t.percentage24h ?? 0) > 0).length;
    const losers = usdtTickers.filter((t) => (t.percentage24h ?? 0) < 0).length;
    const validChanges = usdtTickers.map((t) => t.percentage24h ?? 0);
    const avgChange =
      validChanges.length > 0 ? validChanges.reduce((a, b) => a + b, 0) / validChanges.length : 0;
    return { total: allTickers.length, volume: totalVolume, gainers, losers, avgChange };
  }, [allTickers]);

  // Column defs for DataTable
  const columns: Array<Column<Ticker>> = useMemo(
    () => [
      {
        id: 'symbol',
        header: 'Symbol',
        alwaysVisible: true,
        cell: (t) => (
          <div className="flex items-center gap-2 min-w-0">
            <SymbolBadge ticker={t} />
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate">{formatSymbol(t.symbol)}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{t.exchange}</div>
            </div>
          </div>
        ),
        sortAccessor: (t) => t.symbol,
        cellClassName: 'min-w-[140px]',
      },
      {
        id: 'price',
        header: 'Last Price',
        numeric: true,
        sortable: true,
        sortAccessor: (t) => t.last ?? 0,
        cell: (t) => <PriceText value={t.last} size="sm" inlineChange={false} />,
        cellClassName: 'min-w-[110px]',
      },
      {
        id: 'change',
        header: '24h %',
        numeric: true,
        sortable: true,
        sortAccessor: (t) => t.percentage24h ?? 0,
        cell: (t) => <ChangeText value={t.percentage24h} />,
        cellClassName: 'min-w-[90px]',
      },
      {
        id: 'volume',
        header: '24h Volume',
        numeric: true,
        sortable: true,
        sortAccessor: (t) => t.quoteVolume24h ?? 0,
        cell: (t) => (
          <span className="numeric text-foreground">
            {t.quoteVolume24h === null ? '—' : `$${formatVolume(t.quoteVolume24h)}`}
          </span>
        ),
        cellClassName: 'min-w-[110px]',
      },
      {
        id: 'highLow',
        header: '24h Range',
        numeric: true,
        hideBelow: 'lg',
        cell: (t) => <RangeBar high={t.high24h} low={t.low24h} last={t.last} />,
        cellClassName: 'min-w-[140px]',
      },
      {
        id: 'spread',
        header: 'Spread',
        numeric: true,
        hideBelow: 'xl',
        cell: (t) => {
          if (t.bid === null || t.ask === null)
            return <span className="text-muted-foreground">—</span>;
          const spreadBps = ((t.ask - t.bid) / ((t.ask + t.bid) / 2)) * 10_000;
          return <span className="numeric text-muted-foreground">{spreadBps.toFixed(1)} bps</span>;
        },
        cellClassName: 'min-w-[80px]',
      },
      {
        id: 'funding',
        header: 'Funding',
        numeric: true,
        hideBelow: 'lg',
        cell: (t) => {
          if (t.type !== 'perp' || t.fundingRate == null) {
            return <span className="text-muted-foreground">—</span>;
          }
          const pct = t.fundingRate * 100;
          return <ChangeText value={pct} signed />;
        },
        cellClassName: 'min-w-[80px]',
      },
      {
        id: 'openInterest',
        header: 'OI',
        numeric: true,
        hideBelow: 'xl',
        cell: (t) => {
          if (t.type !== 'perp' || t.openInterest == null) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <span className="numeric text-muted-foreground">${formatVolume(t.openInterest)}</span>
          );
        },
        cellClassName: 'min-w-[90px]',
      },
      {
        id: 'updated',
        header: 'Updated',
        numeric: true,
        hideBelow: 'xl',
        cell: (t) => {
          const ageS = Math.round((Date.now() - t.timestamp) / 1000);
          return (
            <span
              className={cn('numeric text-xs', ageS > 60 ? 'text-stale' : 'text-muted-foreground')}
            >
              {ageS}s ago
            </span>
          );
        },
        cellClassName: 'min-w-[70px]',
      },
    ],
    []
  );

  // Hidden columns persisted in user preferences per exchange+type
  const hiddenColumnsKey = `markets-${filters.exchange}-${filters.type}`;
  const savedPreset = watchlist; // not actually used; viewPresets would be wired here
  void savedPreset;
  const [hiddenColumns, setHiddenColumns] = useHiddenColumnsLocal(
    hiddenColumnsKey,
    () => ['spread', 'openInterest'] // hidden by default for cleaner look
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Markets"
        description="Real-time tickers across supported exchanges. Click any row for the full workspace."
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-md" />)
        ) : (
          <>
            <Panel>
              <Metric label="Markets" value={stats.total.toLocaleString()} mono size="md" />
              <div className="mt-2 flex gap-1.5">
                <Tag variant="up">
                  {stats.total - stats.gainers - stats.losers > 0 ? '' : ''}SPOT
                </Tag>
                <Tag variant="accent">PERP</Tag>
              </div>
            </Panel>
            <Panel>
              <Metric label="24h Volume" value={`$${formatVolume(stats.volume)}`} mono size="md" />
            </Panel>
            <Panel>
              <Metric label="Gainers / Losers" value="" mono size="md">
                <div className="flex items-baseline gap-1.5">
                  <span className="numeric text-up font-semibold">{stats.gainers}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="numeric text-down font-semibold">{stats.losers}</span>
                </div>
              </Metric>
            </Panel>
            <Panel>
              <Metric
                label="Avg Change"
                value={`${stats.avgChange >= 0 ? '+' : ''}${stats.avgChange.toFixed(2)}%`}
                mono
                size="md"
              />
              <div
                className={cn(
                  'mt-1 h-1 w-full rounded-full',
                  stats.avgChange >= 0 ? 'bg-success/30' : 'bg-destructive/30'
                )}
              >
                <div
                  className={cn(
                    'h-full rounded-full',
                    stats.avgChange >= 0 ? 'bg-success' : 'bg-destructive'
                  )}
                  style={{ width: `${Math.min(Math.abs(stats.avgChange) * 10, 100)}%` }}
                />
              </div>
            </Panel>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={filters.exchange}
            onChange={(v) => setFilters({ exchange: v as typeof filters.exchange, page: 1 })}
            options={exchanges
              .filter((e) => e.supported)
              .map((e) => ({
                value: e.id,
                label: e.name,
              }))}
            size="sm"
            aria-label="Exchange"
          />
          <SegmentedControl
            value={filters.type}
            onChange={(v) => setFilters({ type: v, page: 1 })}
            options={[
              { value: 'spot', label: 'Spot' },
              { value: 'perp', label: 'Perp' },
            ]}
            size="sm"
            aria-label="Market type"
          />
          <Select
            value={filters.quote}
            onValueChange={(v) => setFilters({ quote: v as typeof filters.quote, page: 1 })}
          >
            <SelectTrigger className="h-8 w-[100px]">
              <SelectValue placeholder="Quote" />
            </SelectTrigger>
            <SelectContent>
              {QUOTES.map((q) => (
                <SelectItem key={q} value={q}>
                  {q === 'ALL' ? 'All quotes' : q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-full md:w-64">
            <SearchInput
              value={filters.search}
              onValueChange={(v) => setFilters({ search: v, page: 1 })}
              placeholder="Search symbol…"
            />
          </div>
          <ColumnVisibilityDropdown
            columns={columns}
            hiddenColumns={hiddenColumns}
            onHiddenColumnsChange={setHiddenColumns}
            trigger={
              <IconButton aria-label="Toggle columns" icon={Columns3} variant="outline" size="sm" />
            }
          />
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={filteredTickers}
        rowKey={(t) => t.symbol}
        loading={isLoading}
        error={error?.message ?? null}
        onRetry={() => refetch()}
        sort={{ column: filters.sort, direction: filters.dir }}
        onSortChange={(s) =>
          setFilters({ sort: s.column as 'volume' | 'price' | 'change', dir: s.direction })
        }
        onRowClick={(t) =>
          navigate(
            `/workspace?exchange=${t.exchange}&symbol=${t.symbol}&type=${t.type}&timeframe=1h`
          )
        }
        rowAction={(t) => (
          <IconButton
            aria-label={
              isWatched(watchlistKey(t.exchange, t.symbol))
                ? 'Remove from watchlist'
                : 'Add to watchlist'
            }
            icon={Star}
            size="sm"
            variant="ghost"
            onClick={() => toggleWatchlist(watchlistKey(t.exchange, t.symbol))}
            className={cn(
              isWatched(watchlistKey(t.exchange, t.symbol)) && 'text-warning fill-warning'
            )}
          />
        )}
        renderMobileCard={(t) => (
          <MobileTickerCard
            ticker={t}
            onClick={() => toggleWatchlist(watchlistKey(t.exchange, t.symbol))}
            watched={isWatched(watchlistKey(t.exchange, t.symbol))}
          />
        )}
        emptyTitle="No tickers found"
        emptyDescription={
          filters.search
            ? `No symbols matching "${filters.search}".`
            : 'This exchange may have no tickers in this category.'
        }
        height="calc(100vh - 460px)"
        aria-label="Markets table"
      />
    </div>
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function formatSymbol(symbol: string): string {
  if (symbol.endsWith('.P')) {
    return `${symbol.slice(0, -2)} PERP`;
  }
  return symbol.replace('-', '/');
}

function SymbolBadge({ ticker }: { ticker: Ticker }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-mono font-semibold shrink-0',
        ticker.type === 'perp'
          ? 'bg-accent-subtle text-accent'
          : 'bg-surface-2 text-muted-foreground'
      )}
      aria-hidden
    >
      {ticker.symbol.split(/[-.]/)[0].slice(0, 3)}
    </span>
  );
}

function RangeBar({
  high,
  low,
  last,
}: {
  high: number | null;
  low: number | null;
  last: number | null;
}) {
  if (high === null || low === null || last === null || high === low) {
    return <span className="text-muted-foreground">—</span>;
  }
  const range = high - low;
  const position = ((last - low) / range) * 100;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-[10px] numeric text-muted-foreground">
        ${formatPrice(low)} — ${formatPrice(high)}
      </div>
      <div className="relative w-24 h-1 bg-surface-3 rounded-full overflow-hidden">
        <div
          className="absolute top-0 bottom-0 w-1 bg-accent rounded-full"
          style={{ left: `${Math.min(Math.max(position, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

function MobileTickerCard({
  ticker,
  onClick,
  watched,
}: {
  ticker: Ticker;
  onClick: () => void;
  watched: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <SymbolBadge ticker={ticker} />
        <div className="min-w-0">
          <div className="font-medium text-foreground truncate">{formatSymbol(ticker.symbol)}</div>
          <div className="text-[10px] text-muted-foreground font-mono uppercase">
            {ticker.exchange}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <PriceText value={ticker.last} size="sm" inlineChange={false} />
        <ChangeText value={ticker.percentage24h} size="xs" />
      </div>
      <button
        type="button"
        onClick={onClick}
        aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md shrink-0',
          'text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors'
        )}
      >
        <Star className={cn('h-4 w-4', watched && 'fill-warning text-warning')} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Tiny local hidden-columns state backed by localStorage. Phase 6 will
 * migrate to usePreferences.viewPresets.
 */
function useHiddenColumnsLocal(
  key: string,
  defaults: () => string[]
): [string[], (next: string[]) => void] {
  const stored = useMemo(() => {
    if (typeof window === 'undefined') return defaults();
    try {
      const raw = window.localStorage.getItem(`lazuli.colvis.${key}`);
      return raw ? (JSON.parse(raw) as string[]) : defaults();
    } catch {
      return defaults();
    }
  }, [key]);

  const [hidden, setHidden] = useStateLocal<string[]>(stored);

  const setHiddenPersisted = (next: string[]) => {
    setHidden(next);
    try {
      window.localStorage.setItem(`lazuli.colvis.${key}`, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  return [hidden, setHiddenPersisted];
}

// Tiny wrapper to avoid React import noise
import { useState as useStateLocal } from 'react';
