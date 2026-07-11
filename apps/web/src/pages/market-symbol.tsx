import { Link, useParams } from 'react-router-dom';
import { BookOpen, Camera, ExternalLink, LineChart, RefreshCw } from 'lucide-react';
import type { SupportedExchange } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Metric } from '@/components/ui/metric';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PriceText, ChangeText } from '@/components/ui/price-text';
import { Tag } from '@/components/ui/tag';
import { LazuliAPI, formatVolume } from '@/lib/api-client';
import { useTicker } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function MarketSymbolPage() {
  const params = useParams();
  const exchange = normalizeExchange(params.exchange);
  const symbol = decodeURIComponent(params.symbol ?? '').toUpperCase();
  const ticker = useTicker(exchange, symbol);
  const data = ticker.data?.data;
  const marketType = data?.type ?? (symbol.endsWith('.P') ? 'perp' : 'spot');
  const snapshotUrl = LazuliAPI.getMarketSnapshotUrl(exchange, symbol, marketType);

  return (
    <div className="space-y-6">
      <PageHeader
        title={symbol || 'Market'}
        description={`${exchange.toUpperCase()} live market page for search, sharing, and deep links.`}
        freshnessMeta={ticker.data?.meta ?? null}
      />

      {ticker.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : ticker.isError || !data ? (
        <Panel>
          <EmptyState
            title="Ticker unavailable"
            description="The symbol could not be loaded from the selected exchange."
            action={
              <Button variant="outline" onClick={() => void ticker.refetch()}>
                <RefreshCw aria-hidden /> Retry
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-4">
            <Panel>
              <Metric label="Last price" value={<PriceText value={data.last} />} size="lg" />
              <div className="mt-2">
                <ChangeText value={data.percentage24h} />
              </div>
            </Panel>
            <Panel>
              <Metric
                label="24h volume"
                value={`$${formatVolume(data.quoteVolume24h ?? data.volume24h ?? 0)}`}
                mono
                size="lg"
              />
              <p className="mt-2 text-xs text-muted-foreground">Quote volume when available.</p>
            </Panel>
            <Panel>
              <Metric
                label="Bid / ask"
                value={`${formatNullable(data.bid)} / ${formatNullable(data.ask)}`}
                mono
                size="md"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Top of book from live ticker data.
              </p>
            </Panel>
            <Panel>
              <Metric
                label="Market type"
                value={
                  <Tag variant={marketType === 'perp' ? 'accent' : 'default'}>{marketType}</Tag>
                }
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {exchange.toUpperCase()} symbol namespace.
              </p>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Panel className="lg:col-span-7">
              <PanelHeader>
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-accent" aria-hidden />
                  <PanelTitle>Share Snapshot</PanelTitle>
                </div>
              </PanelHeader>
              <img
                src={snapshotUrl}
                alt={`${symbol} live Lazuli market snapshot`}
                width={1200}
                height={630}
                className="aspect-[1200/630] w-full rounded-md border border-border bg-surface-2 object-cover"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={snapshotUrl} target="_blank" rel="noreferrer">
                    Open image <ExternalLink aria-hidden />
                  </a>
                </Button>
                <Button asChild variant="accent" size="sm">
                  <Link
                    to={`/workspace?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&type=${marketType}`}
                  >
                    Workspace <LineChart aria-hidden />
                  </Link>
                </Button>
              </div>
            </Panel>

            <Panel className="lg:col-span-5">
              <PanelHeader>
                <PanelTitle>Deep Links</PanelTitle>
              </PanelHeader>
              <div className="space-y-3">
                <DeepLink
                  to={`/workspace?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&type=${marketType}`}
                  icon={LineChart}
                  label="Workspace"
                  description="Candles, overlays, liquidation radar, and CVD proxy."
                />
                <DeepLink
                  to={`/orderbook?exchange=${exchange}&symbol=${encodeURIComponent(symbol)}&type=${marketType}`}
                  icon={BookOpen}
                  label="Order Book"
                  description="Live depth, spread, and liquidity levels."
                />
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function DeepLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: typeof LineChart;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3 transition-colors',
        'hover:border-border-strong hover:bg-surface-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 text-accent" aria-hidden />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </Link>
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

function formatNullable(value: number | null): string {
  if (value === null) return 'n/a';
  return value >= 100
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : value.toFixed(4);
}
