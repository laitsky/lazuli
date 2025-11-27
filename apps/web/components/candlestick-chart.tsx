'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, Time, IChartApi, ISeriesApi, PriceScaleMode } from 'lightweight-charts';
import { OHLCV, Timeframe } from '@lazuli/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartControlsToolbar, useChartControls } from '@/components/chart-controls-toolbar';

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
  /** Whether to show the controls toolbar (default: true) */
  showToolbar?: boolean;
  /** Initial log scale setting (default: false) */
  initialLogScale?: boolean;
  /** Initial volume visibility setting (default: true) */
  initialShowVolume?: boolean;
}

/**
 * Candlestick chart component using TradingView Lightweight Charts v4
 * Displays OHLCV (Open, High, Low, Close, Volume) data as a candlestick chart
 *
 * Features:
 * - Toggle between logarithmic and linear price scale
 * - Show/hide volume histogram
 * - Screenshot current chart view
 *
 * @param props - Component props
 * @returns Rendered candlestick chart wrapped in a card
 */
export function CandlestickChart({
  data,
  timeframe,
  symbol,
  height = 300,
  showToolbar = true,
  initialLogScale = false,
  initialShowVolume = true,
}: CandlestickChartProps) {
  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Chart controls state
  const {
    isLogScale,
    setIsLogScale,
    showVolume,
    setShowVolume,
    isCapturing,
    captureScreenshot,
  } = useChartControls(initialLogScale, initialShowVolume);

  /**
   * Handle screenshot capture
   * Captures the entire card including title and chart
   */
  const handleScreenshot = useCallback(() => {
    const filename = symbol
      ? `${symbol.replace(/[/\\:*?"<>|]/g, '-')}_${timeframe}_${new Date().toISOString().split('T')[0]}.png`
      : `chart_${timeframe}_${Date.now()}.png`;
    captureScreenshot(cardRef.current, filename);
  }, [captureScreenshot, symbol, timeframe]);

  /**
   * Update price scale mode (log vs linear)
   */
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.priceScale('right').applyOptions({
        mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
    }
  }, [isLogScale]);

  /**
   * Update volume series visibility
   */
  useEffect(() => {
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.applyOptions({
        visible: showVolume,
      });
    }
  }, [showVolume]);

  /**
   * Main chart creation and update effect
   */
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
        rightPriceScale: {
          mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
          borderVisible: false,
        },
      });

      chartRef.current = chart;

      // Transform OHLCV data to lightweight-charts format for candlesticks
      const candlestickData = data.map((candle) => ({
        time: Math.floor(candle.timestamp / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      // Transform OHLCV data to volume histogram format
      const volumeData = data.map((candle) => ({
        time: Math.floor(candle.timestamp / 1000) as Time,
        value: candle.volume,
        // Color based on price direction
        color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
      }));

      // Add volume histogram series (rendered first, so it appears behind candlesticks)
      const volumeSeries = chart.addHistogramSeries({
        color: 'rgba(100, 100, 100, 0.3)',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume', // Separate price scale for volume
        visible: showVolume,
      });

      // Configure volume price scale (bottom 25% of chart)
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.8, // Volume takes bottom 20%
          bottom: 0,
        },
        borderVisible: false,
      });

      volumeSeries.setData(volumeData);
      volumeSeriesRef.current = volumeSeries;

      // Add candlestick series with v4 API
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        priceScaleId: 'right',
      });

      // Configure price scale margins to make room for volume
      chart.priceScale('right').applyOptions({
        scaleMargins: {
          top: 0.05,
          bottom: 0.25, // Leave room for volume
        },
      });

      candlestickSeries.setData(candlestickData);
      candlestickSeriesRef.current = candlestickSeries;

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
          candlestickSeriesRef.current = null;
          volumeSeriesRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error creating chart:', error);
    }
  }, [data, height]); // Note: isLogScale and showVolume are handled by their own effects

  // Generate chart title
  const chartTitle = symbol ? `${symbol} - ${timeframe}` : timeframe;

  return (
    <Card ref={cardRef}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">{chartTitle}</CardTitle>
      </CardHeader>
      <CardContent className="relative">
        {/* Chart Controls Toolbar */}
        {showToolbar && (
          <ChartControlsToolbar
            isLogScale={isLogScale}
            onLogScaleChange={setIsLogScale}
            showVolume={showVolume}
            onVolumeChange={setShowVolume}
            onScreenshot={handleScreenshot}
            isCapturing={isCapturing}
          />
        )}
        {/* Chart Container */}
        <div ref={chartContainerRef} className="w-full" />
      </CardContent>
    </Card>
  );
}
