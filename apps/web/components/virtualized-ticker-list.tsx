'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { Ticker } from '@lazuli/shared';

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

  // Configure virtualizer
  const virtualizer = useVirtualizer({
    count: tickers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44, // Height of each item in pixels (py-2 + padding)
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
        <p className="text-sm text-muted-foreground text-center py-4">
          Loading tickers...
        </p>
      ) : tickers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No tickers found
        </p>
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
                className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-accent transition-colors ${
                  isSelected ? 'bg-accent font-medium' : ''
                }`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
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
