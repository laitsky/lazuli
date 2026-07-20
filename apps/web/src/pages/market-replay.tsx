import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Clock3,
  Database,
  History,
  RefreshCw,
  Share2,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MarketReplay, MarketReplaySeries } from '@lazuli/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag } from '@/components/ui/tag';
import { formatPrice } from '@/lib/format';
import { useMarketReplay } from '@/lib/queries';

export default function MarketReplayPage() {
  const { id = '' } = useParams();
  const [window, setWindow] = useState<MarketReplay['window']>('6h');
  const replay = useMarketReplay(id, window);
  const data = replay.data?.data ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={History}
        title={data?.title ?? 'Market Replay'}
        description="A deterministic why-it-moved timeline with synchronized evidence and explicit coverage gaps."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={window}
              onChange={setWindow}
              size="sm"
              aria-label="Replay window"
              options={[
                { value: '1h', label: '1H' },
                { value: '6h', label: '6H' },
                { value: '24h', label: '24H' },
              ]}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  .writeText(globalThis.location.href)
                  .then(() => toast.success('Replay URL copied'))
                  .catch(() => toast.error('Could not copy replay URL'));
              }}
            >
              <Share2 aria-hidden /> Share
            </Button>
          </div>
        }
      />

      {replay.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading market replay">
          <Skeleton className="h-36" />
          <Skeleton className="h-80" />
        </div>
      ) : replay.isError || !data ? (
        <Panel>
          <EmptyState
            icon={ShieldAlert}
            title="Replay unavailable"
            description="The immutable opportunity or its derived timeline could not be loaded."
            action={
              <Button variant="outline" onClick={() => void replay.refetch()}>
                <RefreshCw aria-hidden /> Retry replay
              </Button>
            }
          />
        </Panel>
      ) : (
        <ReplayContent replay={data} />
      )}
    </div>
  );
}

function ReplayContent({ replay }: { replay: MarketReplay }) {
  const workspaceHref =
    replay.exchange === 'cross'
      ? '/price-arbitrage'
      : `/workspace?exchange=${replay.exchange}&symbol=${encodeURIComponent(replay.symbol)}&type=${replay.marketType}&timeframe=1h&opportunity=${encodeURIComponent(replay.opportunityId)}`;
  return (
    <>
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Tag
                variant={
                  replay.direction === 'long'
                    ? 'up'
                    : replay.direction === 'short'
                      ? 'down'
                      : 'accent'
                }
              >
                {replay.direction}
              </Tag>
              <Tag>{replay.exchange}</Tag>
              <Tag>{replay.marketType}</Tag>
              <Tag>{replay.window} window</Tag>
            </div>
            <p className="font-display text-lg leading-relaxed text-foreground">
              {replay.narrative}
            </p>
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" aria-hidden /> Trigger centered at{' '}
              {new Date(replay.triggerAt).toLocaleString()}
            </p>
          </div>
          <Button asChild>
            <Link to={workspaceHref}>
              Inspect thesis <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </Panel>

      <Panel flush>
        <PanelHeader className="px-5 pt-5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-accent" aria-hidden />
            <PanelTitle>Synchronized evidence</PanelTitle>
          </div>
          <span className="text-xs text-muted-foreground">Trigger is centered in every series</span>
        </PanelHeader>
        <div className="grid gap-px border-t border-border bg-border lg:grid-cols-2">
          {replay.series.length > 0 ? (
            replay.series.map((series) => <ReplaySeriesPanel key={series.metric} series={series} />)
          ) : (
            <div className="bg-surface-1 p-5 lg:col-span-2">
              <EmptyState
                compact
                title="No synchronized series available"
                description="The narrative is retained, but source coverage was insufficient for a timeline."
              />
            </div>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelTitle>Uncertainty & missing data</PanelTitle>
          {replay.uncertainty.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {replay.uncertainty.map((item) => (
                <li key={item} className="flex gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No material coverage warning.</p>
          )}
        </Panel>
        <Panel>
          <PanelTitle>Provenance</PanelTitle>
          <div className="mt-3 space-y-2">
            {replay.provenance.map((source) => (
              <div key={source.source} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-foreground">{source.source}</span>
                <Tag
                  variant={
                    source.quality === 'stale' || source.quality === 'missing'
                      ? 'warning'
                      : 'default'
                  }
                >
                  {source.quality}
                </Tag>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

function ReplaySeriesPanel({ series }: { series: MarketReplaySeries }) {
  if (series.points.length === 0) {
    return (
      <article className="bg-surface-1 p-5">
        <h2 className="text-sm font-medium text-foreground">{series.label}</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          This source returned no points for the selected replay window.
        </p>
      </article>
    );
  }
  const values = series.points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const geometry = { minimum, maximum, span: Math.max(Number.EPSILON, maximum - minimum) };
  const latest = series.points.at(-1)?.value ?? null;
  return (
    <article className="bg-surface-1 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{series.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{series.source}</p>
        </div>
        <p className="font-mono text-sm text-foreground">
          {latest === null ? '—' : formatSeriesValue(latest, series.unit)}
        </p>
      </div>
      <div className="mt-5 flex h-24 items-end gap-1" aria-label={`${series.label} timeline`}>
        {series.points.map((point, index) => {
          const height = 12 + ((point.value - geometry.minimum) / geometry.span) * 76;
          return (
            <div
              key={`${point.timestamp}-${index}`}
              className="min-w-1 flex-1 rounded-t-sm bg-accent/70"
              style={{ height: `${series.points.length === 1 ? 50 : height}%` }}
              title={`${new Date(point.timestamp).toLocaleString()}: ${formatSeriesValue(point.value, series.unit)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{formatSeriesValue(geometry.minimum, series.unit)}</span>
        <span>{series.points.length} points</span>
        <span>{formatSeriesValue(geometry.maximum, series.unit)}</span>
      </div>
    </article>
  );
}

function formatSeriesValue(value: number, unit: MarketReplaySeries['unit']): string {
  if (unit === 'price') return `$${formatPrice(value)}`;
  if (unit === 'usd') {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (unit === 'percent') return `${value.toFixed(2)}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
