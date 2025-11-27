'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, Time, IChartApi } from 'lightweight-charts';
import { OHLCV, Timeframe } from '@lazuli/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Props for the CandlestickChart component
 */
interface CandlestickChartProps {
  /** OHLCV data to display */
  data: OHLCV[];
  /** Timeframe label for the chart title */
  timeframe: Timeframe;
  /** Optional chart title prefix (e.g., "BTC/USDT") */
  symbol?: string;
  /** Chart height in pixels (default: 300). Set to 'auto' for container-based height */
  height?: number | 'auto';
  /** Whether to fill the parent container height (for resizable grids) */
  fillContainer?: boolean;
}

/**
 * Candlestick chart component using TradingView Lightweight Charts v4
 * Displays OHLCV (Open, High, Low, Close, Volume) data as a candlestick chart
 *
 * Features:
 * - Responsive to container size changes (not just window resize)
 * - Uses ResizeObserver for efficient resize detection
 * - Supports both fixed height and container-fill modes
 *
 * @param props - Component props
 * @returns Rendered candlestick chart wrapped in a card
 */
export function CandlestickChart({
  data,
  timeframe,
  symbol,
  height = 300,
  fillContainer = false,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  /**
   * Resize the chart to fit its container
   * Called by ResizeObserver and window resize events
   */
  const resizeChart = useCallback(() => {
    if (!chartContainerRef.current || !chartRef.current) return;

    const container = chartContainerRef.current;
    const newWidth = container.clientWidth;

    // Calculate height based on mode
    let newHeight: number;
    if (fillContainer && cardRef.current) {
      // In fill mode, use the card's height minus the header
      const cardHeight = cardRef.current.clientHeight;
      const headerHeight = 52; // Approximate header height (pb-3 + title)
      const contentPadding = 24; // CardContent padding
      newHeight = Math.max(200, cardHeight - headerHeight - contentPadding);
    } else if (height === 'auto') {
      // Auto mode: use container width to calculate aspect ratio
      newHeight = Math.max(200, Math.min(600, newWidth * 0.6));
    } else {
      newHeight = height;
    }

    chartRef.current.applyOptions({
      width: newWidth,
      height: newHeight,
    });
  }, [height, fillContainer]);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    try {
      // Calculate initial height
      let initialHeight: number;
      if (fillContainer && cardRef.current) {
        const cardHeight = cardRef.current.clientHeight;
        initialHeight = Math.max(200, cardHeight - 76);
      } else if (height === 'auto') {
        initialHeight = Math.max(200, chartContainerRef.current.clientWidth * 0.6);
      } else {
        initialHeight = height;
      }

      // Create chart instance with v4 options
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
        height: initialHeight,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      });

      chartRef.current = chart;

      // Transform OHLCV data to lightweight-charts format
      const candlestickData = data.map((candle) => ({
        time: Math.floor(candle.timestamp / 1000) as Time, // Convert to Unix timestamp (seconds)
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      // Add candlestick series with v4 API
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      // Set data
      candlestickSeries.setData(candlestickData);

      // Fit content to visible range
      chart.timeScale().fitContent();

      // Use ResizeObserver for container-based resize detection
      // This is more efficient than window resize and works with CSS Grid resizing
      const resizeObserver = new ResizeObserver(() => {
        // Use requestAnimationFrame to debounce resize updates
        requestAnimationFrame(resizeChart);
      });

      // Observe both the chart container and the card (for height changes)
      resizeObserver.observe(chartContainerRef.current);
      if (cardRef.current) {
        resizeObserver.observe(cardRef.current);
      }

      // Also handle window resize as a fallback
      window.addEventListener('resize', resizeChart);

      // Cleanup on unmount
      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', resizeChart);
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error creating chart:', error);
    }
  }, [data, height, fillContainer, resizeChart]);

  // Generate chart title
  const chartTitle = symbol ? `${symbol} - ${timeframe}` : timeframe;

  return (
    <Card
      ref={cardRef}
      className={fillContainer ? 'h-full flex flex-col' : undefined}
    >
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base font-medium">{chartTitle}</CardTitle>
      </CardHeader>
      <CardContent className={fillContainer ? 'flex-1 min-h-0' : undefined}>
        <div ref={chartContainerRef} className="w-full h-full" />
      </CardContent>
    </Card>
  );
}
