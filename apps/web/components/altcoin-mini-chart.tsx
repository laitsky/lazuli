'use client';

/**
 * AltcoinMiniChart - Custom SVG Sparkline chart for Alt Screener
 *
 * This component renders a compact sparkline chart showing recent price action
 * for each altcoin in the screener grid. Features:
 * - Pure SVG implementation (no external charting library)
 * - No watermarks or branding
 * - Lazy loading with Intersection Observer (only renders when visible)
 * - Lightweight and fast rendering
 * - Color-coded based on performance (green for gains, red for losses)
 * - Smooth area fill with gradient
 * - Responsive sizing
 */

import { useMemo, memo, useState, useEffect, useRef } from 'react';
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
  /** Enable lazy loading (default: true) */
  lazy?: boolean;
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
 * Custom SVG Sparkline component with lazy loading
 * Renders a smooth area chart without any external dependencies
 * Uses Intersection Observer to only render when visible in viewport
 */
function AltcoinMiniChartComponent({
  data,
  change,
  height = 40,
  width = 'full',
  lazy = true,
}: AltcoinMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(!lazy);
  const [hasBeenVisible, setHasBeenVisible] = useState(!lazy);

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
  const chartData = useMemo(() => {
    if (!isVisible || !data || data.length === 0) return [];

    // Sort by timestamp and extract close prices
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.map((candle, index) => ({
      x: index,
      y: candle.close,
    }));
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

  return (
    <div ref={containerRef} style={{ height }} className="w-full">
      {!isVisible ? (
        <ChartSkeleton height={height} isPositive={isPositive} />
      ) : (
        <svg
          className="w-full animate-in fade-in duration-300"
          style={{ height }}
          viewBox={`0 0 ${viewBoxWidth} ${height}`}
          preserveAspectRatio="none"
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
        </svg>
      )}
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const AltcoinMiniChart = memo(AltcoinMiniChartComponent);
