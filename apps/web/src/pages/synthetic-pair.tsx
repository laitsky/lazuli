/**
 * Synthetic Pair page — relative-value ratio chart
 *
 * Generates a synthetic pair by dividing two symbols' OHLCV (e.g. BTC/AVAX).
 * Useful for cross-pair analysis without needing the pair to exist on an exchange.
 *
 * URL state: exchange, symbol1 (numerator), symbol2 (denominator), type, timeframe.
 */

import { useMemo } from 'react';
import { GitCompareArrows, ArrowRight } from 'lucide-react';
import type { Timeframe } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Metric } from '@/components/ui/metric';
import { CandlestickChart } from '@/components/candlestick-chart';
import { useStringParam, TIMEFRAMES } from '@/lib/url-state';
import { useCustomPair, useExchanges } from '@/lib/queries';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

function formatBase(symbol: string): string {
  if (symbol.endsWith('.P')) return symbol.slice(0, -2).replace(/USDT$|USDC$|USD$/, '');
  return symbol.split('-')[0];
}

export default function SyntheticPairPage() {
  const [exchange, setExchange] = useStringParam('exchange', 'bybit');
  const [symbol1, setSymbol1] = useStringParam('symbol1', 'BTC-USDT');
  const [symbol2, setSymbol2] = useStringParam('symbol2', 'ETH-USDT');
  const [type, setType] = useStringParam('type', 'spot');
  const [timeframe, setTimeframe] = useStringParam('timeframe', '1h');

  const { data: exchangesData } = useExchanges();
  const exchanges = (exchangesData?.data ?? []).filter((e) => e.supported);

  const pair = useCustomPair(exchange, symbol1, symbol2, {
    timeframe: timeframe as Timeframe,
    type: type as 'spot' | 'perp',
    limit: 300,
  });

  const candles = pair.data?.candles ?? [];
  const customSymbol =
    pair.data?.customPairSymbol ?? `${formatBase(symbol1)}/${formatBase(symbol2)}`;

  // Compute stats
  const stats = useMemo(() => {
    if (candles.length === 0) return null;
    const first = candles[0];
    const last = candles[candles.length - 1];
    const change = ((last.close - first.close) / first.close) * 100;
    const high = Math.max(...candles.map((c) => c.high));
    const low = Math.min(...candles.map((c) => c.low));
    return { last: last.close, change, high, low };
  }, [candles]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitCompareArrows}
        title="Synthetic Pair"
        description="Generate a ratio chart from any two symbols. Analyze cross-pair relationships that don't exist as direct markets."
        freshnessMeta={pair.data ? null : null}
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
            <SegmentedControl
              value={timeframe}
              onChange={(v) => setTimeframe(v)}
              options={TIMEFRAMES.slice(2).map((tf) => ({ value: tf, label: tf }))}
              size="sm"
              aria-label="Timeframe"
            />
          </div>
        </div>

        {/* Symbol selector row */}
        <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Numerator
            </label>
            <SearchInput value={symbol1} onValueChange={setSymbol1} placeholder="BTC-USDT" />
          </div>
          <div className="hidden sm:flex items-end pb-2">
            <span className="h-9 w-9 rounded-md border border-border bg-surface-2 flex items-center justify-center">
              <span className="text-muted-foreground font-mono">÷</span>
            </span>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Denominator
            </label>
            <SearchInput value={symbol2} onValueChange={setSymbol2} placeholder="ETH-USDT" />
          </div>
        </div>
      </Panel>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Panel>
            <Metric label="Ratio" value={formatPrice(stats.last)} mono size="md" />
            <p className="mt-1 text-[11px] text-muted-foreground font-mono">{customSymbol}</p>
          </Panel>
          <Panel>
            <Metric
              label="Period Change"
              value={`${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)}%`}
              mono
              size="md"
            />
          </Panel>
          <Panel>
            <Metric label="Period High" value={formatPrice(stats.high)} mono size="md" />
          </Panel>
          <Panel>
            <Metric label="Period Low" value={formatPrice(stats.low)} mono size="md" />
          </Panel>
        </div>
      )}

      {/* Chart */}
      <Panel flush>
        <PanelHeader className="px-5 pt-5 mb-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              {formatBase(symbol1)}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            <span className="font-mono text-sm text-muted-foreground">{formatBase(symbol2)}</span>
            <span className="ml-2 text-[10px] font-mono uppercase text-muted-foreground">
              {timeframe} · {candles.length} candles
            </span>
          </div>
        </PanelHeader>
        <div className="p-5 pt-3">
          {pair.isLoading ? (
            <Skeleton className="h-[400px]" />
          ) : candles.length > 0 ? (
            <CandlestickChart
              data={candles}
              timeframe={timeframe as Timeframe}
              symbol={customSymbol}
              height={400}
              showToolbar={true}
            />
          ) : (
            <EmptyState
              icon={GitCompareArrows}
              title="No synthetic pair data"
              description="Select two valid symbols from the same exchange. Both must have OHLCV history."
            />
          )}
        </div>
      </Panel>

      {pair.error && (
        <Panel className={cn('border-destructive/30 bg-destructive/5')}>
          <p className="text-sm text-destructive">{pair.error.message}</p>
        </Panel>
      )}
    </div>
  );
}
