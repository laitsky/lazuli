'use client';

/**
 * AltcoinMiniChart - Sparkline chart component for Alt Screener
 *
 * This component renders a compact line chart showing recent price action
 * for each altcoin in the screener grid. Features:
 * - Lightweight area chart using TradingView Lightweight Charts
 * - Color-coded based on performance (green for gains, red for losses)
 * - Responsive sizing
 * - Minimal design for grid layout
 */

import { useEffect, useRef, memo } from 'react';
import { createChart, ColorType, LineStyle, Time } from 'lightweight-charts';
import { OHLCV } from '@lazuli/shared';

/**
 * Props for the AltcoinMiniChart component
 */
interface AltcoinMiniChartProps {
  /** OHLCV data to display */
  data: OHLCV[];
  /** Performance change percentage (determines color) */
  change: number | null;
  /** Chart height in pixels (default: 40) */
  height?: number;
  /** Chart width - 'full' for 100% or specific pixel value */
  width?: 'full' | number;
}

/**
 * MiniChart component using TradingView Lightweight Charts
 * Displays a compact sparkline area chart for quick visual analysis
 */
function AltcoinMiniChartComponent({
  data,
  change,
  height = 40,
  width = 'full',
}: AltcoinMiniChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  // Determine chart color based on performance
  const isPositive = change !== null && change >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';
  const areaTopColor = isPositive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';
  const areaBottomColor = isPositive ? 'rgba(34, 197, 94, 0.0)' : 'rgba(239, 68, 68, 0.0)';

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    try {
      // Calculate width
      const containerWidth = width === 'full' ? chartContainerRef.current.clientWidth : width;

      // Create chart instance with minimal options
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'transparent',
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        width: containerWidth,
        height: height,
        rightPriceScale: {
          visible: false,
        },
        leftPriceScale: {
          visible: false,
        },
        timeScale: {
          visible: false,
          borderVisible: false,
        },
        handleScale: false,
        handleScroll: false,
        crosshair: {
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
      });

      chartRef.current = chart;

      // Transform OHLCV data to line chart format (using close prices)
      const lineData = data
        .map((candle) => ({
          time: Math.floor(candle.timestamp / 1000) as Time,
          value: candle.close,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));

      // Add area series for the sparkline
      const areaSeries = chart.addAreaSeries({
        lineColor: lineColor,
        topColor: areaTopColor,
        bottomColor: areaBottomColor,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      areaSeries.setData(lineData);

      // Fit content
      chart.timeScale().fitContent();

      // Handle resize
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          const newWidth = width === 'full' ? chartContainerRef.current.clientWidth : width;
          chartRef.current.applyOptions({ width: newWidth });
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
    } catch (error) {
      console.error('Error creating mini chart:', error);
    }
  }, [data, height, width, lineColor, areaTopColor, areaBottomColor]);

  // Show placeholder if no data
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-muted/30 rounded"
        style={{ height: height }}
      >
        <span className="text-xs text-muted-foreground">No data</span>
      </div>
    );
  }

  return <div ref={chartContainerRef} className="w-full" style={{ height: height }} />;
}

// Memoize to prevent unnecessary re-renders
export const AltcoinMiniChart = memo(AltcoinMiniChartComponent);
