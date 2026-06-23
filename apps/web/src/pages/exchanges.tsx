/**
 * Exchanges page — capabilities matrix + status board
 *
 * Drops the marketing-style grid. Shows a tight comparison table + per-exchange
 * deep-link cards. Mobile: stacked cards. Desktop: matrix table.
 */

import { Link } from 'react-router-dom';
import { ArrowRight, Check, Globe, Minus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { Tag } from '@/components/ui/tag';
import { Skeleton } from '@/components/ui/skeleton';
import { ExchangeLogo } from '@/components/exchange-logo';
import { useExchanges, useHealth } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function ExchangesPage() {
  const { data: exchangesData, isLoading, error } = useExchanges();
  const { data: health } = useHealth();
  const exchanges = exchangesData?.data ?? [];

  const activeCount = exchanges.filter((e) => e.supported).length;
  const spotCount = exchanges.filter((e) => e.hasSpot).length;
  const perpCount = exchanges.filter((e) => e.hasPerp).length;
  const healthyCount = health?.exchanges?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Globe}
        title="Exchanges"
        description="Connected venues and their data capabilities. Most users pick an exchange on Markets and never need this page."
        freshnessMeta={null}
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel>
          <Metric label="Active" value={activeCount.toString()} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Supported venues</p>
        </Panel>
        <Panel>
          <Metric label="Healthy" value={healthyCount.toString()} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Responding to pings</p>
        </Panel>
        <Panel>
          <Metric label="Spot Markets" value={spotCount.toString()} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Venues with spot</p>
        </Panel>
        <Panel>
          <Metric label="Perp Markets" value={perpCount.toString()} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Venues with perps</p>
        </Panel>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          : exchanges.map((ex) => (
              <Link
                key={ex.id}
                to={`/markets?exchange=${ex.id}`}
                className="block rounded-md border border-border bg-surface-1 p-4 active:bg-surface-2 no-tap-highlight transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10 rounded-md bg-surface-2 border border-border flex items-center justify-center">
                    <ExchangeLogo exchangeId={ex.id} className="h-6 w-6" />
                    {ex.supported && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-success border border-surface-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold text-foreground truncate">
                      {ex.name}
                    </div>
                    <div className="text-[11px] font-mono uppercase text-muted-foreground">
                      {ex.id}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </div>
                <div className="mt-3 flex gap-1.5">
                  {ex.hasSpot && <Tag variant="up">SPOT</Tag>}
                  {ex.hasPerp && <Tag variant="accent">PERP</Tag>}
                  {!ex.supported && <Tag variant="down">DISABLED</Tag>}
                </div>
              </Link>
            ))}
      </div>

      {/* Desktop: matrix table */}
      <Panel flush className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Exchange</th>
                <th>Status</th>
                <th>Spot</th>
                <th>Perp</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5}>
                        <Skeleton className="h-10 m-2" />
                      </td>
                    </tr>
                  ))
                : exchanges.map((ex) => {
                    const isHealthy = health?.exchanges?.some((e) => e === ex.id) ?? false;
                    return (
                      <tr
                        key={ex.id}
                        className="border-b border-border last:border-0 hover:bg-surface-2/50 transition-colors"
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-surface-2 border border-border flex items-center justify-center">
                              <ExchangeLogo exchangeId={ex.id} className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="font-display font-semibold text-foreground">
                                {ex.name}
                              </div>
                              <div className="text-[10px] font-mono uppercase text-muted-foreground">
                                {ex.id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {ex.supported ? (
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  isHealthy ? 'bg-success animate-blink-soft' : 'bg-warning'
                                )}
                              />
                              <span className={isHealthy ? 'text-up' : 'text-warning'}>
                                {isHealthy ? 'Online' : 'Degraded'}
                              </span>
                            </span>
                          ) : (
                            <Tag variant="down">Disabled</Tag>
                          )}
                        </td>
                        <td>
                          {ex.hasSpot ? (
                            <span className="inline-flex items-center gap-1 text-up">
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              <span className="text-xs">Yes</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground/60">
                              <Minus className="h-3.5 w-3.5" aria-hidden />
                              <span className="text-xs">No</span>
                            </span>
                          )}
                        </td>
                        <td>
                          {ex.hasPerp ? (
                            <span className="inline-flex items-center gap-1 text-up">
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              <span className="text-xs">Yes</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground/60">
                              <Minus className="h-3.5 w-3.5" aria-hidden />
                              <span className="text-xs">No</span>
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <Link
                            to={`/markets?exchange=${ex.id}`}
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline no-tap-highlight"
                          >
                            View markets
                            <ArrowRight className="h-3 w-3" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </Panel>

      {error && (
        <Panel className="border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">{error.message}</p>
        </Panel>
      )}
    </div>
  );
}
