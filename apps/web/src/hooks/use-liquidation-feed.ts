/**
 * useLiquidationFeed Hook
 *
 * A custom React hook for managing real-time liquidation data with auto-refresh.
 * Provides live liquidation events, statistics, and cascade alerts.
 *
 * Features:
 * - Auto-refreshing liquidation feed (configurable interval)
 * - Rolling statistics (1m, 5m, 15m)
 * - New event detection with callbacks
 * - Cascade alert monitoring
 * - Sound notification support (optional)
 * - Pause/resume functionality
 *
 * @example
 * const { events, stats, cascades, isLoading, refresh } = useLiquidationFeed({
 *   exchange: 'binance',
 *   symbol: 'BTCUSDT',
 *   refreshInterval: 5000,
 *   onNewLiquidation: (event) => console.log('New liquidation:', event),
 * });
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { LazuliAPI } from '@/lib/api-client';
import { useAutoRefresh } from './use-auto-refresh';
import type {
  LiquidationEvent,
  CascadeAlert,
  LiquidationStats,
  LiveLiquidationFeed,
  LiquidationExchange,
} from '@lazuli/shared';

/**
 * Configuration options for useLiquidationFeed hook
 */
export interface UseLiquidationFeedOptions {
  /**
   * Exchange to fetch liquidations from
   */
  exchange: LiquidationExchange;

  /**
   * Optional symbol filter (e.g., "BTCUSDT")
   */
  symbol?: string;

  /**
   * Refresh interval in milliseconds
   * @default 5000 (5 seconds)
   */
  refreshInterval?: number;

  /**
   * Maximum number of events to display
   * @default 50
   */
  maxEvents?: number;

  /**
   * Whether to enable auto-refresh
   * @default true
   */
  enabled?: boolean;

  /**
   * Callback when new liquidation event is received
   * Useful for sound notifications or animations
   */
  onNewLiquidation?: (event: LiquidationEvent) => void;

  /**
   * Callback when cascade alert is detected
   */
  onCascadeAlert?: (alert: CascadeAlert) => void;

  /**
   * Minimum USD value to trigger onNewLiquidation callback
   * @default 0 (trigger for all liquidations)
   */
  minValueForCallback?: number;
}

/**
 * Return type for useLiquidationFeed hook
 */
export interface UseLiquidationFeedReturn {
  /** Recent liquidation events */
  events: LiquidationEvent[];

  /** Rolling statistics summary */
  summary: {
    last1m: { count: number; value: number };
    last5m: { count: number; value: number };
    last15m: { count: number; value: number };
  };

  /** Active cascade alerts */
  cascades: CascadeAlert[];

  /** Whether initial data is loading */
  isLoading: boolean;

  /** Whether data is refreshing in background */
  isRefreshing: boolean;

  /** Error message if fetch failed */
  error: string | null;

  /** Timestamp of last update */
  lastUpdated: Date | null;

  /** Formatted last update time */
  lastUpdatedString: string | null;

  /** Manually trigger refresh */
  refresh: () => Promise<void>;

  /** Pause auto-refresh */
  pause: () => void;

  /** Resume auto-refresh */
  resume: () => void;

  /** Whether auto-refresh is paused */
  isPaused: boolean;

  /** Seconds until next refresh */
  countdown: number;

  /** Set of IDs that are "new" (appeared in last refresh) */
  newEventIds: Set<string>;
}

/**
 * Default refresh interval for liquidation feed (5 seconds)
 */
const DEFAULT_REFRESH_INTERVAL = 5000;

/**
 * useLiquidationFeed Hook
 *
 * Manages real-time liquidation data with automatic polling.
 */
export function useLiquidationFeed({
  exchange,
  symbol,
  refreshInterval = DEFAULT_REFRESH_INTERVAL,
  maxEvents = 50,
  enabled = true,
  onNewLiquidation,
  onCascadeAlert,
  minValueForCallback = 0,
}: UseLiquidationFeedOptions): UseLiquidationFeedReturn {
  // Track previously seen event IDs for new event detection
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenCascadeIdsRef = useRef<Set<string>>(new Set());
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());

  // Fetch live feed data
  const {
    data,
    isLoading,
    isRefreshing,
    error,
    lastUpdated,
    lastUpdatedString,
    refresh,
    pause,
    resume,
    isPaused,
    countdown,
  } = useAutoRefresh<LiveLiquidationFeed>({
    fetchFn: () => LazuliAPI.getLiquidationFeed(exchange, { symbol, limit: maxEvents }),
    interval: refreshInterval,
    enabled,
    fetchOnMount: true,
  });

  // Process new events when data updates
  useEffect(() => {
    if (!data?.events) return;

    const newIds = new Set<string>();
    const newEvents: LiquidationEvent[] = [];

    // Find new events that weren't seen before
    for (const event of data.events) {
      if (!seenIdsRef.current.has(event.id)) {
        newIds.add(event.id);
        newEvents.push(event);
        seenIdsRef.current.add(event.id);
      }
    }

    // Update new event IDs state for UI highlighting
    if (newIds.size > 0) {
      setNewEventIds(newIds);

      // Clear new status after 3 seconds
      setTimeout(() => {
        setNewEventIds(new Set());
      }, 3000);
    }

    // Trigger callbacks for new events
    if (onNewLiquidation) {
      for (const event of newEvents) {
        if (event.value >= minValueForCallback) {
          onNewLiquidation(event);
        }
      }
    }

    // Limit the size of seen IDs set to prevent memory issues
    if (seenIdsRef.current.size > 1000) {
      const idsArray = Array.from(seenIdsRef.current);
      seenIdsRef.current = new Set(idsArray.slice(-500));
    }
  }, [data?.events, onNewLiquidation, minValueForCallback]);

  // Process cascade alerts
  useEffect(() => {
    if (!data?.cascades || !onCascadeAlert) return;

    for (const cascade of data.cascades) {
      if (!seenCascadeIdsRef.current.has(cascade.id)) {
        seenCascadeIdsRef.current.add(cascade.id);
        onCascadeAlert(cascade);
      }
    }

    // Limit cascade ID set size
    if (seenCascadeIdsRef.current.size > 100) {
      const idsArray = Array.from(seenCascadeIdsRef.current);
      seenCascadeIdsRef.current = new Set(idsArray.slice(-50));
    }
  }, [data?.cascades, onCascadeAlert]);

  // Memoize return values
  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const summary = useMemo(
    () =>
      data?.summary ?? {
        last1m: { count: 0, value: 0 },
        last5m: { count: 0, value: 0 },
        last15m: { count: 0, value: 0 },
      },
    [data?.summary]
  );
  const cascades = useMemo(() => data?.cascades ?? [], [data?.cascades]);

  return {
    events,
    summary,
    cascades,
    isLoading,
    isRefreshing,
    error,
    lastUpdated,
    lastUpdatedString,
    refresh,
    pause,
    resume,
    isPaused,
    countdown,
    newEventIds,
  };
}

/**
 * Hook for fetching liquidation statistics with auto-refresh
 */
export interface UseLiquidationStatsOptions {
  exchange: LiquidationExchange;
  symbol?: string;
  period?: '1h' | '4h' | '24h';
  refreshInterval?: number;
  enabled?: boolean;
}

export function useLiquidationStats({
  exchange,
  symbol,
  period = '24h',
  refreshInterval = 30000, // 30 seconds default for stats
  enabled = true,
}: UseLiquidationStatsOptions) {
  return useAutoRefresh<LiquidationStats>({
    fetchFn: () => LazuliAPI.getLiquidationStats(exchange, { period, symbol }),
    interval: refreshInterval,
    enabled,
    fetchOnMount: true,
  });
}

/**
 * Hook for fetching cascade alerts with auto-refresh
 */
export interface UseCascadeAlertsOptions {
  threshold?: number;
  refreshInterval?: number;
  enabled?: boolean;
  onNewCascade?: (cascade: CascadeAlert) => void;
}

export function useCascadeAlerts({
  threshold,
  refreshInterval = 10000, // 10 seconds default for cascades
  enabled = true,
  onNewCascade,
}: UseCascadeAlertsOptions = {}) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  const result = useAutoRefresh<{
    cascades: CascadeAlert[];
    count: number;
    threshold: number;
    timestamp: number;
  }>({
    fetchFn: () => LazuliAPI.getCascadeAlerts(threshold ? { threshold } : undefined),
    interval: refreshInterval,
    enabled,
    fetchOnMount: true,
  });

  // Process new cascades
  useEffect(() => {
    if (!result.data?.cascades || !onNewCascade) return;

    for (const cascade of result.data.cascades) {
      if (!seenIdsRef.current.has(cascade.id)) {
        seenIdsRef.current.add(cascade.id);
        onNewCascade(cascade);
      }
    }
  }, [result.data?.cascades, onNewCascade]);

  return {
    ...result,
    cascades: result.data?.cascades ?? [],
  };
}

export default useLiquidationFeed;
