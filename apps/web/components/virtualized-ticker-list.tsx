'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { Ticker } from '@lazuli/shared';

/**
 * Row height constant - must match the actual rendered row height
 * This is used both by the virtualizer and skeleton to prevent layout shifts
 * Height breakdown: py-2 (8px top + 8px bottom) + text line-height (~20px) + borders = 44px
 */
const ROW_HEIGHT = 44;

/**
 * Number of skeleton rows to show during loading
 * Should roughly fill the visible area (max-h-48 = 192px / 44px ≈ 4 rows)
 */
const SKELETON_COUNT = 4;

/**
 * Props for VirtualizedTickerList component
 */
interface VirtualizedTickerListProps {
  /** List of tickers to display */
  tickers: Ticker[];
  /** Currently selected ticker symbol */
  selectedSymbol: string;
  /** Callback when a ticker is selected */
  onSelect: (symbol: string) => void;
  /** Loading state */
  loading: boolean;
  /** Accessible label for the selection (e.g., "numerator" or "denominator") */
  ariaLabel?: string;
}

/**
 * Virtualized ticker list component for efficient rendering of large lists
 * Only renders visible items in the viewport, dramatically improving performance
 * for lists with thousands of tickers
 *
 * Uses @tanstack/react-virtual for virtualization
 */
export function VirtualizedTickerList({
  tickers,
  selectedSymbol,
  onSelect,
  loading,
  ariaLabel = 'ticker',
}: VirtualizedTickerListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Configure virtualizer with consistent row height
  const virtualizer = useVirtualizer({
    count: tickers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT, // Uses shared constant to ensure consistency
    overscan: 5, // Number of items to render outside viewport for smooth scrolling
  });

  return (
    <div
      ref={parentRef}
      className="max-h-48 overflow-y-auto border rounded-md p-2"
      role="listbox"
      aria-label={`${ariaLabel} ticker list`}
    >
      {loading ? (
        // Skeleton rows with exact same height as rendered rows to prevent layout shift
        <div
          role="status"
          aria-label="Loading tickers"
          style={{ height: `${ROW_HEIGHT * SKELETON_COUNT}px` }}
        >
          {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
            <div
              key={index}
              className="px-3 py-2 rounded"
              style={{ height: `${ROW_HEIGHT}px`, boxSizing: 'border-box' }}
            >
              {/* Animated skeleton bar matching text position and approximate width */}
              <div className="h-5 w-24 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : tickers.length === 0 ? (
        // Empty state with height matching skeleton to maintain consistent container size
        <div
          className="flex items-center justify-center"
          style={{ height: `${ROW_HEIGHT * SKELETON_COUNT}px` }}
        >
          <p className="text-sm text-muted-foreground text-center">No tickers found</p>
        </div>
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const ticker = tickers[virtualItem.index];
            const isSelected = selectedSymbol === ticker.symbol;

            return (
              <button
                key={ticker.symbol}
                onClick={() => onSelect(ticker.symbol)}
                className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-accent transition-colors cursor-pointer ${
                  isSelected ? 'bg-accent font-medium' : ''
                }`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${ROW_HEIGHT}px`, // Fixed height prevents layout variations
                  boxSizing: 'border-box',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                role="option"
                aria-selected={isSelected}
                aria-label={`Select ${ticker.symbol} as ${ariaLabel}`}
              >
                {ticker.symbol}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
