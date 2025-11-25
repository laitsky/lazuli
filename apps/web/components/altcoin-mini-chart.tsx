'use client';

/**
 * AltcoinMiniChart - Custom SVG Sparkline chart for Alt Screener
 *
 * This component renders a compact sparkline chart showing recent price action
 * for each altcoin in the screener grid. Features:
 * - Pure SVG implementation (no external charting library)
 * - No watermarks or branding
 * - Lightweight and fast rendering
 * - Color-coded based on performance (green for gains, red for losses)
 * - Smooth area fill with gradient
 * - Responsive sizing
 */

import { useMemo, memo } from 'react';
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
 * Custom SVG Sparkline component
 * Renders a smooth area chart without any external dependencies
 */
function AltcoinMiniChartComponent({
  data,
  change,
  height = 40,
  width = 'full',
}: AltcoinMiniChartProps) {
  // Determine chart colors based on performance
  const isPositive = change !== null && change >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';
  const gradientId = useMemo(() => `gradient-${Math.random().toString(36).substring(7)}`, []);

  // Process OHLCV data into chart points
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Sort by timestamp and extract close prices
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.map((candle, index) => ({
      x: index,
      y: candle.close,
    }));
  }, [data]);

  // Generate SVG paths
  const paths = useMemo(() => {
    // Use a fixed width for calculations, CSS will handle responsiveness
    const chartWidth = typeof width === 'number' ? width : 200;
    return generateSparklinePath(chartData, chartWidth, height);
  }, [chartData, width, height]);

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
    <svg
      className="w-full"
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
  );
}

// Memoize to prevent unnecessary re-renders
export const AltcoinMiniChart = memo(AltcoinMiniChartComponent);
