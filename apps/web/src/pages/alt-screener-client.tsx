/**
 * Alt Screener Client Component
 *
 * This client component handles the interactive functionality of the Alt Screener:
 * - Base currency switching (instant, no API refetch!)
 * - Client-side filtering and sorting
 * - View mode toggling (grid, list, heatmap)
 * - Auto-refresh data every 10 seconds for near real-time updates
 *
 * Performance optimization: Base currency switching is done client-side by
 * dividing USD prices by the base currency price. This avoids slow API calls
 * when users switch between USD/BTC/ETH/SOL comparisons.
 */

import { useState, useCallback, useTransition, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AltcoinGrid } from '@/components/altcoin-grid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LazuliAPI } from '@/lib/api-client';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import {
  AltScreenerResponse,
  BaseCurrency,
  BaseCurrencyPrices,
  SupportedExchange,
} from '@lazuli/shared';
import { RefreshCw, Timer, Pause, Play } from 'lucide-react';

interface AltScreenerClientProps {
  /** Initial screener data from server */
  initialData: AltScreenerResponse;
  /** Current exchange */
  exchange: SupportedExchange;
  /** Initial base currency */
  initialBase: BaseCurrency;
}

/**
 * Default base currency prices (fallback if API doesn't provide them)
 */
const DEFAULT_BASE_PRICES: BaseCurrencyPrices = {
  USD: 1,
  BTC: 0,
  ETH: 0,
  SOL: 0,
};

/**
 * Auto-refresh interval in milliseconds (10 seconds)
 */
const AUTO_REFRESH_INTERVAL = 10000;

export function AltScreenerClient({ initialData, exchange, initialBase }: AltScreenerClientProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [isPending, startTransition] = useTransition();

  // Local UI state
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>(initialBase);

  /**
   * Fetch function for alt screener data
   * Uses lightweight mode for fast auto-refresh (skips OHLCV)
   */
  const fetchAltScreenerData = useCallback(async () => {
    return LazuliAPI.getAltScreener(exchange, {
      base: 'USD', // Always fetch USD data, client handles conversion
      limit: 200,
      sortBy: 'performance',
      sortOrder: 'desc',
      lightweight: true, // Fast refresh without OHLCV
    });
  }, [exchange]);

  /**
   * Auto-refresh hook with 10-second interval
   * Provides near real-time data without WebSocket overhead
   */
  const { data, isRefreshing, lastUpdatedString, refresh, pause, resume, isPaused, countdown } =
    useAutoRefresh<AltScreenerResponse>({
      fetchFn: fetchAltScreenerData,
      initialData,
      interval: AUTO_REFRESH_INTERVAL,
      fetchOnMount: false, // We have initial data from SSR
    });

  // Use initial data as fallback
  const screenerData = data ?? initialData;

  // Get base currency prices (from API response or default)
  const basePrices = useMemo(
    () => screenerData.basePrices ?? DEFAULT_BASE_PRICES,
    [screenerData.basePrices]
  );

  // Calculate the current base price for display
  const currentBasePrice = useMemo(() => basePrices[baseCurrency] ?? 1, [basePrices, baseCurrency]);

  /**
   * Calculate altcoin prices in the selected base currency
   * This is done client-side for instant switching without API calls
   */
  const altcoinsInBaseCurrency = useMemo(() => {
    const basePrice = basePrices[baseCurrency];

    // If USD or base price unavailable, return original data
    if (baseCurrency === 'USD' || !basePrice || basePrice === 0) {
      return screenerData.altcoins;
    }

    // Recalculate priceInBase for each altcoin
    return screenerData.altcoins.map((altcoin) => ({
      ...altcoin,
      priceInBase: altcoin.price / basePrice,
    }));
  }, [screenerData.altcoins, baseCurrency, basePrices]);

  /**
   * Handle base currency change
   * INSTANT - no API call needed! Just recalculates prices client-side
   */
  const handleBaseCurrencyChange = useCallback(
    (newBase: BaseCurrency) => {
      if (newBase === baseCurrency) return;

      // Instant update - no API call!
      setBaseCurrency(newBase);

      // Update URL without full page reload (for bookmarking/sharing)
      startTransition(() => {
        navigate(`${pathname}?exchange=${exchange}&base=${newBase}`, {
          replace: true,
        });
      });
    },
    [baseCurrency, exchange, pathname, navigate]
  );

  return (
    <div className="space-y-4">
      {/* Last Updated & Auto-Refresh Controls */}
      <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span>
            Last updated: {lastUpdatedString ?? 'Loading...'}
            {isPending && ' (updating URL...)'}
          </span>
          {/* Auto-refresh countdown indicator */}
          {!isPaused && (
            <Badge variant="outline" className="gap-1.5 font-mono text-xs">
              <Timer className="h-3 w-3" />
              {countdown}s
            </Badge>
          )}
          {isPaused && (
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <Pause className="h-3 w-3" />
              Paused
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Pause/Resume button */}
          <Button
            variant="outline"
            size="sm"
            onClick={isPaused ? resume : pause}
            className="gap-2"
            title={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Pause'}</span>
          </Button>

          {/* Manual refresh button */}
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Altcoin Grid - uses pre-calculated prices in base currency */}
      <AltcoinGrid
        altcoins={altcoinsInBaseCurrency}
        baseCurrency={baseCurrency}
        onBaseCurrencyChange={handleBaseCurrencyChange}
        basePrice={currentBasePrice}
        isLoading={isRefreshing}
      />
    </div>
  );
}
