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
  /** Maximum column span (default: 2) */
  maxColSpan?: number;
}

/**
 * Resize direction type
 */
type ResizeDirection = 'vertical' | 'horizontal' | null;

/**
 * A single resizable grid item with drag handles for vertical and horizontal resizing
 *
 * Features:
 * - Vertical resize handle at the bottom (changes height)
 * - Horizontal resize handle at the right edge (toggles column span)
 * - Smooth resize animation
 * - Minimum and maximum height constraints
 * - Keyboard accessibility for resize handles
 * - When expanded horizontally, adjacent charts reflow below
 */
function ResizableGridItem({
  id,
  layout,
  onLayoutChange,
  children,
  minHeight = 250,
  maxHeight = 800,
  resizable = true,
  maxColSpan = 2,
}: ResizableGridItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection>(null);
  const [currentHeight, setCurrentHeight] = useState(layout.height || 350);
  const [currentColSpan, setCurrentColSpan] = useState(layout.colSpan);
  const [horizontalDragDelta, setHorizontalDragDelta] = useState(0);

  // Refs for tracking resize operations
  const startY = useRef(0);
  const startX = useRef(0);
  const startHeight = useRef(0);
  const startColSpan = useRef(1);
  const containerWidth = useRef(0);

  // Use ref to track current values for handlers (avoids stale closures)
  const currentHeightRef = useRef(currentHeight);
  const currentColSpanRef = useRef(currentColSpan);
  // Use ref for callback to avoid effect re-running when callback reference changes
  const onLayoutChangeRef = useRef(onLayoutChange);

  // Keep refs in sync
  useEffect(() => {
    currentHeightRef.current = currentHeight;
  }, [currentHeight]);

  useEffect(() => {
    currentColSpanRef.current = currentColSpan;
  }, [currentColSpan]);

  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  // Sync with external layout changes (e.g., reset button)
  useEffect(() => {
    if (layout.height && layout.height !== currentHeightRef.current && !resizeDirection) {
      setCurrentHeight(layout.height);
    }
    if (layout.colSpan !== currentColSpanRef.current && !resizeDirection) {
      setCurrentColSpan(layout.colSpan);
    }
  }, [layout.height, layout.colSpan, resizeDirection]);

  /**
   * Handle mouse down on vertical resize handle (bottom edge)
   */
  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection('vertical');
    startY.current = e.clientY;
    startHeight.current = currentHeightRef.current;
  }, []);

  /**
   * Handle touch start on vertical resize handle
   */
  const handleVerticalTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection('vertical');
    startY.current = e.touches[0].clientY;
    startHeight.current = currentHeightRef.current;
  }, []);

  /**
   * Handle mouse down on horizontal resize handle (right edge)
   */
  const handleHorizontalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection('horizontal');
    startX.current = e.clientX;
    startColSpan.current = currentColSpanRef.current;
    if (containerRef.current) {
      containerWidth.current = containerRef.current.offsetWidth;
    }
    setHorizontalDragDelta(0);
  }, []);

  /**
   * Handle touch start on horizontal resize handle
   */
  const handleHorizontalTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection('horizontal');
    startX.current = e.touches[0].clientX;
    startColSpan.current = currentColSpanRef.current;
    if (containerRef.current) {
      containerWidth.current = containerRef.current.offsetWidth;
    }
    setHorizontalDragDelta(0);
  }, []);

  /**
   * Handle mouse/touch move during resize
   */
  useEffect(() => {
    if (!resizeDirection) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeDirection === 'vertical') {
        const deltaY = e.clientY - startY.current;
        const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight.current + deltaY));
        setCurrentHeight(newHeight);
      } else if (resizeDirection === 'horizontal') {
        const deltaX = e.clientX - startX.current;
        setHorizontalDragDelta(deltaX);

        // Calculate threshold for toggling column span
        // Expand to full width if dragged more than 30% of container width
        // Collapse to half width if dragged back more than 30%
        const threshold = containerWidth.current * 0.3;

        if (startColSpan.current === 1 && deltaX > threshold) {
          setCurrentColSpan(Math.min(maxColSpan, 2));
        } else if (startColSpan.current === 2 && deltaX < -threshold) {
          setCurrentColSpan(1);
        } else {
          setCurrentColSpan(startColSpan.current);
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (resizeDirection === 'vertical') {
        const deltaY = e.touches[0].clientY - startY.current;
        const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight.current + deltaY));
        setCurrentHeight(newHeight);
      } else if (resizeDirection === 'horizontal') {
        const deltaX = e.touches[0].clientX - startX.current;
        setHorizontalDragDelta(deltaX);

        const threshold = containerWidth.current * 0.3;

        if (startColSpan.current === 1 && deltaX > threshold) {
          setCurrentColSpan(Math.min(maxColSpan, 2));
        } else if (startColSpan.current === 2 && deltaX < -threshold) {
          setCurrentColSpan(1);
        } else {
          setCurrentColSpan(startColSpan.current);
        }
      }
    };

    const handleEnd = () => {
      // Persist changes based on resize direction
      if (resizeDirection === 'vertical') {
        onLayoutChangeRef.current(id, { height: currentHeightRef.current });
      } else if (resizeDirection === 'horizontal') {
        onLayoutChangeRef.current(id, { colSpan: currentColSpanRef.current });
      }
      setResizeDirection(null);
      setHorizontalDragDelta(0);
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
  }, [resizeDirection, id, minHeight, maxHeight, maxColSpan]);

  // Determine if we're showing expand or collapse hint
  const isExpanded = currentColSpan >= maxColSpan;
  const showExpandHint = resizeDirection === 'horizontal' && horizontalDragDelta > 50 && !isExpanded;
  const showCollapseHint = resizeDirection === 'horizontal' && horizontalDragDelta < -50 && isExpanded;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative group/resize transition-all duration-200',
        resizeDirection && 'select-none',
        resizeDirection === 'horizontal' && 'z-30'
      )}
      style={{
        height: currentHeight,
        gridColumn: `span ${currentColSpan}`,
      }}
    >
      {/* Main content area */}
      <div className="h-full w-full overflow-hidden rounded-xl">
        {children}
      </div>

      {/* Vertical resize handle - bottom edge */}
      {resizable && (
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize z-20',
            'flex items-center justify-center',
            'opacity-0 group-hover/resize:opacity-100 transition-opacity duration-200',
            resizeDirection === 'vertical' && 'opacity-100'
          )}
          onMouseDown={handleVerticalMouseDown}
          onTouchStart={handleVerticalTouchStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${id} chart height`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              const newHeight = Math.max(minHeight, currentHeight - 20);
              setCurrentHeight(newHeight);
              onLayoutChangeRef.current(id, { height: newHeight });
            } else if (e.key === 'ArrowDown') {
              const newHeight = Math.min(maxHeight, currentHeight + 20);
              setCurrentHeight(newHeight);
              onLayoutChangeRef.current(id, { height: newHeight });
            }
          }}
        >
          <div className={cn(
            'w-16 h-1.5 rounded-full bg-white/20 hover:bg-primary/50 transition-colors',
            resizeDirection === 'vertical' && 'bg-primary'
          )} />
        </div>
      )}

      {/* Horizontal resize handle - right edge */}
      {resizable && (
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 w-3 cursor-ew-resize z-20',
            'flex items-center justify-center',
            'opacity-0 group-hover/resize:opacity-100 transition-opacity duration-200',
            resizeDirection === 'horizontal' && 'opacity-100'
          )}
          onMouseDown={handleHorizontalMouseDown}
          onTouchStart={handleHorizontalTouchStart}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${id} chart width`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && currentColSpan < maxColSpan) {
              const newColSpan = Math.min(maxColSpan, currentColSpan + 1);
              setCurrentColSpan(newColSpan);
              onLayoutChangeRef.current(id, { colSpan: newColSpan });
            } else if (e.key === 'ArrowLeft' && currentColSpan > 1) {
              const newColSpan = Math.max(1, currentColSpan - 1);
              setCurrentColSpan(newColSpan);
              onLayoutChangeRef.current(id, { colSpan: newColSpan });
            }
          }}
        >
          <div className={cn(
            'h-16 w-1.5 rounded-full bg-white/20 hover:bg-primary/50 transition-colors',
            resizeDirection === 'horizontal' && 'bg-primary'
          )} />
        </div>
      )}

      {/* Corner resize handle - bottom right */}
      {resizable && (
        <div
          className={cn(
            'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30',
            'opacity-0 group-hover/resize:opacity-100 transition-opacity duration-200',
            resizeDirection && 'opacity-100'
          )}
          onMouseDown={(e) => {
            // Start both resize operations
            handleVerticalMouseDown(e);
          }}
        >
          <svg
            className={cn(
              'w-full h-full text-white/20 hover:text-primary/50 transition-colors',
              resizeDirection && 'text-primary'
            )}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M14 14H12V12H14V14ZM14 10H12V8H14V10ZM10 14H8V12H10V14Z" />
          </svg>
        </div>
      )}

      {/* Expand/Collapse visual hint during horizontal resize */}
      {(showExpandHint || showCollapseHint) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <div className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium',
            'bg-primary/90 text-white shadow-lg',
            'animate-pulse'
          )}>
            {showExpandHint ? 'Release to expand' : 'Release to collapse'}
          </div>
        </div>
      )}

      {/* Resize overlay to prevent chart interaction during resize */}
      {resizeDirection && (
        <div
          className={cn(
            'absolute inset-0 z-10',
            resizeDirection === 'vertical' && 'cursor-ns-resize',
            resizeDirection === 'horizontal' && 'cursor-ew-resize'
          )}
        />
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
  /** Maximum column span for grid items (default: columns value) */
  maxColSpan?: number;
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
  maxColSpan,
  resizable = true,
  className,
}: ResizableGridProps) {
  // Default maxColSpan to columns value
  const effectiveMaxColSpan = maxColSpan ?? columns;

  // Use refs to store current values so the callback doesn't need to depend on them
  // This prevents the callback from being recreated when layouts change during resize
  const layoutsRef = useRef(layouts);
  const onLayoutsChangeRef = useRef(onLayoutsChange);

  // Keep refs in sync with props
  useEffect(() => {
    layoutsRef.current = layouts;
  }, [layouts]);

  useEffect(() => {
    onLayoutsChangeRef.current = onLayoutsChange;
  }, [onLayoutsChange]);

  /**
   * Handle layout change for a single item
   * Updates the layouts array and calls the callback
   * Uses refs to avoid recreating callback on every layout change
   */
  const handleLayoutChange = useCallback((id: string, changes: Partial<GridLayoutItem>) => {
    const currentLayouts = layoutsRef.current;
    const newLayouts = currentLayouts.map((layout) =>
      layout.id === id ? { ...layout, ...changes } : layout
    );
    onLayoutsChangeRef.current(newLayouts);
  }, []); // Empty deps - uses refs for current values

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
          maxColSpan={effectiveMaxColSpan}
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
  // Use ref to store default layouts to avoid re-running effect on every render
  const defaultLayoutsRef = useRef(defaultLayouts);
  const [layouts, setLayoutsState] = useState<GridLayoutItem[]>(defaultLayouts);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load layouts from localStorage on mount (client-side only)
  // Only runs once on mount - uses ref to avoid dependency on defaultLayouts
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as GridLayoutItem[];

        // Merge stored layouts with defaults:
        // - Use stored values for items that exist in both
        // - Use default values for new items not in storage
        const mergedLayouts = defaultLayoutsRef.current.map((defaultLayout) => {
          const storedLayout = parsed.find((l) => l.id === defaultLayout.id);
          return storedLayout || defaultLayout;
        });

        setLayoutsState(mergedLayouts);
      }
    } catch (error) {
      console.warn('Failed to load grid layouts from localStorage:', error);
    }
    setIsHydrated(true);
  }, [storageKey]); // Only depend on storageKey, not defaultLayouts

  // Save layouts to localStorage whenever they change (after hydration)
  const setLayouts = useCallback((newLayouts: GridLayoutItem[]) => {
    setLayoutsState(newLayouts);
    // Save synchronously to localStorage (isHydrated check not needed here
    // since this is only called after user interaction)
    try {
      localStorage.setItem(storageKey, JSON.stringify(newLayouts));
    } catch (error) {
      console.warn('Failed to save grid layouts to localStorage:', error);
    }
  }, [storageKey]);

  // Reset to default layouts
  const resetLayouts = useCallback(() => {
    setLayoutsState(defaultLayoutsRef.current);
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('Failed to remove grid layouts from localStorage:', error);
    }
  }, [storageKey]);

  return [layouts, setLayouts, resetLayouts];
}

export default ResizableGrid;
