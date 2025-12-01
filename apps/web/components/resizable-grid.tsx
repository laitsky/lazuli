'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Layout item configuration for a single grid cell
 */
export interface GridLayoutItem {
  /** Unique identifier for the grid item */
  id: string;
  /** @deprecated Use widthPercent instead. Column span (1-4) for discrete sizing */
  colSpan: number;
  /** Row span (1-3) */
  rowSpan: number;
  /** Height in pixels (overrides rowSpan when set) */
  height?: number;
  /** Width as a percentage (30-100). When items in a row exceed 100%, they wrap to next row */
  widthPercent?: number;
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
  /** Minimum width percentage (default: 30) */
  minWidthPercent?: number;
  /** Maximum width percentage (default: 100) */
  maxWidthPercent?: number;
  /** Gap between items in pixels, used for width calculations */
  gap?: number;
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
 * - Horizontal resize handle at the right edge (gradual width adjustment)
 * - Smooth resize animation with percentage-based widths
 * - Minimum and maximum constraints for both height and width
 * - Keyboard accessibility for resize handles
 * - Items automatically wrap when combined widths exceed 100%
 */
function ResizableGridItem({
  id,
  layout,
  onLayoutChange,
  children,
  minHeight = 250,
  maxHeight = 800,
  resizable = true,
  minWidthPercent = 30,
  maxWidthPercent = 100,
  gap = 24,
}: ResizableGridItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection>(null);
  const [currentHeight, setCurrentHeight] = useState(layout.height || 350);
  // Use widthPercent if available, otherwise derive from colSpan for backward compatibility
  const initialWidthPercent = layout.widthPercent ?? (layout.colSpan === 2 ? 100 : 50);
  const [currentWidthPercent, setCurrentWidthPercent] = useState(initialWidthPercent);

  // Refs for tracking resize operations
  const startY = useRef(0);
  const startX = useRef(0);
  const startHeight = useRef(0);
  const startWidthPercent = useRef(50);
  const parentWidth = useRef(0);

  // Use ref to track current values for handlers (avoids stale closures)
  const currentHeightRef = useRef(currentHeight);
  const currentWidthPercentRef = useRef(currentWidthPercent);
  // Use ref for callback to avoid effect re-running when callback reference changes
  const onLayoutChangeRef = useRef(onLayoutChange);

  // Keep refs in sync
  useEffect(() => {
    currentHeightRef.current = currentHeight;
  }, [currentHeight]);

  useEffect(() => {
    currentWidthPercentRef.current = currentWidthPercent;
  }, [currentWidthPercent]);

  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  // Sync with external layout changes (e.g., reset button)
  useEffect(() => {
    if (layout.height && layout.height !== currentHeightRef.current && !resizeDirection) {
      setCurrentHeight(layout.height);
    }
    const externalWidthPercent = layout.widthPercent ?? (layout.colSpan === 2 ? 100 : 50);
    if (externalWidthPercent !== currentWidthPercentRef.current && !resizeDirection) {
      setCurrentWidthPercent(externalWidthPercent);
    }
  }, [layout.height, layout.widthPercent, layout.colSpan, resizeDirection]);

  // Store parent reference for width calculations
  useEffect(() => {
    if (containerRef.current) {
      parentRef.current = containerRef.current.parentElement as HTMLDivElement;
    }
  }, []);

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
   * Captures starting position and parent width for percentage calculations
   */
  const handleHorizontalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection('horizontal');
    startX.current = e.clientX;
    startWidthPercent.current = currentWidthPercentRef.current;
    if (parentRef.current) {
      parentWidth.current = parentRef.current.offsetWidth;
    }
  }, []);

  /**
   * Handle touch start on horizontal resize handle
   * Captures starting position and parent width for percentage calculations
   */
  const handleHorizontalTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection('horizontal');
    startX.current = e.touches[0].clientX;
    startWidthPercent.current = currentWidthPercentRef.current;
    if (parentRef.current) {
      parentWidth.current = parentRef.current.offsetWidth;
    }
  }, []);

  /**
   * Snap width percentage to nearest 5% for cleaner values
   */
  const snapToGrid = useCallback((percent: number): number => {
    return Math.round(percent / 5) * 5;
  }, []);

  /**
   * Handle mouse/touch move during resize
   * For horizontal resize, converts pixel movement to percentage change
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
        // Convert pixel delta to percentage (relative to parent width)
        const deltaPercent = (deltaX / parentWidth.current) * 100;
        const newPercent = Math.min(
          maxWidthPercent,
          Math.max(minWidthPercent, startWidthPercent.current + deltaPercent)
        );
        setCurrentWidthPercent(newPercent);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (resizeDirection === 'vertical') {
        const deltaY = e.touches[0].clientY - startY.current;
        const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight.current + deltaY));
        setCurrentHeight(newHeight);
      } else if (resizeDirection === 'horizontal') {
        const deltaX = e.touches[0].clientX - startX.current;
        // Convert pixel delta to percentage (relative to parent width)
        const deltaPercent = (deltaX / parentWidth.current) * 100;
        const newPercent = Math.min(
          maxWidthPercent,
          Math.max(minWidthPercent, startWidthPercent.current + deltaPercent)
        );
        setCurrentWidthPercent(newPercent);
      }
    };

    const handleEnd = () => {
      // Persist changes based on resize direction
      if (resizeDirection === 'vertical') {
        onLayoutChangeRef.current(id, { height: currentHeightRef.current });
      } else if (resizeDirection === 'horizontal') {
        // Snap to nearest 5% for cleaner values
        const snappedPercent = snapToGrid(currentWidthPercentRef.current);
        setCurrentWidthPercent(snappedPercent);
        // Also update colSpan for backward compatibility (1 for <=50%, 2 for >50%)
        const colSpan = snappedPercent > 50 ? 2 : 1;
        onLayoutChangeRef.current(id, { widthPercent: snappedPercent, colSpan });
      }
      setResizeDirection(null);
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
  }, [resizeDirection, id, minHeight, maxHeight, minWidthPercent, maxWidthPercent, snapToGrid]);

  // Calculate width style with gap compensation
  // When using flex-basis percentage, we need to account for gaps
  const getWidthStyle = useCallback(() => {
    // For 100% width, take full width
    if (currentWidthPercent >= 100) {
      return { flexBasis: '100%', maxWidth: '100%' };
    }
    // For partial widths, calculate with gap compensation
    // If item is 50%, it shares row with potentially one other item, so subtract half gap
    // Formula: calc(percent% - gap * (1 - percent/100))
    const gapCompensation = gap * (1 - currentWidthPercent / 100);
    return {
      flexBasis: `calc(${currentWidthPercent}% - ${gapCompensation}px)`,
      maxWidth: `calc(${currentWidthPercent}% - ${gapCompensation}px)`,
    };
  }, [currentWidthPercent, gap]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative group/resize transition-all duration-200 flex-shrink-0',
        resizeDirection && 'select-none',
        resizeDirection === 'horizontal' && 'z-30'
      )}
      style={{
        height: currentHeight,
        ...getWidthStyle(),
      }}
    >
      {/* Main content area */}
      <div className="h-full w-full overflow-hidden rounded-xl">{children}</div>

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
              e.preventDefault(); // Prevent page scroll
              const newHeight = Math.max(minHeight, currentHeight - 20);
              setCurrentHeight(newHeight);
              onLayoutChangeRef.current(id, { height: newHeight });
            } else if (e.key === 'ArrowDown') {
              e.preventDefault(); // Prevent page scroll
              const newHeight = Math.min(maxHeight, currentHeight + 20);
              setCurrentHeight(newHeight);
              onLayoutChangeRef.current(id, { height: newHeight });
            }
          }}
        >
          <div
            className={cn(
              'w-16 h-1.5 rounded-full bg-white/20 hover:bg-primary/50 transition-colors',
              resizeDirection === 'vertical' && 'bg-primary'
            )}
          />
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
          aria-label={`Resize ${id} chart width, currently ${Math.round(currentWidthPercent)}%`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && currentWidthPercent < maxWidthPercent) {
              e.preventDefault(); // Prevent page scroll
              const newPercent = Math.min(maxWidthPercent, currentWidthPercent + 5);
              setCurrentWidthPercent(newPercent);
              const colSpan = newPercent > 50 ? 2 : 1;
              onLayoutChangeRef.current(id, { widthPercent: newPercent, colSpan });
            } else if (e.key === 'ArrowLeft' && currentWidthPercent > minWidthPercent) {
              e.preventDefault(); // Prevent page scroll
              const newPercent = Math.max(minWidthPercent, currentWidthPercent - 5);
              setCurrentWidthPercent(newPercent);
              const colSpan = newPercent > 50 ? 2 : 1;
              onLayoutChangeRef.current(id, { widthPercent: newPercent, colSpan });
            }
          }}
        >
          <div
            className={cn(
              'h-16 w-1.5 rounded-full bg-white/20 hover:bg-primary/50 transition-colors',
              resizeDirection === 'horizontal' && 'bg-primary'
            )}
          />
        </div>
      )}

      {/* Corner resize handle - bottom right (triggers vertical resize) */}
      {resizable && (
        <div
          className={cn(
            'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30',
            'opacity-0 group-hover/resize:opacity-100 transition-opacity duration-200',
            resizeDirection && 'opacity-100'
          )}
          onMouseDown={(e) => {
            // Corner handle triggers vertical resize for convenience
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

      {/* Width percentage indicator during horizontal resize */}
      {resizeDirection === 'horizontal' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <div
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium',
              'bg-primary/90 text-white shadow-lg'
            )}
          >
            {Math.round(currentWidthPercent)}%
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
  /** @deprecated No longer used with flexbox layout */
  columns?: number;
  /** Gap between grid items in pixels (default: 24) */
  gap?: number;
  /** Minimum height for grid items */
  minHeight?: number;
  /** Maximum height for grid items */
  maxHeight?: number;
  /** Minimum width percentage for grid items (default: 30) */
  minWidthPercent?: number;
  /** Maximum width percentage for grid items (default: 100) */
  maxWidthPercent?: number;
  /** Whether resizing is enabled */
  resizable?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * A responsive flex container with resizable items
 *
 * Features:
 * - Flexbox-based layout with percentage widths
 * - Gradual horizontal resizing (30-100% width)
 * - Individual item height customization
 * - Items automatically wrap when combined widths exceed 100%
 * - Persists layout changes via callback
 * - Mobile-friendly with touch support
 *
 * @example
 * ```tsx
 * <ResizableGrid
 *   layouts={[
 *     { id: '1h', colSpan: 2, rowSpan: 1, height: 500, widthPercent: 70 },
 *     { id: '15m', colSpan: 1, rowSpan: 1, height: 350, widthPercent: 30 },
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
  gap = 24,
  minHeight = 250,
  maxHeight = 800,
  minWidthPercent = 30,
  maxWidthPercent = 100,
  resizable = true,
  className,
}: ResizableGridProps) {
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
      className={cn('flex flex-wrap', className)}
      style={{
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
          minWidthPercent={minWidthPercent}
          maxWidthPercent={maxWidthPercent}
          gap={gap}
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
  }, [storageKey]); // Only depend on storageKey, not defaultLayouts

  // Save layouts to localStorage whenever they change
  const setLayouts = useCallback(
    (newLayouts: GridLayoutItem[]) => {
      setLayoutsState(newLayouts);
      // Save to localStorage (only called after user interaction)
      try {
        localStorage.setItem(storageKey, JSON.stringify(newLayouts));
      } catch (error) {
        console.warn('Failed to save grid layouts to localStorage:', error);
      }
    },
    [storageKey]
  );

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
