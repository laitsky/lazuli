'use client';

/**
 * Alt Screener Client Component
 *
 * This client component handles the interactive functionality of the Alt Screener:
 * - Base currency switching with URL updates
 * - Client-side filtering and sorting
 * - View mode toggling (grid, list, heatmap)
 * - Real-time updates via re-fetching
 *
 * It wraps the AltcoinGrid component and manages state for user interactions.
 */

import { useState, useCallback, useTransition, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AltcoinGrid } from '@/components/altcoin-grid';
import { Button } from '@/components/ui/button';
import { LazuliAPI } from '@/lib/api-client';
import { AltScreenerResponse, BaseCurrency, SupportedExchange } from '@lazuli/shared';
import { RefreshCw } from 'lucide-react';

interface AltScreenerClientProps {
  /** Initial screener data from server */
  initialData: AltScreenerResponse;
  /** Current exchange */
  exchange: SupportedExchange;
  /** Initial base currency */
  initialBase: BaseCurrency;
}

export function AltScreenerClient({ initialData, exchange, initialBase }: AltScreenerClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Local state
  const [data, setData] = useState<AltScreenerResponse>(initialData);
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>(initialBase);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Use null initially to avoid hydration mismatch with Date
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Set initial timestamp on client mount to avoid hydration mismatch
  useEffect(() => {
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  /**
   * Handle base currency change
   * Updates URL and fetches new data with the selected base currency
   */
  const handleBaseCurrencyChange = useCallback(
    async (newBase: BaseCurrency) => {
      if (newBase === baseCurrency) return;

      setBaseCurrency(newBase);

      // Update URL without full page reload
      startTransition(() => {
        router.push(`${pathname}?exchange=${exchange}&base=${newBase}`, {
          scroll: false,
        });
      });

      // Fetch new data with the new base currency
      try {
        const response = await LazuliAPI.getAltScreener(exchange, {
          base: newBase,
          limit: 200,
          sortBy: 'performance',
          sortOrder: 'desc',
        });

        if (response.success && response.data) {
          setData(response.data);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (error) {
        console.error('Error fetching data with new base currency:', error);
      }
    },
    [baseCurrency, exchange, pathname, router]
  );

  /**
   * Refresh data manually
   */
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const response = await LazuliAPI.getAltScreener(exchange, {
        base: baseCurrency,
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
  }, [exchange, baseCurrency]);

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

      {/* Altcoin Grid */}
      <AltcoinGrid
        altcoins={data.altcoins}
        baseCurrency={baseCurrency}
        onBaseCurrencyChange={handleBaseCurrencyChange}
        basePrice={data.basePrice}
        isLoading={isRefreshing}
      />
    </div>
  );
}
