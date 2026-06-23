/**
 * MultiLineChart — pure SVG, no library
 *
 * Replaces recharts for benchmark-comparison use cases. Designed for the
 * custom-index page (and reusable elsewhere). Renders multiple named series
 * on a shared time axis with hover crosshair.
 *
 * Performance: ~1000 data points × 5 series renders comfortably. For larger
 * datasets, switch to canvas-based chart (lightweight-charts).
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface Series {
  /** Series key — must be unique within the chart */
  key: string;
  /** Display name */
  label: string;
  /** Stroke color (CSS color string) */
  color: string;
  /** Stroke width in px (default 2, highlighted series can be 3-4) */
  strokeWidth?: number;
  /** Data points — must align across all series by index */
  data: Array<{ timestamp: number; value: number | null }>;
}

export interface MultiLineChartProps {
  series: Series[];
  height?: number;
  /** Y-axis label formatter */
  formatY?: (value: number) => string;
  /** X-axis label formatter (timestamp) */
  formatX?: (timestamp: number) => string;
  /** Highlight a specific series on hover (controlled) */
  highlightedKey?: string | null;
  /** Called when user hovers a series */
  onHighlight?: (key: string | null) => void;
  className?: string;
}

const PADDING = { top: 16, right: 16, bottom: 32, left: 48 };

export function MultiLineChart({
  series,
  height = 320,
  formatY = (v) => v.toFixed(1),
  formatX = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  highlightedKey,
  onHighlight,
  className,
}: MultiLineChartProps) {
  const [internalHighlight, setInternalHighlight] = useState<string | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const highlight = highlightedKey ?? internalHighlight;
  const setHighlight = (k: string | null) => {
    setInternalHighlight(k);
    onHighlight?.(k);
  };

  // Compute domain from all series
  const { timestamps, yMin, yMax } = useMemo(() => {
    if (series.length === 0 || series[0].data.length === 0) {
      return { timestamps: [] as number[], yMin: 0, yMax: 1 };
    }
    const ts = series[0].data.map((d) => d.timestamp);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.data) {
        if (p.value === null) continue;
        if (p.value < lo) lo = p.value;
        if (p.value > hi) hi = p.value;
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) return { timestamps: ts, yMin: 0, yMax: 1 };
    // Pad domain by 5%
    const pad = (hi - lo) * 0.05 || 1;
    return { timestamps: ts, yMin: lo - pad, yMax: hi + pad };
  }, [series]);

  const width = 800; // viewBox width; SVG scales to container
  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  if (series.length === 0 || timestamps.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center text-sm text-muted-foreground',
          'bg-surface-1 border border-border rounded-md'
        )}
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const xScale = (i: number) => PADDING.left + (i / Math.max(timestamps.length - 1, 1)) * chartW;
  const yScale = (v: number) => PADDING.top + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;

  // Build path strings
  const paths = series.map((s) => {
    const pts = s.data
      .map((d, i) => (d.value === null ? null : `${xScale(i)},${yScale(d.value)}`))
      .filter(Boolean);
    return {
      ...s,
      path: pts.length ? `M ${pts.join(' L ')}` : '',
    };
  });

  // Y-axis ticks (5 lines)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = yMin + ((yMax - yMin) * i) / 4;
    return { v, y: yScale(v) };
  });

  // X-axis ticks (6 ticks)
  const xTickCount = Math.min(6, timestamps.length);
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const idx = Math.floor((i / (xTickCount - 1)) * (timestamps.length - 1));
    return { ts: timestamps[idx], x: xScale(idx) };
  });

  // Hover crosshair
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    setHoverX(x);
  };

  // Find nearest data index for hover
  let hoverIdx: number | null = null;
  if (hoverX !== null && hoverX > PADDING.left && hoverX < width - PADDING.right) {
    const ratio = (hoverX - PADDING.left) / chartW;
    hoverIdx = Math.round(ratio * (timestamps.length - 1));
    hoverIdx = Math.max(0, Math.min(timestamps.length - 1, hoverIdx));
  }

  return (
    <div className={cn('w-full select-none', className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHoverX(null);
          setHighlight(null);
        }}
        role="img"
        aria-label="Multi-line performance chart"
        className="overflow-visible"
      >
        {/* Y-axis grid + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray={i === 0 ? '' : '3 3'}
            />
            <text
              x={PADDING.left - 8}
              y={t.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="numeric"
              fontSize={10}
              fill="var(--color-muted-foreground)"
            >
              {formatY(t.v)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={height - PADDING.bottom + 18}
            textAnchor="middle"
            className="numeric"
            fontSize={10}
            fill="var(--color-muted-foreground)"
          >
            {formatX(t.ts)}
          </text>
        ))}

        {/* Zero line if domain crosses it */}
        {yMin < 0 && yMax > 0 && (
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="var(--color-muted-foreground)"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {/* Series paths */}
        {paths.map((p) => {
          const isDim = highlight !== null && highlight !== p.key;
          return (
            <path
              key={p.key}
              d={p.path}
              fill="none"
              stroke={p.color}
              strokeWidth={highlight === p.key ? (p.strokeWidth ?? 2) + 1 : (p.strokeWidth ?? 2)}
              strokeOpacity={isDim ? 0.25 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ transition: 'stroke-opacity 150ms, stroke-width 150ms' }}
            />
          );
        })}

        {/* Hover crosshair + tooltip */}
        {hoverIdx !== null && (
          <g pointerEvents="none">
            <line
              x1={xScale(hoverIdx)}
              x2={xScale(hoverIdx)}
              y1={PADDING.top}
              y2={height - PADDING.bottom}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
            {paths.map((p) => {
              const point = p.data[hoverIdx];
              if (!point || point.value === null) return null;
              return (
                <circle
                  key={p.key}
                  cx={xScale(hoverIdx)}
                  cy={yScale(point.value)}
                  r={highlight === p.key ? 4 : 3}
                  fill={p.color}
                  stroke="var(--color-surface-0)"
                  strokeWidth={2}
                />
              );
            })}
            <foreignObject
              x={Math.min(width - 160, Math.max(PADDING.left, xScale(hoverIdx) + 8))}
              y={PADDING.top}
              width={150}
              height={paths.length * 18 + 16}
              style={{ overflow: 'visible' }}
            >
              <div className="bg-surface-2 border border-border rounded-md p-2 shadow-lg text-xs">
                <div className="numeric text-[10px] text-muted-foreground mb-1">
                  {formatX(timestamps[hoverIdx])}
                </div>
                {paths.map((p) => {
                  const point = p.data[hoverIdx];
                  if (!point || point.value === null) return null;
                  return (
                    <div key={p.key} className="flex items-center gap-1.5 leading-tight">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="text-foreground flex-1">{p.label}</span>
                      <span className="numeric text-foreground">{formatY(point.value)}</span>
                    </div>
                  );
                })}
              </div>
            </foreignObject>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 px-2">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onMouseEnter={() => setHighlight(s.key)}
            onMouseLeave={() => setHighlight(null)}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-opacity',
              highlight !== null && highlight !== s.key ? 'opacity-40' : 'opacity-100'
            )}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-muted-foreground hover:text-foreground transition-colors">
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
