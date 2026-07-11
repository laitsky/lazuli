/**
 * Workspace — single-symbol analysis cockpit
 *
 * Combines:
 *  - Main candlestick chart (lightweight-charts) with SMA/EMA/RSI overlays
 *  - Right rail: order book preview, perp funding, key stats
 *  - Header: symbol/exchange/type/timeframe controls + star + share
 *
 * State: full URL state via useWorkspaceFilters — shareable links, back/forward.
 * Mobile: stacked layout — chart first, then order book, then funding.
 */

import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Star, Share2, BookOpen, Activity, ChevronRight, Flame, Waves } from 'lucide-react';
import type { LiquidationRadarResponse, OrderFlowResponse } from '@lazuli/shared';
import { CandlestickChartWithIndicators } from '@/components/candlestick-chart-with-indicators';
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
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { Metric } from '@/components/ui/metric';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { PriceText } from '@/components/ui/price-text';
import { Tag } from '@/components/ui/tag';
import { Toggle } from '@/components/ui/toggle';
import { useStringParam, TIMEFRAMES, type TimeframeValue } from '@/lib/url-state';
import {
  useExchanges,
  useTicker,
  useTechnicalIndicators,
  useOrderBook,
  useLiquidationRadar,
  useOrderFlow,
} from '@/lib/queries';
import { usePreferences, watchlistKey } from '@/lib/preferences';
import { formatPrice } from '@/lib/format';
import { formatVolume } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { RESOURCE_POLICY } from '@/lib/resource-policy';
import { toast } from 'sonner';

// Workspace filters (not using useWorkspaceFilters because we want fine control over each param)
function useWorkspaceParams() {
  const [exchange, setExchange] = useStringParam('exchange', 'bybit');
  const [symbol, setSymbol] = useStringParam('symbol', 'BTC-USDT');
  const [type, setType] = useStringParam('type', 'spot');
  const [timeframe, setTimeframe] = useStringParam('timeframe', '1h');
  const [layers, setLayers] = useStringParam('layers', RESOURCE_POLICY.defaultWorkspaceLayers);
  return {
    exchange,
    symbol,
    type: type as 'spot' | 'perp',
    timeframe: timeframe as TimeframeValue,
    layers,
    setExchange,
    setSymbol,
    setType,
    setTimeframe,
    setLayers,
  };
}

export default function MarketWorkspacePage() {
  const params = useWorkspaceParams();
  const { exchange, symbol, type, timeframe } = params;
  const { data: exchangesData } = useExchanges();
  const { toggleWatchlist, isWatched } = usePreferences();

  // Primary data
  const ticker = useTicker(exchange, symbol);
  const indicators = useTechnicalIndicators(exchange, symbol, {
    timeframe,
    type,
  });
  const orderBook = useOrderBook(exchange, symbol, { type, limit: 20 }, { refreshMs: 10_000 });
  const activeLayers = useMemo(
    () =>
      new Set(
        params.layers
          .split(',')
          .map((layer) => layer.trim())
          .filter(Boolean)
      ),
    [params.layers]
  );
  const liquidationLayer = activeLayers.has('liquidations');
  const cvdLayer = activeLayers.has('cvd');
  const liquidations = useLiquidationRadar(
    exchange,
    symbol,
    {},
    { enabled: type === 'perp' && liquidationLayer, refreshMs: 15_000 }
  );
  const orderFlow = useOrderFlow(
    exchange,
    symbol,
    { timeframe, type, limit: 160 },
    { enabled: cvdLayer, refreshMs: 30_000 }
  );

  const selectedTicker = ticker.data?.data ?? null;
  const watched = isWatched(watchlistKey(exchange, symbol));
  const indicatorData = indicators.data?.data ?? [];
  const indicatorConfig = indicators.data
    ? {
        sma: [20, 50, 200],
        ema: [9, 12, 21, 26],
        rsi: [14],
      }
    : null;

  const exchanges = exchangesData?.data ?? [];

  const setLayer = (layer: 'liquidations' | 'cvd', enabled: boolean) => {
    const next = new Set(activeLayers);
    if (enabled) {
      next.add(layer);
    } else {
      next.delete(layer);
    }
    params.setLayers(Array.from(next).join(','));
  };

  const onShare = () => {
    const url = window.location.href;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Workspace URL copied to clipboard'))
      .catch(() => toast.error('Could not copy URL'));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace"
        description="Deep single-symbol analysis with chart, order book, and funding."
        freshnessMeta={ticker.data?.meta ?? null}
        actions={
          <>
            <IconButton
              aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
              icon={Star}
              variant="outline"
              onClick={() => toggleWatchlist(watchlistKey(exchange, symbol))}
              className={cn(watched && 'text-warning')}
            />
            <Button variant="outline" size="sm" onClick={onShare}>
              <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
            </Button>
          </>
        }
      />

      {/* Header controls — exchange / type / symbol search / timeframe */}
      <Panel>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={exchange} onValueChange={params.setExchange}>
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue placeholder="Exchange" />
              </SelectTrigger>
              <SelectContent>
                {exchanges
                  .filter((e) => e.supported)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <SegmentedControl
              value={type}
              onChange={(v) => params.setType(v)}
              options={[
                { value: 'spot', label: 'Spot' },
                { value: 'perp', label: 'Perp' },
              ]}
              size="sm"
              aria-label="Market type"
            />
            <Tag variant={type === 'perp' ? 'accent' : 'default'}>{exchange}</Tag>
          </div>

          <div className="flex flex-1 max-w-md">
            <SearchInput
              value={symbol}
              onValueChange={params.setSymbol}
              placeholder="Symbol (e.g. BTC-USDT)"
            />
          </div>

          <SegmentedControl
            value={timeframe}
            onChange={(v) => params.setTimeframe(v)}
            options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
            size="sm"
            aria-label="Timeframe"
          />

          <div className="flex items-center gap-1">
            <Toggle
              size="sm"
              pressed={liquidationLayer}
              disabled={type !== 'perp'}
              onPressedChange={(pressed) => setLayer('liquidations', pressed)}
              aria-label="Toggle liquidation radar"
            >
              <Flame className="h-3.5 w-3.5" aria-hidden />
            </Toggle>
            <Toggle
              size="sm"
              pressed={cvdLayer}
              onPressedChange={(pressed) => setLayer('cvd', pressed)}
              aria-label="Toggle CVD overlay"
            >
              <Waves className="h-3.5 w-3.5" aria-hidden />
            </Toggle>
          </div>
        </div>
      </Panel>

      {/* Main grid: chart + right rail */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Chart column */}
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {selectedTicker ? (
              <>
                <Panel>
                  <Metric
                    label="Last Price"
                    value={formatPrice(selectedTicker.last ?? 0)}
                    mono
                    size="md"
                  />
                </Panel>
                <Panel>
                  <Metric
                    label="24h Change"
                    value={`${selectedTicker.percentage24h !== null && selectedTicker.percentage24h >= 0 ? '+' : ''}${(selectedTicker.percentage24h ?? 0).toFixed(2)}%`}
                    mono
                    size="md"
                  />
                </Panel>
                <Panel>
                  <Metric
                    label="24h Volume"
                    value={`$${formatVolume(selectedTicker.quoteVolume24h ?? 0)}`}
                    mono
                    size="md"
                  />
                </Panel>
                <Panel>
                  <Metric
                    label="24h High / Low"
                    value={`${formatPrice(selectedTicker.high24h ?? 0)} / ${formatPrice(selectedTicker.low24h ?? 0)}`}
                    mono
                    size="sm"
                  />
                </Panel>
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
            )}
          </div>

          {/* Chart */}
          <Panel flush>
            <PanelHeader className="px-5 pt-5 mb-0">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" aria-hidden />
                <PanelTitle>
                  {symbol.replace('-', '/').replace('.P', ' PERP')} · {timeframe}
                </PanelTitle>
              </div>
              {selectedTicker && (
                <PriceText
                  value={selectedTicker.last}
                  changePercent={selectedTicker.percentage24h}
                  size="md"
                />
              )}
            </PanelHeader>
            <div className="p-5 pt-3">
              {indicators.isLoading && indicatorData.length === 0 ? (
                <Skeleton className="h-[400px]" />
              ) : indicatorData.length > 0 ? (
                <CandlestickChartWithIndicators
                  data={indicatorData}
                  timeframe={timeframe}
                  symbol={symbol}
                  height={400}
                  availableSMA={indicatorConfig?.sma}
                  availableEMA={indicatorConfig?.ema}
                  availableRSI={indicatorConfig?.rsi}
                />
              ) : (
                <EmptyState
                  icon={Activity}
                  title="No chart data"
                  description="This symbol may not have OHLCV data on this exchange/timeframe."
                />
              )}
            </div>
          </Panel>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Order book */}
          <Panel flush>
            <PanelHeader className="px-5 pt-5 mb-0">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-accent" aria-hidden />
                <PanelTitle>Order Book</PanelTitle>
              </div>
              {orderBook.data && <FreshnessBadge meta={orderBook.data.meta} compact />}
            </PanelHeader>
            <div className="p-5 pt-3">
              {orderBook.isLoading ? (
                <Skeleton className="h-48" />
              ) : orderBook.data?.data ? (
                <OrderBookPreview
                  midPrice={orderBook.data.data.midPrice}
                  spread={orderBook.data.data.spread}
                  spreadPercent={orderBook.data.data.spreadPercent}
                  asks={orderBook.data.data.orderbook.asks.slice(0, 6)}
                  bids={orderBook.data.data.orderbook.bids.slice(0, 6)}
                />
              ) : (
                <EmptyState title="Order book unavailable" compact />
              )}
            </div>
          </Panel>

          {type === 'perp' && liquidationLayer && (
            <Panel flush>
              <PanelHeader className="px-5 pt-5 mb-0">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-accent" aria-hidden />
                  <PanelTitle>Liquidation Radar</PanelTitle>
                </div>
                {liquidations.data && <FreshnessBadge meta={liquidations.data.meta} compact />}
              </PanelHeader>
              <div className="p-5 pt-3">
                {liquidations.isLoading ? (
                  <Skeleton className="h-40" />
                ) : liquidations.data?.data ? (
                  <LiquidationRadarPreview radar={liquidations.data.data} />
                ) : (
                  <EmptyState title="Liquidations unavailable" compact />
                )}
              </div>
            </Panel>
          )}

          {cvdLayer && (
            <Panel flush>
              <PanelHeader className="px-5 pt-5 mb-0">
                <div className="flex items-center gap-2">
                  <Waves className="h-4 w-4 text-accent" aria-hidden />
                  <PanelTitle>CVD Overlay</PanelTitle>
                </div>
                {orderFlow.data && <FreshnessBadge meta={orderFlow.data.meta} compact />}
              </PanelHeader>
              <div className="p-5 pt-3">
                {orderFlow.isLoading ? (
                  <Skeleton className="h-40" />
                ) : orderFlow.data?.data ? (
                  <OrderFlowPreview flow={orderFlow.data.data} />
                ) : (
                  <EmptyState title="CVD unavailable" compact />
                )}
              </div>
            </Panel>
          )}

          {/* Continue in */}
          <Panel flush>
            <PanelHeader className="px-5 pt-5 mb-0">
              <PanelTitle>Continue in</PanelTitle>
            </PanelHeader>
            <div className="p-5 pt-3 space-y-1">
              <ContinueLink
                to={`/superema?exchange=${exchange}&symbol=${symbol}&type=${type}&timeframe=${timeframe}`}
                icon={Activity}
                label="SuperEMA"
                description="400-EMA trend heatmap"
              />
              <ContinueLink
                to={`/multi-timeframe?exchange=${exchange}&symbol=${symbol}&type=${type}`}
                icon={ChevronRight}
                label="Multi-Timeframe"
                description="Trend across timeframes"
              />
              <ContinueLink
                to={`/synthetic-pair?exchange=${exchange}&symbol1=${symbol}&symbol2=BTC-USDT&type=${type}&timeframe=${timeframe}`}
                icon={ChevronRight}
                label="Synthetic Pair"
                description="Relative-value ratio"
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function LiquidationRadarPreview({ radar }: { radar: LiquidationRadarResponse }) {
  const topLevels = [...radar.levels].sort((a, b) => b.intensity - a.intensity).slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 pb-3 border-b border-border">
        <div>
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Mark</div>
          <div className="numeric text-sm font-semibold text-foreground">
            {radar.markPrice ? `$${formatPrice(radar.markPrice)}` : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase text-muted-foreground">OI</div>
          <div className="numeric text-sm font-semibold text-foreground">
            {radar.openInterestUsd ? `$${formatVolume(radar.openInterestUsd)}` : '—'}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {topLevels.map((level) => (
          <div
            key={`${level.side}-${level.leverage}`}
            className="grid grid-cols-[54px_1fr_70px] items-center gap-2 text-xs"
          >
            <Tag variant={level.side === 'long' ? 'default' : 'accent'}>
              {level.side === 'long' ? 'Long' : 'Short'}
            </Tag>
            <div className="min-w-0">
              <div className="numeric truncate text-foreground">
                {level.leverage}x @ ${formatPrice(level.price)}
              </div>
              <div className="h-1 rounded bg-surface-2">
                <div
                  className={cn('h-1 rounded', level.side === 'long' ? 'bg-down' : 'bg-up')}
                  style={{ width: `${Math.round(level.intensity * 100)}%` }}
                />
              </div>
            </div>
            <div className="numeric text-right text-muted-foreground">
              {level.distancePercent.toFixed(2)}%
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Estimated from mark, OI, leverage buckets, and nearby book liquidity.
      </p>
    </div>
  );
}

function OrderFlowPreview({ flow }: { flow: OrderFlowResponse }) {
  const latest = flow.points[flow.points.length - 1];
  const recent = flow.points.slice(-24);
  const maxDelta = Math.max(...recent.map((point) => Math.abs(point.delta)), 1);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 pb-3 border-b border-border">
        <div>
          <div className="text-[10px] font-mono uppercase text-muted-foreground">CVD</div>
          <div
            className={cn(
              'numeric text-sm font-semibold',
              flow.summary.cumulativeDelta >= 0 ? 'text-up' : 'text-down'
            )}
          >
            {formatVolume(flow.summary.cumulativeDelta)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Divergence</div>
          <div className="text-sm font-semibold capitalize text-foreground">
            {flow.summary.divergence}
          </div>
        </div>
      </div>

      <div className="flex h-14 items-end gap-0.5">
        {recent.map((point) => (
          <div
            key={point.timestamp}
            className={cn('flex-1 rounded-t', point.delta >= 0 ? 'bg-up/70' : 'bg-down/70')}
            style={{ height: `${Math.max(10, (Math.abs(point.delta) / maxDelta) * 100)}%` }}
            title={`${new Date(point.timestamp).toLocaleString()} ${formatVolume(point.delta)}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Absorption</div>
          <div className="capitalize text-foreground">{flow.summary.absorption}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Latest Delta</div>
          <div className="numeric text-foreground">{latest ? formatVolume(latest.delta) : '—'}</div>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Candle-derived proxy until trade-tape WebSocket deltas are available.
      </p>
    </div>
  );
}

function OrderBookPreview({
  midPrice,
  spread,
  spreadPercent,
  asks,
  bids,
}: {
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  asks: Array<{ price: number; amount: number; total: number }>;
  bids: Array<{ price: number; amount: number; total: number }>;
}) {
  // Find max cumulative total for depth bar scaling
  const maxTotal = Math.max(...asks.map((a) => a.total), ...bids.map((b) => b.total), 1);

  return (
    <div className="space-y-3">
      {/* Mid + spread */}
      <div className="grid grid-cols-2 gap-2 pb-3 border-b border-border">
        <div>
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Mid</div>
          <div className="numeric text-sm font-semibold text-foreground">
            ${midPrice ? formatPrice(midPrice) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Spread</div>
          <div className="numeric text-sm font-semibold text-foreground">
            {spread !== null ? formatPrice(spread) : '—'}
            {spreadPercent !== null && (
              <span className="text-[10px] text-muted-foreground ml-1">
                ({spreadPercent.toFixed(3)}%)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono uppercase text-muted-foreground">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (reversed — highest at top) */}
      <div className="space-y-0.5">
        {[...asks].reverse().map((row, i) => (
          <BookRow key={`a-${i}`} row={row} side="ask" maxTotal={maxTotal} />
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border my-1" />

      {/* Bids */}
      <div className="space-y-0.5">
        {bids.map((row, i) => (
          <BookRow key={`b-${i}`} row={row} side="bid" maxTotal={maxTotal} />
        ))}
      </div>
    </div>
  );
}

function BookRow({
  row,
  side,
  maxTotal,
}: {
  row: { price: number; amount: number; total: number };
  side: 'bid' | 'ask';
  maxTotal: number;
}) {
  const pct = (row.total / maxTotal) * 100;
  return (
    <div className="relative grid grid-cols-3 gap-2 text-xs py-0.5">
      {/* Depth bar */}
      <div
        className={cn(
          'absolute inset-y-0 right-0',
          side === 'bid' ? 'bg-success/10' : 'bg-destructive/10'
        )}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <span className={cn('relative numeric', side === 'bid' ? 'text-up' : 'text-down')}>
        {formatPrice(row.price)}
      </span>
      <span className="relative numeric text-right text-muted-foreground">
        {row.amount.toFixed(4)}
      </span>
      <span className="relative numeric text-right text-muted-foreground">
        {row.total.toFixed(4)}
      </span>
    </div>
  );
}

function ContinueLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 px-2 py-2 rounded',
        'hover:bg-surface-2 transition-colors no-tap-highlight'
      )}
    >
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
    </Link>
  );
}
