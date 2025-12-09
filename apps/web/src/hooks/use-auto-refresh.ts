/**
 * useAutoRefresh Hook
 *
 * A custom React hook that provides auto-refresh functionality for API calls.
 * Enables near real-time data updates without the overhead of WebSocket connections.
 *
 * Features:
 * - Configurable refresh interval (default: 10 seconds)
 * - Manual refresh capability
 * - Pause/resume functionality
 * - Loading and refreshing states
 * - Error handling
 * - Countdown timer for next refresh
 * - Automatic cleanup on unmount
 *
 * @example
 * const { data, isLoading, refresh, countdown } = useAutoRefresh({
 *   fetchFn: () => LazuliAPI.getFundingRates('binance'),
 *   interval: 10000, // 10 seconds
 * });
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ApiResponse } from '@lazuli/shared';

/**
 * Configuration options for useAutoRefresh hook
 */
export interface UseAutoRefreshOptions<T> {
  /**
   * The async function that fetches data
   * Should return an ApiResponse<T> object
   */
  fetchFn: () => Promise<ApiResponse<T>>;

  /**
   * Initial data to use before first fetch completes
   * Useful for server-side rendered data
   */
  initialData?: T;

  /**
   * Refresh interval in milliseconds
   * @default 10000 (10 seconds)
   */
  interval?: number;

  /**
   * Whether to start refreshing immediately
   * @default true
   */
  enabled?: boolean;

  /**
   * Whether to fetch data on mount
   * Set to false if you have initialData from SSR
   * @default true
   */
  fetchOnMount?: boolean;

  /**
   * Callback when data is successfully fetched
   */
  onSuccess?: (data: T) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: string) => void;
}

/**
 * Return type for useAutoRefresh hook
 */
export interface UseAutoRefreshReturn<T> {
  /** The fetched data */
  data: T | null;

  /** Whether the initial fetch is in progress */
  isLoading: boolean;

  /** Whether a background refresh is in progress */
  isRefreshing: boolean;

  /** Error message if fetch failed */
  error: string | null;

  /** Timestamp of the last successful update */
  lastUpdated: Date | null;

  /** Formatted time string of last update */
  lastUpdatedString: string | null;

  /** Manually trigger a refresh */
  refresh: () => Promise<void>;

  /** Pause auto-refresh */
  pause: () => void;

  /** Resume auto-refresh */
  resume: () => void;

  /** Whether auto-refresh is currently paused */
  isPaused: boolean;

  /** Seconds until next automatic refresh */
  countdown: number;
}

/**
 * Default refresh interval (10 seconds)
 */
const DEFAULT_INTERVAL = 10000;

/**
 * Custom hook for auto-refreshing API data
 *
 * Provides a lightweight polling mechanism for near real-time updates
 * without the complexity of WebSocket connections.
 */
export function useAutoRefresh<T>({
  fetchFn,
  initialData,
  interval = DEFAULT_INTERVAL,
  enabled = true,
  fetchOnMount = true,
  onSuccess,
  onError,
}: UseAutoRefreshOptions<T>): UseAutoRefreshReturn<T> {
  // State
  const [data, setData] = useState<T | null>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(!initialData && fetchOnMount);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(initialData ? new Date() : null);
  const [isPaused, setIsPaused] = useState(!enabled);
  const [countdown, setCountdown] = useState(Math.floor(interval / 1000));

  // Refs for cleanup and tracking
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const fetchFnRef = useRef(fetchFn);

  // Keep fetchFn ref updated
  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  /**
   * Core fetch function
   * @param isInitial - Whether this is the initial fetch (shows loading state)
   */
  const fetchData = useCallback(
    async (isInitial = false) => {
      // Cancel any in-flight requests to prevent race conditions
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      // Set appropriate loading state
      if (isInitial) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const response = await fetchFnRef.current();

        // Check if component is still mounted
        if (!isMountedRef.current) return;

        if (response.success && response.data !== null) {
          setData(response.data);
          setError(null);
          setLastUpdated(new Date());
          onSuccess?.(response.data);
        } else {
          const errorMsg = response.error || 'Failed to fetch data';
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } catch (err) {
        // Ignore abort errors - they're expected when canceling requests
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        if (!isMountedRef.current) return;

        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        onError?.(errorMsg);
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          // Reset countdown after fetch completes
          setCountdown(Math.floor(interval / 1000));
        }
      }
    },
    [interval, onSuccess, onError]
  );

  /**
   * Manual refresh - can be called by user
   */
  const refresh = useCallback(async () => {
    await fetchData(false);
    // Reset countdown after manual refresh
    setCountdown(Math.floor(interval / 1000));
  }, [fetchData, interval]);

  /**
   * Pause auto-refresh
   */
  const pause = useCallback(() => {
    setIsPaused(true);
  }, []);

  /**
   * Resume auto-refresh
   */
  const resume = useCallback(() => {
    setIsPaused(false);
    setCountdown(Math.floor(interval / 1000));
  }, [interval]);

  // Initial fetch on mount and cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    if (fetchOnMount && !initialData) {
      fetchData(true);
    }

    return () => {
      isMountedRef.current = false;
      // Cancel any pending requests on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up auto-refresh interval
  useEffect(() => {
    // Clear existing intervals
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Don't set up interval if paused
    if (isPaused) return;

    // Set up new interval
    intervalRef.current = setInterval(() => {
      fetchData(false);
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchData, interval, isPaused]);

  // Countdown timer (updates every second)
  useEffect(() => {
    // Clear existing countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    // Don't run countdown if paused or refreshing
    if (isPaused || isRefreshing) return;

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return Math.floor(interval / 1000);
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [interval, isPaused, isRefreshing]);

  /**
   * Format last updated time - memoized to avoid unnecessary re-computation
   */
  const lastUpdatedString = useMemo(() => lastUpdated?.toLocaleTimeString() ?? null, [lastUpdated]);

  return {
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
  };
}

/**
 * Re-export for convenience
 */
export default useAutoRefresh;
