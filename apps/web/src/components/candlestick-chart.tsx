import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  ColorType,
  Time,
  IChartApi,
  ISeriesApi,
  PriceScaleMode,
} from 'lightweight-charts';
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
  /** Chart height in pixels (default: 300). Set to 'auto' for container-based height */
  height?: number | 'auto';
  /** Whether to fill the parent container height (for resizable grids) */
  fillContainer?: boolean;
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
  const { isLogScale, setIsLogScale, showVolume, setShowVolume, isCapturing, captureScreenshot } =
    useChartControls(initialLogScale, initialShowVolume);

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
    // Track observers/listeners for cleanup
    let resizeObserver: ResizeObserver | null = null;

    // Early return if no container or data, but still return cleanup
    if (!chartContainerRef.current || data.length === 0) {
      return () => {
        // Cleanup any existing chart when data becomes empty
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
          candlestickSeriesRef.current = null;
          volumeSeriesRef.current = null;
        }
      };
    }

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

      // Use ResizeObserver for container-based resize detection
      // This is more efficient than window resize and works with CSS Grid resizing
      resizeObserver = new ResizeObserver(() => {
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
    } catch (error) {
      console.error('Error creating chart:', error);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', resizeChart);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candlestickSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }
    };
  }, [data, height, fillContainer, resizeChart, isLogScale, showVolume]);

  // Generate chart title
  const chartTitle = symbol ? `${symbol} - ${timeframe}` : timeframe;

  return (
    <Card ref={cardRef} className={fillContainer ? 'h-full flex flex-col' : undefined}>
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base font-medium">{chartTitle}</CardTitle>
      </CardHeader>
      <CardContent className={`relative ${fillContainer ? 'flex-1 min-h-0' : ''}`}>
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
        <div ref={chartContainerRef} className="w-full h-full" />
      </CardContent>
    </Card>
  );
}
