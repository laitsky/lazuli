/**
 * Sparkline — tiny inline trend line
 *
 * Pure SVG. No axes, no labels. Just a colored path that shows the trend.
 * Used in market table rows, watchlist, dashboard tiles.
 *
 * Width/height default to a 100×28 box that scales to container width.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SparklineProps {
  data: Array<{ timestamp: number; value: number | null }>;
  /** Explicit numeric array (alternative to data prop) */
  values?: Array<number | null>;
  width?: number;
  height?: number;
  /** Stroke color — defaults to muted-foreground. Use up/down for direction. */
  color?: 'auto' | 'up' | 'down' | 'muted' | 'accent';
  /** Stroke width in px (default 1.5) */
  strokeWidth?: number;
  /** Fill the area under the line (subtle gradient) */
  fill?: boolean;
  className?: string;
}

const colorMap = {
  auto: 'var(--color-foreground)',
  up: 'var(--color-success)',
  down: 'var(--color-destructive)',
  muted: 'var(--color-muted-foreground)',
  accent: 'var(--color-accent)',
};

export function Sparkline({
  data,
  values,
  width = 100,
  height = 28,
  color = 'auto',
  strokeWidth = 1.5,
  fill = false,
  className,
}: SparklineProps) {
  const gradId = React.useId();

  // Normalize to {timestamp, value} array
  const points = React.useMemo(() => {
    if (values) {
      return values.map((v, i) => ({ timestamp: i, value: v }));
    }
    return data;
  }, [data, values]);

  // Determine direction from first-to-last for auto-color
  const strokeColor = React.useMemo(() => {
    if (color !== 'auto') return colorMap[color];
    const validPoints = points.filter((p) => p.value !== null) as Array<{
      timestamp: number;
      value: number;
    }>;
    if (validPoints.length < 2) return colorMap.muted;
    const first = validPoints[0].value;
    const last = validPoints[validPoints.length - 1].value;
    return last >= first ? colorMap.up : colorMap.down;
  }, [points, color]);

  // Build path
  const { path, areaPath } = React.useMemo(() => {
    const valid = points.filter((p) => p.value !== null) as Array<{
      timestamp: number;
      value: number;
    }>;
    if (valid.length < 2) return { path: '', areaPath: '' };

    const values = valid.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pad = strokeWidth;

    const xStep = (width - pad * 2) / (valid.length - 1);
    const yScale = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);

    const coords = valid.map((p, i) => ({ x: pad + i * xStep, y: yScale(p.value) }));

    const pathStr = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
      .join(' ');

    const areaStr = `${pathStr} L ${coords[coords.length - 1].x.toFixed(2)} ${height} L ${coords[0].x.toFixed(2)} ${height} Z`;

    return { path: pathStr, areaPath: areaStr };
  }, [points, width, height, strokeWidth]);

  if (!path) {
    return <div className={cn('inline-block', className)} style={{ width, height }} />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('inline-block overflow-visible', className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        </>
      )}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
