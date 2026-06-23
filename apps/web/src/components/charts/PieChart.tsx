/**
 * PieChart — pure SVG donut chart
 *
 * Replaces recharts PieChart for allocation previews. Supports hover highlight
 * and click-to-emphasize a slice.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

export interface PieChartProps {
  slices: PieSlice[];
  /** Outer radius (default 64). Inner radius is 60% of outer. */
  size?: number;
  /** Format value for tooltip (e.g. percentage) */
  formatValue?: (value: number, total: number) => string;
  className?: string;
}

export function PieChart({
  slices,
  size = 64,
  formatValue = (v, total) => `${((v / total) * 100).toFixed(1)}%`,
  className,
}: PieChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-xs text-muted-foreground', className)}
        style={{ width: size * 2, height: size * 2 }}
      >
        No allocation
      </div>
    );
  }

  const innerR = size * 0.6;
  const outerR = size;
  let cumAngle = -Math.PI / 2; // start at top

  // Build slice path data
  const arcs = slices.map((slice, i) => {
    const angle = (slice.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;

    // Donut slice path
    const x1 = outerR + outerR * Math.cos(startAngle);
    const y1 = outerR + outerR * Math.sin(startAngle);
    const x2 = outerR + outerR * Math.cos(endAngle);
    const y2 = outerR + outerR * Math.sin(endAngle);
    const xi1 = outerR + innerR * Math.cos(endAngle);
    const yi1 = outerR + innerR * Math.sin(endAngle);
    const xi2 = outerR + innerR * Math.cos(startAngle);
    const yi2 = outerR + innerR * Math.sin(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const d = [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi2} ${yi2}`,
      'Z',
    ].join(' ');

    // Mid-angle for label
    const midAngle = (startAngle + endAngle) / 2;
    const labelR = (innerR + outerR) / 2;

    return {
      ...slice,
      idx: i,
      d,
      labelX: outerR + labelR * Math.cos(midAngle),
      labelY: outerR + labelR * Math.sin(midAngle),
      midAngle,
    };
  });

  const hovered = hoverIdx !== null ? arcs[hoverIdx] : null;

  return (
    <div className={cn('relative inline-block', className)}>
      <svg
        width={size * 2}
        height={size * 2}
        viewBox={`0 0 ${size * 2} ${size * 2}`}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label="Allocation pie chart"
      >
        {arcs.map((arc) => {
          const isDim = hoverIdx !== null && hoverIdx !== arc.idx;
          return (
            <path
              key={arc.idx}
              d={arc.d}
              fill={arc.color}
              stroke="var(--color-surface-1)"
              strokeWidth={2}
              opacity={isDim ? 0.4 : 1}
              style={{ transition: 'opacity 120ms', cursor: 'pointer' }}
              onMouseEnter={() => setHoverIdx(arc.idx)}
            />
          );
        })}

        {/* Center label */}
        {hovered && (
          <text
            x={outerR}
            y={outerR - 4}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size * 0.18}
            fontWeight={600}
            fill="var(--color-foreground)"
          >
            {hovered.label}
          </text>
        )}
        {hovered && (
          <text
            x={outerR}
            y={outerR + size * 0.16}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size * 0.13}
            fill="var(--color-muted-foreground)"
            className="numeric"
          >
            {formatValue(hovered.value, total)}
          </text>
        )}
      </svg>
    </div>
  );
}
