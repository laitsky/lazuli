'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
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
  /** Chart height in pixels (default: 300) */
  height?: number;
}

/**
 * Candlestick chart component using TradingView Lightweight Charts v4
 * Displays OHLCV (Open, High, Low, Close, Volume) data as a candlestick chart
 *
 * @param props - Component props
 * @returns Rendered candlestick chart wrapped in a card
 */
export function CandlestickChart({ data, timeframe, symbol, height = 300 }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    try {
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
        height: height,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      });

      chartRef.current = chart;

      // Transform OHLCV data to lightweight-charts format
      const candlestickData = data.map((candle) => ({
        time: Math.floor(candle.timestamp / 1000), // Convert to Unix timestamp (seconds)
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

      // Handle window resize
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      // Cleanup on unmount
      return () => {
        window.removeEventListener('resize', handleResize);
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error creating chart:', error);
    }
  }, [data, height]);

  // Generate chart title
  const chartTitle = symbol ? `${symbol} - ${timeframe}` : timeframe;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">{chartTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={chartContainerRef} className="w-full" />
      </CardContent>
    </Card>
  );
}
