/**
 * SuperEMA page — 1-400 EMA trend heatmap on candlesticks
 *
 * Manages a lightweight-charts instance directly (400 line series + candles).
 * The chart logic is intricate; this rewrite modernizes the shell + data
 * fetching but preserves the chart-rendering approach.
 */

import { useEffect, useRef } from 'react';
import { Activity, LineChart as LineChartIcon } from 'lucide-react';
import {
  createChart,
  type IChartApi,
  type LineData,
  type CandlestickData,
  type Time,
  ColorType,
} from 'lightweight-charts';
import type { Timeframe } from '@lazuli/shared';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Metric } from '@/components/ui/metric';
import { useStringParam, TIMEFRAMES } from '@/lib/url-state';
import { useSuperEma, useExchanges } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Hex color for an EMA period — rainbow from red (short) → blue (long) */
function getEMAColor(period: number): string {
  // Hue: 0 (red) for short → 240 (blue) for long
  const hue = Math.min((period / 400) * 240, 240);
  const saturation = 70;
  const lightness = 55;
  return hslToHex(hue, saturation, lightness);
}

/**
 * Convert HSL channels to hex because lightweight-charts rejects CSS Color 4
 * and some HSL string formats.
 */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const huePrime = hue / 60;
  const secondComponent = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = normalizedLightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = secondComponent;
  } else if (huePrime >= 1 && huePrime < 2) {
    red = secondComponent;
    green = chroma;
  } else if (huePrime >= 2 && huePrime < 3) {
    green = chroma;
    blue = secondComponent;
  } else if (huePrime >= 3 && huePrime < 4) {
    green = secondComponent;
    blue = chroma;
  } else if (huePrime >= 4 && huePrime < 5) {
    red = secondComponent;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondComponent;
  }

  return [red, green, blue]
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .padStart(6, '0')
    .replace(/^/, '#');
}

export default function SuperEMAPage() {
  const [exchange, setExchange] = useStringParam('exchange', 'bybit');
  const [symbol, setSymbol] = useStringParam('symbol', 'BTC-USDT');
  const [type, setType] = useStringParam('type', 'spot');
  const [timeframe, setTimeframe] = useStringParam('timeframe', '1h');
  const [maxPeriod, setMaxPeriod] = useStringParam('maxPeriod', '200');

  const { data: exchangesData } = useExchanges();
  const exchanges = (exchangesData?.data ?? []).filter((e) => e.supported);

  const ema = useSuperEma(exchange, symbol, {
    timeframe: timeframe as Timeframe,
    type: type as 'spot' | 'perp',
    maxPeriod: parseInt(maxPeriod, 10) || 200,
  });

  const emaResponse = ema.data; // SuperEMAResponse | undefined
  const points = emaResponse?.data ?? []; // EMADataPoint[]
  const periods = emaResponse?.periods ?? [];
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (points.length === 0 || periods.length === 0 || !containerRef.current) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8f99a8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(38, 43, 54, 0.5)' },
        horzLines: { color: 'rgba(38, 43, 54, 0.5)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#262b36' },
      timeScale: { borderColor: '#262b36', timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 500,
    });
    chartRef.current = chart;

    // Candlesticks
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#2eb879',
      downColor: '#e34444',
      borderUpColor: '#2eb879',
      borderDownColor: '#e34444',
      wickUpColor: '#2eb879',
      wickDownColor: '#e34444',
    });
    const candleData: CandlestickData[] = points.map((p) => ({
      time: (p.timestamp / 1000) as Time,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
    }));
    candleSeries.setData(candleData);

    // EMA lines
    for (const period of periods) {
      const lineSeries = chart.addLineSeries({
        color: getEMAColor(period),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const lineData: LineData[] = points
        .filter((p) => p.emas[period] !== undefined)
        .map((p) => ({
          time: (p.timestamp / 1000) as Time,
          value: p.emas[period],
        }));
      lineSeries.setData(lineData);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [points, periods]);

  // Compute trend Strength (last candle vs longest EMA)
  const trendStrength = (() => {
    if (points.length === 0 || periods.length === 0) return null;
    const last = points[points.length - 1];
    const longestPeriod = periods[periods.length - 1];
    const longestEma = last.emas[longestPeriod];
    if (!longestEma) return null;
    return ((last.close - longestEma) / longestEma) * 100;
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Activity}
        title="SuperEMA"
        description="Candles overlaid with 1-N EMA lines, rainbow-colored (red=fast, blue=slow). Spot trend alignment and mean-reversion extremes."
        freshnessMeta={ema.data ? null : null}
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

          <div className="flex-1 max-w-md">
            <SearchInput
              value={symbol}
              onValueChange={setSymbol}
              placeholder="Symbol (e.g. BTC-USDT)"
            />
          </div>

          <div className="flex items-center gap-2 px-3 h-8 rounded-md border border-border bg-surface-1">
            <span className="text-[10px] font-mono uppercase text-muted-foreground">EMAs</span>
            <span className="numeric text-xs text-foreground font-medium">1-{maxPeriod}</span>
            <Slider
              value={[parseInt(maxPeriod, 10) || 200]}
              onValueChange={(v) => setMaxPeriod(v[0].toString())}
              min={20}
              max={400}
              step={20}
              className="w-24"
              aria-label="Max EMA period"
            />
          </div>
        </div>
      </Panel>

      {/* Stats */}
      {trendStrength !== null && (
        <div className="grid grid-cols-3 gap-3">
          <Panel>
            <Metric
              label="Trend Strength"
              value={`${trendStrength >= 0 ? '+' : ''}${trendStrength.toFixed(2)}%`}
              mono
              size="md"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Price vs longest EMA</p>
          </Panel>
          <Panel>
            <Metric label="EMA Periods" value={`1-${maxPeriod}`} mono size="md" />
            <p className="mt-1 text-[11px] text-muted-foreground">Rainbow gradient</p>
          </Panel>
          <Panel>
            <Metric label="Candles" value={points.length.toString()} mono size="md" />
            <p className="mt-1 text-[11px] text-muted-foreground">{timeframe} resolution</p>
          </Panel>
        </div>
      )}

      {/* Chart */}
      <Panel flush>
        <PanelHeader className="px-5 pt-5 mb-0">
          <div className="flex items-center gap-2">
            <LineChartIcon className="h-4 w-4 text-accent" aria-hidden />
            <PanelTitle>
              {symbol.replace('-', '/').replace('.P', ' PERP')} · {timeframe}
            </PanelTitle>
          </div>
          {/* Legend */}
          <div className="hidden md:flex items-center gap-3 text-[10px] font-mono">
            <LegendSwatch color={getEMAColor(20)} label="20" />
            <LegendSwatch color={getEMAColor(50)} label="50" />
            <LegendSwatch color={getEMAColor(100)} label="100" />
            <LegendSwatch color={getEMAColor(200)} label="200" />
            <LegendSwatch color={getEMAColor(400)} label="400" />
          </div>
        </PanelHeader>
        <div className="p-5 pt-3">
          {ema.isLoading ? (
            <Skeleton className="h-[500px]" />
          ) : points.length > 0 ? (
            <div ref={containerRef} className="w-full" style={{ height: 500 }} />
          ) : (
            <EmptyState
              icon={Activity}
              title="No EMA data"
              description="This symbol may not have enough OHLCV history for EMA calculation."
            />
          )}
        </div>
      </Panel>

      {ema.error && (
        <Panel className="border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">{ema.error.message}</p>
        </Panel>
      )}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={cn('inline-block h-0.5 w-3 rounded-full')}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
