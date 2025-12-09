/**
 * AltcoinMiniChart - Custom SVG Sparkline chart for Alt Screener
 *
 * This component renders a compact sparkline chart showing recent price action
 * for each altcoin in the screener grid. Features:
 * - Pure SVG implementation (no external charting library)
 * - No watermarks or branding
 * - Lazy loading with Intersection Observer (only renders when visible)
 * - Interactive hover tracking with tooltip
 * - Dual price display (USD + base currency) when not in USD mode
 * - Lightweight and fast rendering
 * - Color-coded based on performance (green for gains, red for losses)
 * - Smooth area fill with gradient
 * - Responsive sizing
 */

import { useMemo, memo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { OHLCV, BaseCurrency } from '@lazuli/shared';

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
  /** Enable lazy loading (default: true) */
  lazy?: boolean;
  /** Current base currency for display */
  baseCurrency?: BaseCurrency;
  /** Base currency price in USD (for conversion display) */
  basePrice?: number;
  /** Symbol name for tooltip display */
  symbol?: string;
  /** Enable interactive hover tracking (default: false for performance) */
  interactive?: boolean;
}

/**
 * Format price with appropriate decimal places
 */
function formatPrice(price: number, baseCurrency: BaseCurrency = 'USD'): string {
  if (baseCurrency === 'USD') {
    if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.01) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
  }
  // For crypto base currencies, show more precision
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toFixed(8);
}

/**
 * Format date/time for tooltip
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generate SVG path data for a sparkline
 * Creates a smooth line path from the data points
 */
function generateSparklinePath(
  data: { x: number; y: number }[],
  width: number,
  height: number,
  padding: number = 2
): { linePath: string; areaPath: string } {
  if (data.length === 0) return { linePath: '', areaPath: '' };

  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Find min and max values for scaling
  const values = data.map((d) => d.y);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1; // Prevent division by zero

  // Scale data points to chart dimensions
  const scaledPoints = data.map((point, index) => ({
    x: padding + (index / (data.length - 1)) * chartWidth,
    y: padding + chartHeight - ((point.y - minValue) / valueRange) * chartHeight,
  }));

  // Generate line path using quadratic curves for smoothness
  let linePath = `M ${scaledPoints[0].x},${scaledPoints[0].y}`;

  for (let i = 1; i < scaledPoints.length; i++) {
    const prev = scaledPoints[i - 1];
    const curr = scaledPoints[i];

    // Use quadratic bezier for smooth curves
    const midX = (prev.x + curr.x) / 2;
    linePath += ` Q ${prev.x},${prev.y} ${midX},${(prev.y + curr.y) / 2}`;
  }

  // Add the last point
  const last = scaledPoints[scaledPoints.length - 1];
  linePath += ` L ${last.x},${last.y}`;

  // Create area path by closing the shape to the bottom
  const areaPath =
    linePath +
    ` L ${last.x},${height - padding}` +
    ` L ${scaledPoints[0].x},${height - padding}` +
    ' Z';

  return { linePath, areaPath };
}

/**
 * Skeleton placeholder for chart while loading
 */
function ChartSkeleton({ height, isPositive }: { height: number; isPositive: boolean }) {
  const baseColor = isPositive ? 'bg-green-500/10' : 'bg-red-500/10';

  return (
    <div className={`w-full rounded ${baseColor} animate-pulse`} style={{ height }}>
      {/* Simple animated line to indicate loading */}
      <div className="h-full flex items-center justify-center">
        <div
          className={`h-[2px] w-3/4 rounded ${isPositive ? 'bg-green-500/30' : 'bg-red-500/30'}`}
        />
      </div>
    </div>
  );
}

/**
 * Hover state for interactive chart
 * Includes screen coordinates for portal-based tooltip positioning
 */
interface HoverState {
  x: number; // Mouse X position (0-1 normalized)
  dataIndex: number; // Index into OHLCV data
  price: number; // Price at this point (USD)
  timestamp: number; // Timestamp at this point
  screenX: number; // Absolute screen X for tooltip portal
  screenY: number; // Absolute screen Y for tooltip portal
}

/**
 * Custom SVG Sparkline component with lazy loading and hover tracking
 * Renders a smooth area chart without any external dependencies
 * Uses Intersection Observer to only render when visible in viewport
 */
function AltcoinMiniChartComponent({
  data,
  change,
  height = 40,
  width = 'full',
  lazy = true,
  baseCurrency = 'USD',
  basePrice = 1,
  symbol: _symbol,
  interactive = false,
}: AltcoinMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [isVisible, setIsVisible] = useState(!lazy);
  const [hasBeenVisible, setHasBeenVisible] = useState(!lazy);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  // Determine chart colors based on performance
  const isPositive = change !== null && change >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';

  // Use a stable gradient ID based on a counter instead of random
  const gradientId = useRef(`gradient-${Math.random().toString(36).substring(7)}`).current;

  // Set up Intersection Observer for lazy loading
  useEffect(() => {
    if (!lazy || hasBeenVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            setHasBeenVisible(true);
            // Once visible, we don't need to observe anymore
            observer.disconnect();
          }
        });
      },
      {
        // Start loading slightly before the element comes into view
        rootMargin: '100px',
        threshold: 0,
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [lazy, hasBeenVisible]);

  // Process OHLCV data into chart points (only when visible)
  // Also keep the sorted OHLCV data for hover info
  const { chartData, sortedOhlcv } = useMemo(() => {
    if (!isVisible || !data || data.length === 0) {
      return { chartData: [], sortedOhlcv: [] };
    }

    // Sort by timestamp and extract close prices
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const points = sorted.map((candle, index) => ({
      x: index,
      y: candle.close,
    }));
    return { chartData: points, sortedOhlcv: sorted };
  }, [data, isVisible]);

  // Generate SVG paths (only when visible)
  const paths = useMemo(() => {
    if (!isVisible || chartData.length === 0) {
      return { linePath: '', areaPath: '' };
    }
    // Use a fixed width for calculations, CSS will handle responsiveness
    const chartWidth = typeof width === 'number' ? width : 200;
    return generateSparklinePath(chartData, chartWidth, height);
  }, [chartData, width, height, isVisible]);

  // Handle mouse move for hover tracking
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!interactive || sortedOhlcv.length === 0 || !svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const clampedX = Math.max(0, Math.min(1, x));

      // Map X position to data index
      const dataIndex = Math.round(clampedX * (sortedOhlcv.length - 1));
      const candle = sortedOhlcv[dataIndex];

      if (candle) {
        // Calculate screen coordinates for portal tooltip
        const screenX = rect.left + clampedX * rect.width;
        const screenY = rect.top;

        setHover({
          x: clampedX,
          dataIndex,
          price: candle.close,
          timestamp: candle.timestamp,
          screenX,
          screenY,
        });
      }
    },
    [interactive, sortedOhlcv]
  );

  const handleMouseEnter = useCallback(() => {
    if (interactive) setIsHovering(true);
  }, [interactive]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setHover(null);
  }, []);

  // Show placeholder if no data
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center bg-muted/30 rounded" style={{ height }}>
        <span className="text-xs text-muted-foreground">No data</span>
      </div>
    );
  }

  // Calculate viewBox based on width
  const viewBoxWidth = typeof width === 'number' ? width : 200;
  const padding = 2;

  // Calculate hover point position in SVG coordinates
  const hoverPoint = useMemo(() => {
    if (!hover || chartData.length === 0) return null;

    const chartWidth = viewBoxWidth - padding * 2;
    const chartHeight = height - padding * 2;

    const values = chartData.map((d) => d.y);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;

    const x = padding + hover.x * chartWidth;
    const y = padding + chartHeight - ((hover.price - minValue) / valueRange) * chartHeight;

    return { x, y };
  }, [hover, chartData, viewBoxWidth, height]);

  return (
    <div ref={containerRef} style={{ height }} className="w-full relative">
      {!isVisible ? (
        <ChartSkeleton height={height} isPositive={isPositive} />
      ) : (
        <>
          <svg
            ref={svgRef}
            className={`w-full animate-in fade-in duration-300 ${interactive ? 'cursor-crosshair' : ''}`}
            style={{ height }}
            viewBox={`0 0 ${viewBoxWidth} ${height}`}
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Gradient definition for area fill */}
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={lineColor} stopOpacity={isPositive ? 0.3 : 0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Area fill */}
            <path d={paths.areaPath} fill={`url(#${gradientId})`} />

            {/* Line stroke */}
            <path
              d={paths.linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Hover indicator */}
            {interactive && isHovering && hover && hoverPoint && (
              <>
                {/* Vertical line */}
                <line
                  x1={hoverPoint.x}
                  y1={padding}
                  x2={hoverPoint.x}
                  y2={height - padding}
                  stroke={lineColor}
                  strokeWidth={1}
                  strokeDasharray="2,2"
                  opacity={0.5}
                />
                {/* Point indicator */}
                <circle
                  cx={hoverPoint.x}
                  cy={hoverPoint.y}
                  r={3}
                  fill={lineColor}
                  stroke="white"
                  strokeWidth={1.5}
                />
              </>
            )}
          </svg>

          {/* Tooltip - rendered via portal to escape overflow:hidden containers */}
          {interactive &&
            isHovering &&
            hover &&
            typeof document !== 'undefined' &&
            createPortal(
              <div
                className="fixed z-[9999] pointer-events-none bg-popover/95 backdrop-blur-sm border border-border rounded-lg shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
                style={{
                  left: hover.screenX,
                  top: hover.screenY - 8,
                  transform: `translate(${hover.x > 0.7 ? '-100%' : hover.x < 0.3 ? '0%' : '-50%'}, -100%)`,
                }}
              >
                {/* Time */}
                <div className="text-muted-foreground text-[10px] mb-0.5">
                  {formatTime(hover.timestamp)}
                </div>

                {/* Price in base currency */}
                <div className="font-mono font-medium text-foreground">
                  {baseCurrency !== 'USD' ? (
                    <>
                      {formatPrice(hover.price / basePrice, baseCurrency)} {baseCurrency}
                    </>
                  ) : (
                    formatPrice(hover.price, 'USD')
                  )}
                </div>

                {/* USD equivalent when not in USD mode */}
                {baseCurrency !== 'USD' && (
                  <div className="text-muted-foreground text-[10px]">
                    ≈ {formatPrice(hover.price, 'USD')}
                  </div>
                )}

                {/* Change from first candle */}
                {sortedOhlcv.length > 0 && (
                  <div
                    className={`text-[10px] ${hover.price >= sortedOhlcv[0].close ? 'text-green-500' : 'text-red-500'}`}
                  >
                    {hover.price >= sortedOhlcv[0].close ? '↑' : '↓'}{' '}
                    {(((hover.price - sortedOhlcv[0].close) / sortedOhlcv[0].close) * 100).toFixed(
                      2
                    )}
                    %
                  </div>
                )}
              </div>,
              document.body
            )}
        </>
      )}
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const AltcoinMiniChart = memo(AltcoinMiniChartComponent);
