'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Layout item configuration for a single grid cell
 */
export interface GridLayoutItem {
  /** Unique identifier for the grid item */
  id: string;
  /** Column span (1-4) */
  colSpan: number;
  /** Row span (1-3) */
  rowSpan: number;
  /** Height in pixels (overrides rowSpan when set) */
  height?: number;
}

/**
 * Props for individual ResizableGridItem component
 */
interface ResizableGridItemProps {
  /** Unique identifier */
  id: string;
  /** Current layout configuration */
  layout: GridLayoutItem;
  /** Callback when layout changes */
  onLayoutChange: (id: string, changes: Partial<GridLayoutItem>) => void;
  /** Child content to render */
  children: ReactNode;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Maximum height in pixels */
  maxHeight?: number;
  /** Whether resizing is enabled */
  resizable?: boolean;
}

/**
 * A single resizable grid item with a drag handle for vertical resizing
 *
 * Features:
 * - Vertical resize handle at the bottom
 * - Smooth resize animation
 * - Minimum and maximum height constraints
 * - Keyboard accessibility for resize handle
 */
function ResizableGridItem({
  id,
  layout,
  onLayoutChange,
  children,
  minHeight = 250,
  maxHeight = 800,
  resizable = true,
}: ResizableGridItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [currentHeight, setCurrentHeight] = useState(layout.height || 350);
  const startY = useRef(0);
  const startHeight = useRef(0);
  // Use ref to track current height for the end handler (avoids stale closure)
  const currentHeightRef = useRef(currentHeight);

  // Keep the ref in sync with state
  useEffect(() => {
    currentHeightRef.current = currentHeight;
  }, [currentHeight]);

  /**
   * Handle mouse down on resize handle
   * Initiates the resize operation
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startY.current = e.clientY;
    startHeight.current = currentHeight;
  }, [currentHeight]);

  /**
   * Handle touch start on resize handle (mobile support)
   */
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startY.current = e.touches[0].clientY;
    startHeight.current = currentHeight;
  }, [currentHeight]);

  /**
   * Handle mouse/touch move during resize
   * Updates height based on drag distance
   */
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startY.current;
      const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight.current + deltaY));
      setCurrentHeight(newHeight);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const deltaY = e.touches[0].clientY - startY.current;
      const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight.current + deltaY));
      setCurrentHeight(newHeight);
    };

    const handleEnd = () => {
      setIsResizing(false);
      // Use ref to get the latest height value (avoids stale closure)
      onLayoutChange(id, { height: currentHeightRef.current });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isResizing, id, onLayoutChange, minHeight, maxHeight]);

  // Sync with external height changes (e.g., reset button)
  useEffect(() => {
    if (layout.height && layout.height !== currentHeightRef.current && !isResizing) {
      setCurrentHeight(layout.height);
    }
  }, [layout.height, isResizing]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative group/resize',
        isResizing && 'select-none'
      )}
      style={{
        height: currentHeight,
        gridColumn: `span ${layout.colSpan}`,
      }}
    >
      {/* Main content area */}
      <div className="h-full w-full overflow-hidden">
        {children}
      </div>

      {/* Resize handle - bottom edge */}
      {resizable && (
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize z-20',
            'flex items-center justify-center',
            'opacity-0 group-hover/resize:opacity-100 transition-opacity duration-200',
            isResizing && 'opacity-100'
          )}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${id} chart`}
          tabIndex={0}
          onKeyDown={(e) => {
            // Arrow key support for accessibility
            if (e.key === 'ArrowUp') {
              const newHeight = Math.max(minHeight, currentHeight - 20);
              setCurrentHeight(newHeight);
              onLayoutChange(id, { height: newHeight });
            } else if (e.key === 'ArrowDown') {
              const newHeight = Math.min(maxHeight, currentHeight + 20);
              setCurrentHeight(newHeight);
              onLayoutChange(id, { height: newHeight });
            }
          }}
        >
          {/* Visual indicator for the resize handle */}
          <div className={cn(
            'w-16 h-1.5 rounded-full bg-white/20 hover:bg-primary/50 transition-colors',
            isResizing && 'bg-primary'
          )} />
        </div>
      )}

      {/* Resize overlay to prevent iframe/chart interaction during resize */}
      {isResizing && (
        <div className="absolute inset-0 z-10 cursor-ns-resize" />
      )}
    </div>
  );
}

/**
 * Props for the ResizableGrid container component
 */
interface ResizableGridProps {
  /** Array of layout configurations for each grid item */
  layouts: GridLayoutItem[];
  /** Callback when any layout changes */
  onLayoutsChange: (layouts: GridLayoutItem[]) => void;
  /** Render function for each grid item */
  children: (item: GridLayoutItem, index: number) => ReactNode;
  /** Number of columns in the grid (default: 2) */
  columns?: number;
  /** Gap between grid items in pixels (default: 24) */
  gap?: number;
  /** Minimum height for grid items */
  minHeight?: number;
  /** Maximum height for grid items */
  maxHeight?: number;
  /** Whether resizing is enabled */
  resizable?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * A responsive grid container with resizable items
 *
 * Features:
 * - CSS Grid-based layout for responsive behavior
 * - Individual item height customization
 * - Column span support (items can span multiple columns)
 * - Persists layout changes via callback
 * - Mobile-friendly with touch support
 *
 * @example
 * ```tsx
 * <ResizableGrid
 *   layouts={[
 *     { id: '1h', colSpan: 2, rowSpan: 1, height: 500 },
 *     { id: '15m', colSpan: 1, rowSpan: 1, height: 350 },
 *   ]}
 *   onLayoutsChange={setLayouts}
 * >
 *   {(item) => <Chart timeframe={item.id} />}
 * </ResizableGrid>
 * ```
 */
export function ResizableGrid({
  layouts,
  onLayoutsChange,
  children,
  columns = 2,
  gap = 24,
  minHeight = 250,
  maxHeight = 800,
  resizable = true,
  className,
}: ResizableGridProps) {
  /**
   * Handle layout change for a single item
   * Updates the layouts array and calls the callback
   */
  const handleLayoutChange = useCallback((id: string, changes: Partial<GridLayoutItem>) => {
    const newLayouts = layouts.map((layout) =>
      layout.id === id ? { ...layout, ...changes } : layout
    );
    onLayoutsChange(newLayouts);
  }, [layouts, onLayoutsChange]);

  return (
    <div
      className={cn('grid', className)}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: `${gap}px`,
      }}
    >
      {layouts.map((layout, index) => (
        <ResizableGridItem
          key={layout.id}
          id={layout.id}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          minHeight={minHeight}
          maxHeight={maxHeight}
          resizable={resizable}
        >
          {children(layout, index)}
        </ResizableGridItem>
      ))}
    </div>
  );
}

/**
 * Hook for managing resizable grid layouts with localStorage persistence
 *
 * @param storageKey - Key for localStorage persistence
 * @param defaultLayouts - Default layouts to use if none are stored
 * @returns [layouts, setLayouts, resetLayouts] - State and control functions
 *
 * @example
 * ```tsx
 * const [layouts, setLayouts, resetLayouts] = useGridLayouts(
 *   'multitf-layouts',
 *   defaultChartLayouts
 * );
 * ```
 */
export function useGridLayouts(
  storageKey: string,
  defaultLayouts: GridLayoutItem[]
): [GridLayoutItem[], (layouts: GridLayoutItem[]) => void, () => void] {
  const [layouts, setLayoutsState] = useState<GridLayoutItem[]>(defaultLayouts);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load layouts from localStorage on mount (client-side only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as GridLayoutItem[];

        // Merge stored layouts with defaults:
        // - Use stored values for items that exist in both
        // - Use default values for new items not in storage
        const mergedLayouts = defaultLayouts.map((defaultLayout) => {
          const storedLayout = parsed.find((l) => l.id === defaultLayout.id);
          return storedLayout || defaultLayout;
        });

        setLayoutsState(mergedLayouts);
      }
    } catch (error) {
      console.warn('Failed to load grid layouts from localStorage:', error);
    }
    setIsHydrated(true);
  }, [storageKey, defaultLayouts]);

  // Save layouts to localStorage whenever they change (after hydration)
  const setLayouts = useCallback((newLayouts: GridLayoutItem[]) => {
    setLayoutsState(newLayouts);
    if (isHydrated) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newLayouts));
      } catch (error) {
        console.warn('Failed to save grid layouts to localStorage:', error);
      }
    }
  }, [storageKey, isHydrated]);

  // Reset to default layouts
  const resetLayouts = useCallback(() => {
    setLayoutsState(defaultLayouts);
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('Failed to remove grid layouts from localStorage:', error);
    }
  }, [storageKey, defaultLayouts]);

  return [layouts, setLayouts, resetLayouts];
}

export default ResizableGrid;
