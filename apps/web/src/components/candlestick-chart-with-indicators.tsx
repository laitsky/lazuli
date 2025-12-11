import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  createChart,
  ColorType,
  Time,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
} from 'lightweight-charts';
import { Timeframe, IndicatorDataPoint, DEFAULT_INDICATOR_PERIODS } from '@lazuli/shared';
import { calculatePricePrecision, formatPrice } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Activity, BarChart3 } from 'lucide-react';

/**
 * Predefined colors for indicator lines
 * Uses a color scheme that's visually distinct and readable on dark backgrounds
 */
const INDICATOR_COLORS = {
  // SMA colors - Blue spectrum (cooler tones for slower indicators)
  sma: {
    20: '#3b82f6', // Blue - Short term
    50: '#8b5cf6', // Violet - Medium term
    200: '#ec4899', // Pink - Long term
  } as Record<number, string>,
  // EMA colors - Orange/Yellow spectrum (warmer tones for faster indicators)
  ema: {
    9: '#f59e0b', // Amber - Very short term
    12: '#f97316', // Orange
    21: '#ef4444', // Red
    26: '#dc2626', // Dark Red
  } as Record<number, string>,
  // RSI colors
  rsi: {
    line: '#22d3ee', // Cyan
    overbought: 'rgba(239, 68, 68, 0.3)', // Red with transparency
    oversold: 'rgba(34, 197, 94, 0.3)', // Green with transparency
  },
};

/**
 * Get color for an indicator line
 * Falls back to a generated color if period not in predefined colors
 */
function getIndicatorColor(type: 'sma' | 'ema', period: number): string {
  const colors = INDICATOR_COLORS[type];
  if (colors[period]) {
    return colors[period];
  }
  // Generate a color based on period for non-standard periods
  const hue = type === 'sma' ? 200 + (period % 60) * 2 : 30 + (period % 60) * 2;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Props for the CandlestickChartWithIndicators component
 */
interface CandlestickChartWithIndicatorsProps {
  /** Indicator data with OHLCV and calculated indicator values */
  data: IndicatorDataPoint[];
  /** Timeframe label for the chart title */
  timeframe: Timeframe;
  /** Optional chart title prefix (e.g., "BTC/USDT") */
  symbol?: string;
  /** Chart height in pixels (default: 400) */
  height?: number;
  /** Available SMA periods from the API response */
  availableSMA?: number[];
  /** Available EMA periods from the API response */
  availableEMA?: number[];
  /** Available RSI periods from the API response */
  availableRSI?: number[];
  /** Show indicator controls (default: true) */
  showControls?: boolean;
}

/**
 * Enhanced candlestick chart component with technical indicator overlays
 *
 * Features:
 * - SMA (Simple Moving Average) overlays with customizable periods
 * - EMA (Exponential Moving Average) overlays with customizable periods
 * - RSI (Relative Strength Index) in a separate panel below the chart
 * - Interactive controls to toggle indicators on/off
 * - Color-coded lines for easy identification
 *
 * Uses TradingView Lightweight Charts v4 for rendering
 */
export function CandlestickChartWithIndicators({
  data,
  timeframe,
  symbol,
  height = 400,
  availableSMA = DEFAULT_INDICATOR_PERIODS.sma as unknown as number[],
  availableEMA = DEFAULT_INDICATOR_PERIODS.ema as unknown as number[],
  availableRSI = DEFAULT_INDICATOR_PERIODS.rsi as unknown as number[],
  showControls = true,
}: CandlestickChartWithIndicatorsProps) {
  // Chart container refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);

  // Chart API refs
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  // Series refs for updating data
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const smaSeriesRefs = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const emaSeriesRefs = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // State for indicator visibility
  const [visibleSMA, setVisibleSMA] = useState<Set<number>>(new Set([20, 50]));
  const [visibleEMA, setVisibleEMA] = useState<Set<number>>(new Set([12, 26]));
  const [showRSI, setShowRSI] = useState(true);

  // Convert indicator data to chart format
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Candlestick data
    const candlesticks: CandlestickData<Time>[] = data.map((d) => ({
      time: Math.floor(d.timestamp / 1000) as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    // SMA data for each period
    const smaData: Map<number, LineData<Time>[]> = new Map();
    for (const period of availableSMA) {
      const lineData: LineData<Time>[] = [];
      for (const d of data) {
        const value = d.sma[period];
        if (value !== null && value !== undefined) {
          lineData.push({
            time: Math.floor(d.timestamp / 1000) as Time,
            value,
          });
        }
      }
      smaData.set(period, lineData);
    }

    // EMA data for each period
    const emaData: Map<number, LineData<Time>[]> = new Map();
    for (const period of availableEMA) {
      const lineData: LineData<Time>[] = [];
      for (const d of data) {
        const value = d.ema[period];
        if (value !== null && value !== undefined) {
          lineData.push({
            time: Math.floor(d.timestamp / 1000) as Time,
            value,
          });
        }
      }
      emaData.set(period, lineData);
    }

    // RSI data for the first available period
    const rsiPeriod = availableRSI[0] || 14;
    const rsiData: LineData<Time>[] = [];
    for (const d of data) {
      const value = d.rsi[rsiPeriod];
      if (value !== null && value !== undefined) {
        rsiData.push({
          time: Math.floor(d.timestamp / 1000) as Time,
          value,
        });
      }
    }

    return { candlesticks, smaData, emaData, rsiData, rsiPeriod };
  }, [data, availableSMA, availableEMA, availableRSI]);

  // Calculate price precision based on the minimum price in the dataset
  // This ensures proper display for low-value tokens (e.g., memecoins with 0.00001234 prices)
  // Using the minimum low price ensures that even if price drops significantly from the first candle,
  // the chart will still render precise values without quantization artifacts
  const pricePrecision = useMemo(() => {
    if (!data || data.length === 0) return 2;
    // Use minimum low price across all candles for proper precision
    const minPrice = Math.min(...data.map((d) => d.low));
    return calculatePricePrecision(minPrice);
  }, [data]);

  // Toggle SMA visibility
  const toggleSMA = useCallback((period: number) => {
    setVisibleSMA((prev) => {
      const next = new Set(prev);
      if (next.has(period)) {
        next.delete(period);
      } else {
        next.add(period);
      }
      return next;
    });
  }, []);

  // Toggle EMA visibility
  const toggleEMA = useCallback((period: number) => {
    setVisibleEMA((prev) => {
      const next = new Set(prev);
      if (next.has(period)) {
        next.delete(period);
      } else {
        next.add(period);
      }
      return next;
    });
  }, []);

  // Create main chart
  useEffect(() => {
    if (!chartContainerRef.current || !chartData) return;

    try {
      // Create chart instance
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#9ca3af',
        },
        grid: {
          vertLines: { color: '#1f2937' },
          horzLines: { color: '#1f2937' },
        },
        width: chartContainerRef.current.clientWidth,
        height: height,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: '#374151',
        },
        crosshair: {
          mode: 1, // Magnet mode
        },
      });

      chartRef.current = chart;

      // Add candlestick series with custom price format for low-value tokens
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        priceFormat: {
          type: 'custom',
          minMove: Math.pow(10, -pricePrecision),
          formatter: (price: number) => formatPrice(price),
        },
      });

      candlestickSeries.setData(chartData.candlesticks);
      candlestickSeriesRef.current = candlestickSeries;

      // Add SMA lines
      for (const period of availableSMA) {
        const lineData = chartData.smaData.get(period);
        if (lineData && lineData.length > 0) {
          const series = chart.addLineSeries({
            color: getIndicatorColor('sma', period),
            lineWidth: 1,
            title: `SMA ${period}`,
            visible: visibleSMA.has(period),
            priceLineVisible: false,
            lastValueVisible: false,
          });
          series.setData(lineData);
          smaSeriesRefs.current.set(period, series);
        }
      }

      // Add EMA lines
      for (const period of availableEMA) {
        const lineData = chartData.emaData.get(period);
        if (lineData && lineData.length > 0) {
          const series = chart.addLineSeries({
            color: getIndicatorColor('ema', period),
            lineWidth: 1,
            title: `EMA ${period}`,
            visible: visibleEMA.has(period),
            priceLineVisible: false,
            lastValueVisible: false,
          });
          series.setData(lineData);
          emaSeriesRefs.current.set(period, series);
        }
      }

      // Fit content to visible range
      chart.timeScale().fitContent();

      // Handle window resize
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        smaSeriesRefs.current.clear();
        emaSeriesRefs.current.clear();
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error creating main chart:', error);
    }
  }, [chartData, height, availableSMA, availableEMA, pricePrecision]);

  // Update SMA visibility when toggled
  useEffect(() => {
    for (const [period, series] of smaSeriesRefs.current) {
      series.applyOptions({ visible: visibleSMA.has(period) });
    }
  }, [visibleSMA]);

  // Update EMA visibility when toggled
  useEffect(() => {
    for (const [period, series] of emaSeriesRefs.current) {
      series.applyOptions({ visible: visibleEMA.has(period) });
    }
  }, [visibleEMA]);

  // Create RSI chart
  useEffect(() => {
    if (!rsiContainerRef.current || !chartData || !showRSI) return;

    try {
      const rsiChart = createChart(rsiContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#9ca3af',
        },
        grid: {
          vertLines: { color: '#1f2937' },
          horzLines: { color: '#1f2937' },
        },
        width: rsiContainerRef.current.clientWidth,
        height: 120,
        timeScale: {
          visible: false,
        },
        rightPriceScale: {
          borderColor: '#374151',
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        crosshair: {
          mode: 1,
        },
      });

      rsiChartRef.current = rsiChart;

      // Add RSI line series
      const rsiSeries = rsiChart.addLineSeries({
        color: INDICATOR_COLORS.rsi.line,
        lineWidth: 2,
        title: `RSI ${chartData.rsiPeriod}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      rsiSeries.setData(chartData.rsiData);
      rsiSeriesRef.current = rsiSeries;

      // Add horizontal lines for overbought/oversold levels
      rsiSeries.createPriceLine({
        price: 70,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'Overbought',
      });

      rsiSeries.createPriceLine({
        price: 30,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'Oversold',
      });

      // Add middle line at 50
      rsiSeries.createPriceLine({
        price: 50,
        color: '#6b7280',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: '',
      });

      // Sync time scales
      if (chartRef.current) {
        const mainTimeScale = chartRef.current.timeScale();
        const rsiTimeScale = rsiChart.timeScale();

        mainTimeScale.subscribeVisibleLogicalRangeChange((range) => {
          if (range) {
            rsiTimeScale.setVisibleLogicalRange(range);
          }
        });

        rsiTimeScale.subscribeVisibleLogicalRangeChange((range) => {
          if (range) {
            mainTimeScale.setVisibleLogicalRange(range);
          }
        });
      }

      // Handle resize
      const handleResize = () => {
        if (rsiContainerRef.current && rsiChartRef.current) {
          rsiChartRef.current.applyOptions({
            width: rsiContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (rsiChartRef.current) {
          rsiChartRef.current.remove();
          rsiChartRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error creating RSI chart:', error);
    }
  }, [chartData, showRSI]);

  // Generate chart title
  const chartTitle = symbol ? `${symbol} - ${timeframe}` : timeframe;

  // Count active indicators
  const activeIndicatorCount = visibleSMA.size + visibleEMA.size + (showRSI ? 1 : 0);

  return (
    <Card className="glass border-white/5">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-4">
          {/* Title Row */}
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              {chartTitle}
              {activeIndicatorCount > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {activeIndicatorCount} indicator{activeIndicatorCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </CardTitle>
          </div>

          {/* Indicator Controls */}
          {showControls && (
            <div className="flex flex-col gap-3">
              {/* SMA Toggle Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-[60px]">
                  <TrendingUp className="h-3 w-3" />
                  SMA:
                </span>
                {availableSMA.map((period) => (
                  <Button
                    key={`sma-${period}`}
                    variant={visibleSMA.has(period) ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => toggleSMA(period)}
                    className="h-7 px-2 text-xs gap-1.5"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getIndicatorColor('sma', period) }}
                    />
                    {period}
                  </Button>
                ))}
              </div>

              {/* EMA Toggle Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-[60px]">
                  <TrendingUp className="h-3 w-3" />
                  EMA:
                </span>
                {availableEMA.map((period) => (
                  <Button
                    key={`ema-${period}`}
                    variant={visibleEMA.has(period) ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => toggleEMA(period)}
                    className="h-7 px-2 text-xs gap-1.5"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getIndicatorColor('ema', period) }}
                    />
                    {period}
                  </Button>
                ))}
              </div>

              {/* RSI Toggle */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-[60px]">
                  <Activity className="h-3 w-3" />
                  RSI:
                </span>
                <Button
                  variant={showRSI ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setShowRSI(!showRSI)}
                  className="h-7 px-2 text-xs gap-1.5"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: INDICATOR_COLORS.rsi.line }}
                  />
                  {availableRSI[0] || 14}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {/* Main candlestick chart */}
        <div ref={chartContainerRef} className="w-full" />

        {/* RSI panel */}
        {showRSI && (
          <div className="border-t border-white/5 pt-2 mt-2">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Activity className="h-3 w-3" />
              RSI ({availableRSI[0] || 14})
            </div>
            <div ref={rsiContainerRef} className="w-full" />
          </div>
        )}

        {/* Indicator Legend */}
        {(visibleSMA.size > 0 || visibleEMA.size > 0) && (
          <div className="flex flex-wrap gap-3 pt-3 border-t border-white/5 mt-3">
            {Array.from(visibleSMA)
              .sort((a, b) => a - b)
              .map((period) => (
                <div key={`sma-${period}`} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-4 h-0.5 rounded"
                    style={{ backgroundColor: getIndicatorColor('sma', period) }}
                  />
                  <span className="text-muted-foreground">SMA {period}</span>
                </div>
              ))}
            {Array.from(visibleEMA)
              .sort((a, b) => a - b)
              .map((period) => (
                <div key={`ema-${period}`} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-4 h-0.5 rounded"
                    style={{ backgroundColor: getIndicatorColor('ema', period) }}
                  />
                  <span className="text-muted-foreground">EMA {period}</span>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
