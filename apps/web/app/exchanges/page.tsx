/**
 * Exchanges Page - Terminal Luxe
 * List all supported cryptocurrency exchanges with clean cards and comparison table
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LazuliAPI } from '@/lib/api-client';
import { ExchangeLogo } from '@/components/exchange-logo';
import { PageHeader } from '@/components/page-header';
import type { ExchangeInfo } from '@lazuli/shared';
import { ArrowRight, Check, X, Activity, Globe } from 'lucide-react';

export default function ExchangesPage() {
  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success) {
        setExchanges(response.data);
      } else {
        setError(response.error);
      }
      setLoading(false);
    }
    fetchExchanges();
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={Globe}
        title="Exchanges"
        description="Connect to the world's leading cryptocurrency exchanges. Access real-time market data through a unified interface."
        badge={{ text: `${exchanges.length} Connected`, variant: 'success' }}
      />

      {/* Loading State */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6">
          <p className="text-destructive font-medium">Error loading exchanges</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </div>
      )}

      {/* Exchanges Grid */}
      {!loading && !error && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {exchanges.map((exchange, index) => (
              <Link
                key={exchange.id}
                href={`/markets?exchange=${exchange.id}`}
                className="group block"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="relative h-full bg-card rounded-xl border border-border p-5 card-terminal-hover overflow-hidden">
                  {/* Hover gradient */}
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                  <div className="relative space-y-4">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="relative h-12 w-12 rounded-lg bg-secondary flex items-center justify-center border border-border group-hover:border-primary/30 transition-colors">
                        <ExchangeLogo exchangeId={exchange.id} className="h-7 w-7" />
                        {/* Status indicator */}
                        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                          <span
                            className={`absolute inline-flex h-full w-full rounded-full ${
                              exchange.supported
                                ? 'bg-[hsl(152_60%_45%)] animate-ping'
                                : 'bg-muted-foreground'
                            } opacity-75`}
                          />
                          <span
                            className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                              exchange.supported ? 'bg-[hsl(152_60%_45%)]' : 'bg-muted-foreground'
                            }`}
                          />
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded ${
                          exchange.supported
                            ? 'text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)]'
                            : 'text-muted-foreground bg-secondary'
                        }`}
                      >
                        {exchange.supported ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {/* Info */}
                    <div>
                      <h2 className="text-lg font-display font-semibold text-foreground capitalize group-hover:text-primary transition-colors">
                        {exchange.name}
                      </h2>
                      <div className="flex gap-1.5 mt-2">
                        {exchange.hasSpot && (
                          <span className="text-[10px] font-mono text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)] px-1.5 py-0.5 rounded">
                            SPOT
                          </span>
                        )}
                        {exchange.hasPerp && (
                          <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            PERP
                          </span>
                        )}
                      </div>
                    </div>

                    {/* CTA */}
                    <div className="flex items-center text-xs text-muted-foreground group-hover:text-primary transition-colors">
                      <span>View Markets</span>
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Comparison Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-display font-semibold">Feature Comparison</h2>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Detailed breakdown of supported features per exchange
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Exchange
                    </th>
                    <th className="text-left p-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Spot Trading
                    </th>
                    <th className="text-left p-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Perpetual Futures
                    </th>
                    <th className="text-left p-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="text-right p-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exchanges.map((exchange) => (
                    <tr
                      key={exchange.id}
                      className="border-b border-border last:border-0 hover:bg-accent transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <ExchangeLogo exchangeId={exchange.id} className="h-5 w-5" />
                          <span className="font-medium text-foreground capitalize">
                            {exchange.name}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        {exchange.hasSpot ? (
                          <div className="flex items-center gap-1.5 text-[hsl(152_60%_50%)]">
                            <Check className="h-4 w-4" />
                            <span className="text-sm">Supported</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-muted-foreground/50">
                            <X className="h-4 w-4" />
                            <span className="text-sm">Not Available</span>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        {exchange.hasPerp ? (
                          <div className="flex items-center gap-1.5 text-[hsl(152_60%_50%)]">
                            <Check className="h-4 w-4" />
                            <span className="text-sm">Supported</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-muted-foreground/50">
                            <X className="h-4 w-4" />
                            <span className="text-sm">Not Available</span>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono ${
                            exchange.supported
                              ? 'text-[hsl(152_60%_50%)] bg-[hsl(152_60%_45%/0.1)]'
                              : 'text-muted-foreground bg-secondary'
                          }`}
                        >
                          {exchange.supported ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <Link
                          href={`/markets?exchange=${exchange.id}`}
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          Explore
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
