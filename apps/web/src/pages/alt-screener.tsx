/**
 * Screener page — altcoin relative-strength scanner
 *
 * Replaces the server/client split. Uses useScreener hook with auto-refresh.
 * Keeps the existing AltcoinGrid component for the actual grid rendering
 * (it has rich view modes — grid / list / heatmap — that aren't worth rewriting
 * for marginal visual gain).
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, Target, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react';
import type { BaseCurrency, BaseCurrencyPrices } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { AltcoinGrid } from '@/components/altcoin-grid';
import { useScreener, useExchanges } from '@/lib/queries';
import { useScreenerFilters } from '@/lib/url-state';
import { cn } from '@/lib/utils';

const DEFAULT_BASE_PRICES: BaseCurrencyPrices = {
  USD: 1,
  BTC: 0,
  ETH: 0,
  SOL: 0,
};

export default function AltScreenerPage() {
  const [filters, setFilters] = useScreenerFilters();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: exchangesData } = useExchanges();
  // Hyperliquid is perp-only — exclude from screener (no spot altcoins to scan)
  const exchanges = (exchangesData?.data ?? []).filter((e) => e.id !== 'hyperliquid');

  // Always fetch USD; client converts to user's selected base using basePrices
  // lightweight flag is intentionally omitted — useScreener uses TanStack Query's
  // gcTime/staleTime for caching instead of the server-side lightweight mode.
  const screener = useScreener(filters.exchange, {
    base: 'USD',
    limit: 200,
    sortBy: 'performance',
    sortOrder: 'desc',
  });

  const screenerData = screener.data;
  const stats = screenerData?.stats;
  const basePrices = screenerData?.basePrices ?? DEFAULT_BASE_PRICES;

  // Compute altcoins in the user's selected base currency (client-side, instant)
  const altcoinsInBase = useMemo(() => {
    if (!screenerData) return [];
    const basePrice = basePrices[filters.base];
    if (filters.base === 'USD' || !basePrice || basePrice === 0) {
      return screenerData.altcoins;
    }
    return screenerData.altcoins.map((a) => ({
      ...a,
      priceInBase: a.price / basePrice,
    }));
  }, [screenerData, basePrices, filters.base]);

  const handleBaseChange = useCallback(
    (newBase: BaseCurrency) => {
      setFilters({ base: newBase as typeof filters.base });
    },
    [setFilters]
  );

  // Quick-patch URL when location.search changes externally (back/forward)
  void navigate;
  void location;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Zap}
        title="Screener"
        description="Altcoin relative-strength scan across an entire exchange. Switch base currency for instant BTC/ETH/SOL-denominated performance."
        freshnessMeta={screener.data ? null : null}
      />

      {/* Exchange + base selector */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentedControl
          value={filters.exchange}
          onChange={(v) => setFilters({ exchange: v as typeof filters.exchange })}
          options={exchanges.map((e) => ({ value: e.id, label: e.name }))}
          size="sm"
          aria-label="Exchange"
        />
        <SegmentedControl
          value={filters.base}
          onChange={(v) => handleBaseChange(v as BaseCurrency)}
          options={[
            { value: 'USD', label: 'USD' },
            { value: 'BTC', label: 'BTC' },
            { value: 'ETH', label: 'ETH' },
            { value: 'SOL', label: 'SOL' },
          ]}
          size="sm"
          aria-label="Base currency"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {screener.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : stats ? (
          <>
            <Panel>
              <div className="flex items-center justify-between mb-2">
                <Metric
                  label="Total Altcoins"
                  value={stats.totalAltcoins.toString()}
                  mono
                  size="md"
                />
                <Target className="h-4 w-4 text-muted-foreground" aria-hidden />
              </div>
              <p className="text-[11px] text-muted-foreground">{filters.exchange} pairs scanned</p>
            </Panel>
            <Panel>
              <div className="flex items-center justify-between mb-2">
                <Metric
                  label="Gainers"
                  value={<span className="text-up">{stats.gainers}</span>}
                  mono={false}
                  size="md"
                />
                <TrendingUp className="h-4 w-4 text-up" aria-hidden />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Top: <span className="font-mono">{stats.topGainer.split(/[-.]/)[0]}</span>
              </p>
            </Panel>
            <Panel>
              <div className="flex items-center justify-between mb-2">
                <Metric
                  label="Losers"
                  value={<span className="text-down">{stats.losers}</span>}
                  mono={false}
                  size="md"
                />
                <TrendingDown className="h-4 w-4 text-down" aria-hidden />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Top: <span className="font-mono">{stats.topLoser.split(/[-.]/)[0]}</span>
              </p>
            </Panel>
            <Panel>
              <div className="flex items-center justify-between mb-2">
                <Metric
                  label="Avg Change"
                  value={`${stats.avgChange >= 0 ? '+' : ''}${stats.avgChange.toFixed(2)}%`}
                  mono
                  size="md"
                />
                <BarChart3
                  className={cn('h-4 w-4', stats.avgChange >= 0 ? 'text-up' : 'text-down')}
                  aria-hidden
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Market trend (24h)</p>
            </Panel>
          </>
        ) : null}
      </div>

      {/* Grid */}
      {screener.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : screenerData ? (
        <AltcoinGrid
          altcoins={altcoinsInBase}
          baseCurrency={filters.base}
          onBaseCurrencyChange={handleBaseChange}
          basePrice={basePrices[filters.base] ?? 1}
          isLoading={screener.isFetching && !screener.isLoading}
        />
      ) : screener.error ? (
        <Panel className="border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">{screener.error.message}</p>
        </Panel>
      ) : null}
    </div>
  );
}
