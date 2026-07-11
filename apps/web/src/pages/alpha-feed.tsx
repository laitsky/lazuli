import { Link } from 'react-router-dom';
import { ArrowRight, Radio, RefreshCw, Share2 } from 'lucide-react';
import type { AlphaFeedItem } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tag } from '@/components/ui/tag';
import { useAlphaFeed } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function AlphaFeedPage() {
  const feed = useAlphaFeed({ exchange: 'bybit', limit: 24 });
  const items = feed.data?.data.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alpha Feed"
        description="Public live signals ranked by movement, spreads, and funding carry."
        freshnessMeta={feed.data?.meta ?? null}
      />

      <Panel>
        <PanelHeader>
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-accent" aria-hidden />
            <PanelTitle>Live Feed</PanelTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void feed.refetch()}
            disabled={feed.isFetching}
            aria-busy={feed.isFetching}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', feed.isFetching && 'animate-spin')}
              aria-hidden
            />
            Refresh
          </Button>
        </PanelHeader>

        {feed.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        ) : feed.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Could not load Alpha Feed</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Live signal aggregation failed. Retry in a moment.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => void feed.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No live signals"
            description="The feed is quiet for this exchange."
            compact
          />
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <AlphaFeedRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function AlphaFeedRow({ item }: { item: AlphaFeedItem }) {
  const signalPath = `/signals/${encodeURIComponent(item.id)}`;
  return (
    <article className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tag variant={tagVariant(item.kind)}>{item.kind}</Tag>
          <span className="font-mono text-xs text-muted-foreground">
            score {item.score.toFixed(1)}
          </span>
        </div>
        <div>
          <Link
            to={signalPath}
            className="font-display text-base font-semibold text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {item.title}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={signalPath}>
            <Share2 aria-hidden /> Signal
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={item.href}>
            Open <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function tagVariant(kind: AlphaFeedItem['kind']): 'default' | 'accent' | 'up' | 'warning' {
  if (kind === 'funding-arbitrage') return 'up';
  if (kind === 'price-arbitrage') return 'accent';
  if (kind === 'liquidation') return 'warning';
  return 'default';
}
