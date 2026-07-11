/**
 * Order Book page — standalone full-depth visualization
 *
 * Differs from the workspace's inline preview: this is the power-user view
 * with deeper order book, cumulative depth chart, and larger bid/ask walls.
 * Linked from workspace "expand" action.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ArrowRight, Maximize2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { useStringParam } from '@/lib/url-state';
import { useOrderBook, useExchanges } from '@/lib/queries';
import { formatPrice } from '@/lib/format';
import { formatVolume } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { RESOURCE_POLICY } from '@/lib/resource-policy';

export default function OrderBookPage() {
  const [exchange, setExchange] = useStringParam('exchange', 'bybit');
  const [symbol, setSymbol] = useStringParam('symbol', 'BTC-USDT');
  const [type, setType] = useStringParam('type', 'spot');
  const [depth, setDepth] = useStringParam('depth', '50');

  const { data: exchangesData } = useExchanges();
  const exchanges = (exchangesData?.data ?? []).filter((e) => e.supported);

  const orderBook = useOrderBook(
    exchange,
    symbol,
    { type: type as 'spot' | 'perp', limit: parseInt(depth, 10) || 50 },
    { refreshMs: RESOURCE_POLICY.visibleOrderBookPollMs }
  );

  const ob = orderBook.data?.data;
  const bids = ob?.orderbook.bids ?? [];
  const asks = ob?.orderbook.asks ?? [];

  // Find max cumulative for depth chart scaling
  const maxTotal = useMemo(
    () => Math.max(...bids.map((b) => b.total), ...asks.map((a) => a.total), 1),
    [bids, asks]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Order Book"
        description="Standalone full-depth market view. For inline preview, use the Workspace."
        freshnessMeta={orderBook.data?.meta ?? null}
        actions={
          <Link
            to={`/workspace?exchange=${exchange}&symbol=${symbol}&type=${type}&timeframe=1h`}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Open in workspace <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        }
      />

      {/* Controls */}
      <Panel>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={exchange} onValueChange={setExchange}>
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue placeholder="Exchange" />
              </SelectTrigger>
              <SelectContent>
                {exchanges.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SegmentedControl
              value={type}
              onChange={(v) => setType(v)}
              options={[
                { value: 'spot', label: 'Spot' },
                { value: 'perp', label: 'Perp' },
              ]}
              size="sm"
              aria-label="Market type"
            />
          </div>

          <div className="flex-1 max-w-md">
            <SearchInput
              value={symbol}
              onValueChange={setSymbol}
              placeholder="Symbol (e.g. BTC-USDT)"
            />
          </div>

          <div className="flex items-center gap-2 px-3 h-8 rounded-md border border-border bg-surface-1">
            <span className="text-[10px] font-mono uppercase text-muted-foreground">Depth</span>
            <span className="numeric text-xs text-foreground font-medium">{depth}</span>
            <Slider
              value={[parseInt(depth, 10) || 50]}
              onValueChange={(v) => setDepth(v[0].toString())}
              min={10}
              max={200}
              step={10}
              className="w-24"
              aria-label="Order book depth"
            />
          </div>
        </div>
      </Panel>

      {/* Mid + spread stats */}
      {ob ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Panel>
            <Metric
              label="Mid Price"
              value={ob.midPrice ? `$${formatPrice(ob.midPrice)}` : '—'}
              mono
              size="md"
            />
          </Panel>
          <Panel>
            <Metric
              label="Spread"
              value={ob.spread !== null ? formatPrice(ob.spread) : '—'}
              mono
              size="md"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {ob.spreadPercent !== null ? `${ob.spreadPercent.toFixed(4)}%` : ''}
            </p>
          </Panel>
          <Panel>
            <Metric
              label="Bid Liquidity"
              value={`$${formatVolume(bids.reduce((s, b) => s + b.amount * b.price, 0))}`}
              mono
              size="md"
            />
            <p className="mt-1 text-[11px] text-up">Top {bids.length} levels</p>
          </Panel>
          <Panel>
            <Metric
              label="Ask Liquidity"
              value={`$${formatVolume(asks.reduce((s, a) => s + a.amount * a.price, 0))}`}
              mono
              size="md"
            />
            <p className="mt-1 text-[11px] text-down">Top {asks.length} levels</p>
          </Panel>
        </div>
      ) : orderBook.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : null}

      {/* Two-pane book */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Bids */}
        <Panel flush>
          <PanelHeader className="px-5 pt-5 mb-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-success" />
              <PanelTitle>Bids ({bids.length})</PanelTitle>
            </div>
            {ob && <FreshnessBadge meta={orderBook.data?.meta ?? null} compact />}
          </PanelHeader>
          <div className="p-5 pt-3">
            {orderBook.isLoading ? (
              <Skeleton className="h-96" />
            ) : bids.length > 0 ? (
              <BookSide rows={bids} side="bid" maxTotal={maxTotal} />
            ) : (
              <EmptyState title="No bids" compact />
            )}
          </div>
        </Panel>

        {/* Asks */}
        <Panel flush>
          <PanelHeader className="px-5 pt-5 mb-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <PanelTitle>Asks ({asks.length})</PanelTitle>
            </div>
          </PanelHeader>
          <div className="p-5 pt-3">
            {orderBook.isLoading ? (
              <Skeleton className="h-96" />
            ) : asks.length > 0 ? (
              <BookSide rows={asks} side="ask" maxTotal={maxTotal} />
            ) : (
              <EmptyState title="No asks" compact />
            )}
          </div>
        </Panel>
      </div>

      {/* Depth visualization */}
      {ob && bids.length > 0 && asks.length > 0 && (
        <Panel flush>
          <PanelHeader className="px-5 pt-5 mb-0">
            <div className="flex items-center gap-2">
              <Maximize2 className="h-4 w-4 text-accent" aria-hidden />
              <PanelTitle>Cumulative Depth</PanelTitle>
            </div>
          </PanelHeader>
          <div className="p-5 pt-3">
            <DepthChart bids={bids} asks={asks} midPrice={ob.midPrice} />
          </div>
        </Panel>
      )}
    </div>
  );
}

function BookSide({
  rows,
  side,
  maxTotal,
}: {
  rows: Array<{ price: number; amount: number; total: number }>;
  side: 'bid' | 'ask';
  maxTotal: number;
}) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono uppercase text-muted-foreground pb-2 border-b border-border">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div className="space-y-0.5 mt-1">
        {rows.map((row, i) => {
          const pct = (row.total / maxTotal) * 100;
          return (
            <div key={`${side}-${i}`} className="relative grid grid-cols-3 gap-2 text-xs py-0.5">
              <div
                className={cn(
                  'absolute inset-y-0 right-0',
                  side === 'bid' ? 'bg-success/10' : 'bg-destructive/10'
                )}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span
                className={cn(
                  'relative numeric font-medium',
                  side === 'bid' ? 'text-up' : 'text-down'
                )}
              >
                {formatPrice(row.price)}
              </span>
              <span className="relative numeric text-right text-foreground">
                {row.amount.toFixed(4)}
              </span>
              <span className="relative numeric text-right text-muted-foreground">
                {row.total.toFixed(4)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DepthChart({
  bids,
  asks,
  midPrice,
}: {
  bids: Array<{ price: number; amount: number; total: number }>;
  asks: Array<{ price: number; amount: number; total: number }>;
  midPrice: number | null;
}) {
  // Build depth-curve points: (price deviation from mid, cumulative total)
  const points = useMemo(() => {
    if (!midPrice)
      return { bids: [] as Array<[number, number]>, asks: [] as Array<[number, number]> };
    const bidPts = bids
      .filter((b) => b.price < midPrice)
      .map((b) => [((midPrice - b.price) / midPrice) * 100, b.total] as [number, number])
      .reverse();
    const askPts = asks
      .filter((a) => a.price > midPrice)
      .map((a) => [((a.price - midPrice) / midPrice) * 100, a.total] as [number, number]);
    return { bids: bidPts, asks: askPts };
  }, [bids, asks, midPrice]);

  const maxValue = Math.max(...points.bids.map((p) => p[1]), ...points.asks.map((p) => p[1]), 1);
  const maxDeviation = Math.max(
    ...points.bids.map((p) => p[0]),
    ...points.asks.map((p) => p[0]),
    1
  );

  return (
    <div className="relative h-64 w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* Asks (right side — positive deviation) */}
        <path
          d={`M 50,100 ${points.asks.map((p) => `L ${50 + (p[0] / maxDeviation) * 50},${100 - (p[1] / maxValue) * 100}`).join(' ')} L 100,100 Z`}
          fill="var(--color-destructive)"
          fillOpacity={0.2}
          stroke="var(--color-destructive)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {/* Bids (left side — negative deviation) */}
        <path
          d={`M 50,100 ${points.bids.map((p) => `L ${50 - (p[0] / maxDeviation) * 50},${100 - (p[1] / maxValue) * 100}`).join(' ')} L 0,100 Z`}
          fill="var(--color-success)"
          fillOpacity={0.2}
          stroke="var(--color-success)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {/* Mid line */}
        <line
          x1="50"
          y1="0"
          x2="50"
          y2="100"
          stroke="var(--color-border)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="absolute bottom-1 left-2 text-[10px] font-mono text-muted-foreground">
        -{maxDeviation.toFixed(2)}%
      </div>
      <div className="absolute bottom-1 right-2 text-[10px] font-mono text-muted-foreground">
        +{maxDeviation.toFixed(2)}%
      </div>
      <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-mono text-muted-foreground">
        mid {midPrice ? `$${formatPrice(midPrice)}` : '—'}
      </div>
    </div>
  );
}
