/**
 * Multi-Timeframe page — single symbol across 8 timeframes simultaneously
 *
 * Uses the existing CandlestickChart component (lightweight-charts). All 8
 * timeframes fetched in a single multi-timeframe API call.
 *
 * Mobile: single chart with timeframe tabs. Desktop: 2x4 grid of mini charts.
 */

import { useMemo, useState } from 'react';
import { LayoutGrid, Clock } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { CandlestickChart } from '@/components/candlestick-chart';
import { useStringParam, TIMEFRAMES, type TimeframeValue } from '@/lib/url-state';
import { useMultiTimeframeOhlcv, useExchanges } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { Timeframe } from '@lazuli/shared';

export default function MultiTFPage() {
  const [exchange, setExchange] = useStringParam('exchange', 'bybit');
  const [symbol, setSymbol] = useStringParam('symbol', 'BTC-USDT');
  const [type, setType] = useStringParam('type', 'spot');
  const [mobileTf, setMobileTf] = useState<TimeframeValue>('1h');

  const { data: exchangesData } = useExchanges();
  const exchanges = (exchangesData?.data ?? []).filter((e) => e.supported);

  const multi = useMultiTimeframeOhlcv(exchange, symbol, {
    timeframes: [...TIMEFRAMES] as Timeframe[],
    type: type as 'spot' | 'perp',
    limit: 200,
  });

  const tfData = multi.data?.data.timeframes ?? {};
  const timeframesWithData = useMemo(
    () => TIMEFRAMES.filter((tf) => tfData[tf]?.candles?.length),
    [tfData]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutGrid}
        title="Multi-Timeframe"
        description="One symbol, eight timeframes side-by-side. Spot trend alignment across horizons."
        freshnessMeta={multi.data?.meta ?? null}
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
        </div>
      </Panel>

      {multi.isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : timeframesWithData.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Clock}
            title="No multi-timeframe data"
            description="This symbol may not have OHLCV data on this exchange."
          />
        </Panel>
      ) : (
        <>
          {/* Mobile: tabs */}
          <div className="md:hidden">
            <Tabs value={mobileTf} onValueChange={(v) => setMobileTf(v as TimeframeValue)}>
              <TabsList className="w-full overflow-x-auto">
                {timeframesWithData.map((tf) => (
                  <TabsTrigger key={tf} value={tf}>
                    {tf}
                  </TabsTrigger>
                ))}
              </TabsList>
              {timeframesWithData.map((tf) => (
                <TabsContent key={tf} value={tf}>
                  <Panel>
                    <CandlestickChart
                      data={tfData[tf]?.candles ?? []}
                      timeframe={tf}
                      symbol={symbol}
                      height={320}
                      showToolbar={false}
                    />
                  </Panel>
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Desktop: 2x4 grid */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIMEFRAMES.map((tf) => {
              const ohlcv = tfData[tf]?.candles ?? [];
              const last = ohlcv[ohlcv.length - 1];
              const first = ohlcv[0];
              const change =
                last && first ? ((last.close - first.close) / first.close) * 100 : null;
              return (
                <Panel key={tf} flush className={cn(ohlcv.length === 0 && 'opacity-50')}>
                  <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                    <div>
                      <div className="font-display font-semibold text-sm text-foreground">{tf}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {ohlcv.length} candles
                      </div>
                    </div>
                    {change !== null && (
                      <div
                        className={cn(
                          'numeric text-xs font-semibold',
                          change >= 0 ? 'text-up' : 'text-down'
                        )}
                      >
                        {change >= 0 ? '+' : ''}
                        {change.toFixed(2)}%
                      </div>
                    )}
                  </div>
                  <div className="px-2 pb-2 h-44">
                    {ohlcv.length > 0 ? (
                      <CandlestickChart
                        data={ohlcv}
                        timeframe={tf}
                        symbol={symbol}
                        height={170}
                        showToolbar={false}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                        No data
                      </div>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
