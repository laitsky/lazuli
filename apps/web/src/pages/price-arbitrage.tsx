/**
 * Price Arbitrage — cross-exchange price discrepancy scanner
 *
 * Live opportunity table with detail drawer. URL-state driven filters.
 * Row click opens a drawer showing all exchange quotes for that asset.
 *
 * Data: usePriceArbitrage hook, refreshed every 10s.
 */

import { useMemo, useState } from 'react';
import { ArrowRightLeft, AlertTriangle } from 'lucide-react';
import type { PriceArbitrageOpportunity } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { DataTable, type Column } from '@/components/ui/data-table';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Slider } from '@/components/ui/slider';
import { Metric } from '@/components/ui/metric';
import { Tag } from '@/components/ui/tag';
import { ChangeText } from '@/components/ui/price-text';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useArbitrageFilters } from '@/lib/url-state';
import { usePriceArbitrage } from '@/lib/queries';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'KRW'] as const;

export default function PriceArbitragePage() {
  const [filters, setFilters] = useArbitrageFilters();
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = usePriceArbitrage({
    type: filters.type,
    quote: filters.quote,
    minSpreadBps: filters.minSpreadBps,
    limit: 100,
  });

  const opportunities = data?.data.opportunities ?? [];

  // Search filter (client-side)
  const filteredOpps = useMemo(() => {
    if (!search.trim()) return opportunities;
    const q = search.toLowerCase();
    return opportunities.filter(
      (o) =>
        o.asset.toLowerCase().includes(q) ||
        o.bestBuyExchange.toLowerCase().includes(q) ||
        o.bestSellExchange.toLowerCase().includes(q)
    );
  }, [opportunities, search]);

  // Sorted desc by spread
  const sortedOpps = useMemo(
    () => [...filteredOpps].sort((a, b) => b.spreadBps - a.spreadBps),
    [filteredOpps]
  );

  const selected = selectedAsset
    ? (opportunities.find((o) => o.asset === selectedAsset) ?? null)
    : null;

  const stats = useMemo(() => {
    if (opportunities.length === 0) return { count: 0, bestBps: 0, avgBps: 0 };
    const bps = opportunities.map((o) => o.spreadBps);
    return {
      count: opportunities.length,
      bestBps: Math.max(...bps),
      avgBps: bps.reduce((a, b) => a + b, 0) / bps.length,
    };
  }, [opportunities]);

  const columns: Array<Column<PriceArbitrageOpportunity>> = useMemo(
    () => [
      {
        id: 'asset',
        header: 'Asset',
        alwaysVisible: true,
        cell: (o) => (
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-foreground">{o.asset}</span>
            <Tag variant={o.marketType === 'perp' ? 'accent' : 'default'}>{o.marketType}</Tag>
          </div>
        ),
        sortAccessor: (o) => o.asset,
        cellClassName: 'min-w-[140px]',
      },
      {
        id: 'buy',
        header: 'Buy On',
        cell: (o) => (
          <div>
            <div className="font-mono text-sm text-foreground capitalize">{o.bestBuyExchange}</div>
            <div className="numeric text-xs text-muted-foreground">${formatPrice(o.buyPrice)}</div>
          </div>
        ),
        cellClassName: 'min-w-[120px]',
      },
      {
        id: 'sell',
        header: 'Sell On',
        cell: (o) => (
          <div>
            <div className="font-mono text-sm text-foreground capitalize">{o.bestSellExchange}</div>
            <div className="numeric text-xs text-muted-foreground">${formatPrice(o.sellPrice)}</div>
          </div>
        ),
        cellClassName: 'min-w-[120px]',
      },
      {
        id: 'spread',
        header: 'Spread',
        numeric: true,
        sortable: true,
        sortAccessor: (o) => o.spreadBps,
        cell: (o) => (
          <div className="text-right">
            <div className="numeric font-semibold text-up">+{o.spreadBps.toFixed(2)} bps</div>
            <div className="numeric text-[10px] text-muted-foreground">
              ${formatPrice(o.spread)}
            </div>
          </div>
        ),
        cellClassName: 'min-w-[120px]',
      },
      {
        id: 'venueCount',
        header: 'Venues',
        numeric: true,
        hideBelow: 'lg',
        cell: (o) => <span className="numeric text-muted-foreground">{o.quotes.length}</span>,
        cellClassName: 'min-w-[60px]',
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ArrowRightLeft}
        title="Price Arbitrage"
        description="Cross-exchange price discrepancies in real time. Filter, sort, drill in. Spreads do not account for fees, slippage, or transfer time."
        freshnessMeta={data?.meta ?? null}
      />

      {/* Caveat banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-md border border-warning/30 bg-warning/5">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden />
        <p className="text-xs text-muted-foreground">
          Spreads use ask for buy side and bid for sell side. Always account for fees, depth,
          borrow/transfer constraints, and execution latency before acting.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <Panel>
          <Metric label="Active Spreads" value={stats.count.toString()} mono size="md" />
        </Panel>
        <Panel>
          <Metric label="Best Spread" value={`${stats.bestBps.toFixed(1)} bps`} mono size="md" />
        </Panel>
        <Panel>
          <Metric label="Average Spread" value={`${stats.avgBps.toFixed(1)} bps`} mono size="md" />
        </Panel>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={filters.type}
            onChange={(v) => setFilters({ type: v })}
            options={[
              { value: 'spot', label: 'Spot' },
              { value: 'perp', label: 'Perp' },
            ]}
            size="sm"
            aria-label="Market type"
          />
          <Select
            value={filters.quote}
            onValueChange={(v) => setFilters({ quote: v as typeof filters.quote })}
          >
            <SelectTrigger className="h-8 w-[100px]">
              <SelectValue placeholder="Quote" />
            </SelectTrigger>
            <SelectContent>
              {QUOTES.map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 px-3 h-8 rounded-md border border-border bg-surface-1">
            <span className="text-[10px] font-mono uppercase text-muted-foreground">Min</span>
            <span className="numeric text-xs text-foreground font-medium">
              {filters.minSpreadBps} bps
            </span>
            <Slider
              value={[filters.minSpreadBps]}
              onValueChange={(v) => setFilters({ minSpreadBps: v[0] })}
              min={0}
              max={200}
              step={5}
              className="w-24"
              aria-label="Minimum spread in basis points"
            />
          </div>
        </div>

        <div className="w-full md:w-64">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search asset or exchange…"
          />
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={sortedOpps}
        rowKey={(o) => `${o.asset}-${o.marketType}`}
        loading={isLoading}
        error={error?.message ?? null}
        onRetry={() => refetch()}
        onRowClick={(o) => setSelectedAsset(o.asset)}
        renderMobileCard={(o) => (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div>
                <div className="font-mono font-semibold text-foreground">{o.asset}</div>
                <div className="text-[10px] text-muted-foreground">
                  {o.bestBuyExchange} → {o.bestSellExchange}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="numeric font-semibold text-up">+{o.spreadBps.toFixed(1)} bps</div>
              <Tag variant={o.marketType === 'perp' ? 'accent' : 'default'}>{o.marketType}</Tag>
            </div>
          </div>
        )}
        emptyTitle="No active spreads"
        emptyDescription={
          search ? `Nothing matches "${search}".` : 'Try lowering the minimum spread filter.'
        }
        sort={{ column: 'spread', direction: 'desc' }}
        height="calc(100vh - 480px)"
        aria-label="Price arbitrage opportunities"
      />

      {/* Detail drawer (Dialog on mobile, side sheet on desktop) */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedAsset(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected?.asset}
              {selected && (
                <Tag variant={selected.marketType === 'perp' ? 'accent' : 'default'}>
                  {selected.marketType}
                </Tag>
              )}
            </DialogTitle>
            <DialogDescription>
              All exchange quotes for {selected?.asset} ({selected?.quoteCurrency} pair)
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-4 scrollbar-thin">
              {/* Best opportunity summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-success/30 bg-success/5 p-3">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">
                    Buy on
                  </div>
                  <div className="font-mono text-sm font-semibold text-foreground capitalize">
                    {selected.bestBuyExchange}
                  </div>
                  <div className="numeric text-xs text-up mt-1">
                    ${formatPrice(selected.buyPrice)}
                  </div>
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">
                    Sell on
                  </div>
                  <div className="font-mono text-sm font-semibold text-foreground capitalize">
                    {selected.bestSellExchange}
                  </div>
                  <div className="numeric text-xs text-down mt-1">
                    ${formatPrice(selected.sellPrice)}
                  </div>
                </div>
              </div>

              {/* All quotes */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                  All venues
                </div>
                <ul className="space-y-1">
                  {[...selected.quotes]
                    .sort((a, b) => a.price - b.price)
                    .map((q, i, arr) => {
                      const isMin = i === 0;
                      const isMax = i === arr.length - 1;
                      return (
                        <li
                          key={q.exchange}
                          className={cn(
                            'flex items-center justify-between gap-2 px-2 py-1.5 rounded',
                            isMin && 'bg-success/5',
                            isMax && 'bg-destructive/5'
                          )}
                        >
                          <span className="font-mono text-sm text-foreground capitalize">
                            {q.exchange}
                          </span>
                          <span
                            className={cn(
                              'numeric text-sm',
                              isMin && 'text-up font-semibold',
                              isMax && 'text-down font-semibold',
                              !isMin && !isMax && 'text-foreground'
                            )}
                          >
                            ${formatPrice(q.price)}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>

              {/* Spread summary */}
              <div className="pt-3 border-t border-border flex items-baseline justify-between">
                <span className="text-[11px] text-muted-foreground">Spread</span>
                <ChangeText
                  value={selected.spreadBps / 100}
                  signed
                  size="md"
                  className="font-display font-bold text-up"
                />
                <span className="numeric text-xs text-muted-foreground ml-1">
                  ({selected.spreadBps.toFixed(2)} bps)
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
