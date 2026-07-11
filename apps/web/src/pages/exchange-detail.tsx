import { Link, useParams } from 'react-router-dom';
import { ArrowRight, DatabaseZap, RefreshCw } from 'lucide-react';
import type { SupportedExchange } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Metric } from '@/components/ui/metric';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tag } from '@/components/ui/tag';
import { useAllTickers, useExchanges } from '@/lib/queries';
import { formatVolume } from '@/lib/api-client';

export default function ExchangeDetailPage() {
  const exchange = normalizeExchange(useParams().exchange);
  const exchanges = useExchanges();
  const tickers = useAllTickers(exchange, { sortBy: 'volume', sortOrder: 'desc' });
  const info = exchanges.data?.data.find((item) => item.id === exchange);
  const allTickers = tickers.data?.pages.flatMap((page) => page.data.tickers) ?? [];
  const volume = allTickers.reduce((sum, ticker) => sum + (ticker.quoteVolume24h ?? 0), 0);
  const top = allTickers.slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title={info?.name ?? exchange.toUpperCase()}
        description="Exchange capability and live-market SEO hub."
        freshnessMeta={tickers.data?.pages[0]?.meta ?? null}
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel>
          <Metric
            label="Status"
            value={info?.supported ? 'supported' : 'limited'}
            mono={false}
            size="md"
          />
          {info?.notes && <p className="mt-2 text-xs text-muted-foreground">{info.notes}</p>}
        </Panel>
        <Panel>
          <Metric label="Markets" value={allTickers.length.toString()} size="lg" />
          <p className="mt-2 text-xs text-muted-foreground">Loaded from live ticker pages.</p>
        </Panel>
        <Panel>
          <Metric label="24h volume" value={`$${formatVolume(volume)}`} size="lg" />
          <p className="mt-2 text-xs text-muted-foreground">Aggregate quote volume.</p>
        </Panel>
        <Panel>
          <Metric
            label="Capabilities"
            value={
              <span className="flex gap-1">
                {info?.hasSpot && <Tag>spot</Tag>}
                {info?.hasPerp && <Tag variant="accent">perp</Tag>}
              </span>
            }
            mono={false}
          />
        </Panel>
      </div>

      <Panel>
        <PanelHeader>
          <div className="flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-accent" aria-hidden />
            <PanelTitle>Top Markets</PanelTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void tickers.refetch()}
            disabled={tickers.isFetching}
            aria-busy={tickers.isFetching}
          >
            <RefreshCw className={tickers.isFetching ? 'animate-spin' : ''} aria-hidden />
            Refresh
          </Button>
        </PanelHeader>

        {tickers.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
        ) : tickers.isError ? (
          <EmptyState
            title="Markets unavailable"
            description="The exchange did not return ticker data. Retry from the live cache."
            action={
              <Button variant="outline" onClick={() => void tickers.refetch()}>
                Retry
              </Button>
            }
          />
        ) : top.length === 0 ? (
          <EmptyState
            title="No markets loaded"
            description="No active tickers were returned."
            compact
          />
        ) : (
          <div className="divide-y divide-border">
            {top.map((ticker) => (
              <Link
                key={`${ticker.exchange}:${ticker.symbol}`}
                to={`/markets/${exchange}/${encodeURIComponent(ticker.symbol)}`}
                className="flex min-h-14 items-center justify-between gap-3 py-3 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm text-foreground">{ticker.symbol}</span>
                  <span className="text-xs text-muted-foreground">
                    ${formatVolume(ticker.quoteVolume24h ?? ticker.volume24h ?? 0)} volume
                  </span>
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Tag variant={ticker.type === 'perp' ? 'accent' : 'default'}>{ticker.type}</Tag>
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function normalizeExchange(value: string | undefined): SupportedExchange {
  if (
    value === 'binance' ||
    value === 'bybit' ||
    value === 'okx' ||
    value === 'hyperliquid' ||
    value === 'upbit'
  ) {
    return value;
  }
  return 'bybit';
}
