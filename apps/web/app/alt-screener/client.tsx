'use client';

/**
 * Alt Screener Client Component
 *
 * This client component handles the interactive functionality of the Alt Screener:
 * - Base currency switching (instant, no API refetch!)
 * - Client-side filtering and sorting
 * - View mode toggling (grid, list, heatmap)
 * - Real-time updates via re-fetching
 *
 * Performance optimization: Base currency switching is done client-side by
 * dividing USD prices by the base currency price. This avoids slow API calls
 * when users switch between USD/BTC/ETH/SOL comparisons.
 */

import { useState, useCallback, useTransition, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AltcoinGrid } from '@/components/altcoin-grid';
import { Button } from '@/components/ui/button';
import { LazuliAPI } from '@/lib/api-client';
import {
  AltScreenerResponse,
  AltcoinPerformance,
  BaseCurrency,
  BaseCurrencyPrices,
  SupportedExchange,
} from '@lazuli/shared';
import { RefreshCw } from 'lucide-react';

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

export function AltScreenerClient({ initialData, exchange, initialBase }: AltScreenerClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Local state - store raw USD data and base currency prices
  const [data, setData] = useState<AltScreenerResponse>(initialData);
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>(initialBase);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Use null initially to avoid hydration mismatch with Date
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Get base currency prices (from API response or default)
  const basePrices = useMemo(() => data.basePrices ?? DEFAULT_BASE_PRICES, [data.basePrices]);

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
      return data.altcoins;
    }

    // Recalculate priceInBase for each altcoin
    return data.altcoins.map((altcoin) => ({
      ...altcoin,
      priceInBase: altcoin.price / basePrice,
    }));
  }, [data.altcoins, baseCurrency, basePrices]);

  // Set initial timestamp on client mount to avoid hydration mismatch
  useEffect(() => {
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

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
        router.push(`${pathname}?exchange=${exchange}&base=${newBase}`, {
          scroll: false,
        });
      });
    },
    [baseCurrency, exchange, pathname, router]
  );

  /**
   * Refresh data manually - fetches fresh data from API
   */
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const response = await LazuliAPI.getAltScreener(exchange, {
        base: 'USD', // Always fetch USD data, client handles conversion
        limit: 200,
        sortBy: 'performance',
        sortOrder: 'desc',
      });

      if (response.success && response.data) {
        setData(response.data);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [exchange]);

  return (
    <div className="space-y-4">
      {/* Last Updated & Refresh */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Last updated: {lastUpdated ?? 'Loading...'}
          {isPending && ' (updating URL...)'}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
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
