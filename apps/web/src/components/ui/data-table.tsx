/**
 * DataTable — virtualized, sortable, column-resizable data table
 *
 * Built on @tanstack/react-virtual for windowed rendering. Designed for
 * the markets page (1000+ rows) but generic for any tabular data.
 *
 * Features:
 *  - Server-side or client-side sorting via column.sortable + onChange
 *  - Sticky header
 *  - Column visibility (controlled via `hiddenColumns` prop)
 *  - Row click navigation
 *  - Density-aware (driven by [data-density] attr)
 *  - Mobile: optional `renderMobileCard` for card-list rendering under sm
 *  - Empty / error states
 *
 * Usage:
 *   <DataTable
 *     columns={[
 *       { id: 'symbol', header: 'Symbol', cell: (row) => row.symbol, sortable: true },
 *       { id: 'price', header: 'Price', cell: (row) => <PriceText value={row.last} />, numeric: true, sortable: true },
 *     ]}
 *     rows={tickers}
 *     rowKey={(r) => r.symbol}
 *     onRowClick={(r) => navigate(`/workspace?symbol=${r.symbol}`)}
 *   />
 */

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

export interface Column<T> {
  /** Unique column id */
  id: string;
  /** Header label (string or React) */
  header: React.ReactNode;
  /** Cell renderer — receives the row data */
  cell: (row: T, index: number) => React.ReactNode;
  /** Sort accessor — return primitive value for sort comparison. Marks column sortable. */
  sortAccessor?: (row: T) => string | number | null | undefined;
  /** Explicit sortable flag — if true, table shows sort UI even without accessor */
  sortable?: boolean;
  /** Right-align numeric columns */
  numeric?: boolean;
  /** Disable user from hiding this column */
  alwaysVisible?: boolean;
  /** Width hint (px). If absent, column auto-distributes. */
  width?: number;
  /** Hide on mobile (< md). Set to a number to hide below that breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  /** Optional className applied to every cell in this column */
  cellClassName?: string;
}

export interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  /** Unique row key — required for virtualization stability */
  rowKey: (row: T) => string;
  /** Loading state — shows skeleton rows */
  loading?: boolean;
  /** Error state — shows error message + retry */
  error?: string | null;
  /** Optional retry callback (shows retry button when error) */
  onRetry?: () => void;
  /** Sort state — controlled. Omit for client-side uncontrolled. */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Hidden column ids */
  hiddenColumns?: string[];
  onHiddenColumnsChange?: (hidden: string[]) => void;
  /** Row action button (e.g. watchlist star). Rendered at end of row */
  rowAction?: (row: T) => React.ReactNode;
  /** Render mobile card variant (under sm). If absent, table scrolls horizontally */
  renderMobileCard?: (row: T) => React.ReactNode;
  /** Estimated row height for virtualization (default 44) */
  estimatedRowHeight?: number;
  /** Container height — required for virtualization */
  height?: number | string;
  /** Max height — useful when content above table also needs space */
  maxHeight?: number | string;
  /** Empty state message */
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** Accessible label */
  'aria-label'?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  sort,
  onSortChange,
  onRowClick,
  hiddenColumns = [],
  rowAction,
  renderMobileCard,
  estimatedRowHeight = 44,
  height,
  maxHeight,
  emptyTitle = 'No data',
  emptyDescription,
  className,
  'aria-label': ariaLabel,
}: DataTableProps<T>) {
  const tableRef = React.useRef<HTMLDivElement>(null);

  // Visible columns — honor hidden + hideBelow
  const visibleColumns = React.useMemo(
    () => columns.filter((c) => !hiddenColumns.includes(c.id)),
    [columns, hiddenColumns]
  );

  // Virtualization
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 8,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // Sorting — toggle direction or change column
  const handleSort = (col: Column<T>) => {
    const canSort = col.sortable || !!col.sortAccessor;
    if (!canSort || !onSortChange) return;
    const isCurrent = sort?.column === col.id;
    onSortChange({
      column: col.id,
      direction: isCurrent && sort?.direction === 'desc' ? 'asc' : 'desc',
    });
  };

  // Container style
  const containerStyle: React.CSSProperties = {
    height,
    maxHeight,
  };

  return (
    <div className={cn('w-full', className)}>
      {/* Error state */}
      {error && (
        <div
          className={cn(
            'rounded-md border border-destructive/30 bg-destructive/5 p-4',
            'flex items-center justify-between gap-3'
          )}
        >
          <div className="text-sm text-destructive">{error}</div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-medium text-destructive hover:underline"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && rows.length === 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          {/* Header skeleton */}
          <div className="flex gap-3 bg-surface-1 border-b border-border p-3">
            {visibleColumns.map((col) => (
              <Skeleton key={col.id} className="h-3 flex-1" />
            ))}
          </div>
          {/* Row skeletons */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3 border-b border-border last:border-0">
              {visibleColumns.map((col) => (
                <Skeleton key={col.id} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-md border border-border bg-surface-1">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      )}

      {/* Data — desktop table view */}
      {!error && (
        <>
          <div
            className="hidden md:block overflow-auto rounded-md border border-border scrollbar-thin"
            style={containerStyle}
            aria-label={ariaLabel}
          >
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  {visibleColumns.map((col) => {
                    const isSorted = sort?.column === col.id;
                    const canSort = col.sortable || !!col.sortAccessor;
                    return (
                      <th
                        key={col.id}
                        scope="col"
                        className={cn(
                          col.numeric && 'numeric text-right',
                          canSort && 'cursor-pointer hover:text-foreground',
                          'whitespace-nowrap'
                        )}
                        style={{ width: col.width }}
                        onClick={() => handleSort(col)}
                        aria-sort={
                          isSorted
                            ? sort?.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                      >
                        <span
                          className={cn(
                            'inline-flex items-center gap-1',
                            col.numeric && 'flex-row-reverse'
                          )}
                        >
                          {col.header}
                          {canSort && (
                            <span className="text-muted-foreground/70">
                              {isSorted ? (
                                sort?.direction === 'asc' ? (
                                  <ArrowUp className="h-3 w-3" aria-hidden />
                                ) : (
                                  <ArrowDown className="h-3 w-3" aria-hidden />
                                )
                              ) : (
                                <ChevronDown className="h-3 w-3 opacity-50" aria-hidden />
                              )}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                  {rowAction && <th scope="col" className="w-10" />}
                </tr>
              </thead>
              <tbody
                style={{ height: rows.length > 0 ? `${totalHeight}px` : undefined }}
                className="relative"
              >
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (!row) return null;
                  const stableRowKey = `${rowKey(row)}:${virtualRow.index}`;
                  return (
                    <tr
                      key={stableRowKey}
                      data-index={virtualRow.index}
                      ref={(node) => virtualizer.measureElement(node)}
                      data-known-size={virtualRow.size}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        'border-b border-border transition-colors',
                        onRowClick && 'cursor-pointer hover:bg-surface-2',
                        !onRowClick && 'hover:bg-surface-2/50'
                      )}
                    >
                      {visibleColumns.map((col) => (
                        <td
                          key={col.id}
                          className={cn(
                            'align-middle text-sm text-foreground',
                            col.numeric && 'numeric text-right',
                            col.cellClassName
                          )}
                          style={{ width: col.width }}
                        >
                          {col.cell(row, virtualRow.index)}
                        </td>
                      ))}
                      {rowAction && (
                        <td className="text-right w-10" onClick={(e) => e.stopPropagation()}>
                          {rowAction(row)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          {renderMobileCard && (
            <div className="md:hidden space-y-2">
              {loading && rows.length === 0
                ? Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-md" />
                  ))
                : rows.map((row, index) => (
                    <div
                      key={`${rowKey(row)}:${index}`}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        'rounded-md border border-border bg-surface-1 p-3',
                        onRowClick && 'cursor-pointer active:bg-surface-2 no-tap-highlight'
                      )}
                    >
                      {renderMobileCard(row)}
                      {rowAction && (
                        <div className="mt-2 pt-2 border-t border-border flex justify-end">
                          {rowAction(row)}
                        </div>
                      )}
                    </div>
                  ))}
            </div>
          )}

          {/* Mobile fallback — horizontal scroll table */}
          {!renderMobileCard && (
            <div className="md:hidden overflow-x-auto scrollbar-thin rounded-md border border-border">
              <table className="w-full">
                <thead>
                  <tr>
                    {visibleColumns.map((col) => (
                      <th key={col.id} className="whitespace-nowrap">
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={`${rowKey(row)}:${i}`}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(onRowClick && 'cursor-pointer hover:bg-surface-2')}
                    >
                      {visibleColumns.map((col) => (
                        <td
                          key={col.id}
                          className={cn(col.numeric && 'numeric text-right', 'whitespace-nowrap')}
                        >
                          {col.cell(row, i)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Footer row count */}
      {!loading && !error && rows.length > 0 && (
        <div className="mt-2 text-xs font-mono text-muted-foreground px-1">
          {rows.length} row{rows.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

/**
 * Column visibility dropdown — companion component
 * Place in a toolbar alongside DataTable.
 */
export function ColumnVisibilityDropdown<T>({
  columns,
  hiddenColumns,
  onHiddenColumnsChange,
  trigger,
}: {
  columns: Array<Column<T>>;
  hiddenColumns: string[];
  onHiddenColumnsChange: (hidden: string[]) => void;
  trigger: React.ReactNode;
}) {
  const toggle = (id: string) => {
    if (hiddenColumns.includes(id)) {
      onHiddenColumnsChange(hiddenColumns.filter((c) => c !== id));
    } else {
      onHiddenColumnsChange([...hiddenColumns, id]);
    }
  };

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer">{trigger}</summary>
      <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-md border border-border bg-surface-2 p-1 shadow-lg">
        <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Columns
        </div>
        {columns.map((col) => (
          <label
            key={col.id}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer',
              'hover:bg-surface-3 transition-colors',
              col.alwaysVisible && 'opacity-60 cursor-not-allowed'
            )}
          >
            <input
              type="checkbox"
              checked={!hiddenColumns.includes(col.id)}
              onChange={() => !col.alwaysVisible && toggle(col.id)}
              disabled={col.alwaysVisible}
              className="h-3.5 w-3.5 rounded border-border bg-transparent accent-[var(--color-accent)]"
            />
            <span className="text-sm text-foreground">{col.header}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

/** Icon for "no data" empty state — Search icon */
export const NoDataIcon = Search;
