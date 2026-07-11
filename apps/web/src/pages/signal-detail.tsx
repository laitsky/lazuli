import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Radio } from 'lucide-react';
import type { AlphaFeedItem } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tag } from '@/components/ui/tag';
import { useAlphaFeedEvent } from '@/lib/queries';

export default function SignalDetailPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const event = useAlphaFeedEvent(id);
  const item = event.data?.data ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={item?.title ?? 'Signal'}
        description="Public Alpha Feed signal permalink."
        freshnessMeta={event.data?.meta ?? null}
      />

      {event.isLoading ? (
        <Skeleton className="h-72" />
      ) : event.isError ? (
        <Panel>
          <EmptyState
            title="Signal unavailable"
            description="This Alpha Feed event is not available."
            action={
              <Button variant="outline" onClick={() => void event.refetch()}>
                Retry
              </Button>
            }
          />
        </Panel>
      ) : !item ? (
        <Panel>
          <EmptyState
            title="Signal expired"
            description="This live signal is no longer in the current feed."
            action={
              <Button asChild variant="outline">
                <Link to="/alpha-feed">
                  <ArrowLeft aria-hidden /> Back to feed
                </Link>
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel>
          <PanelHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-accent" aria-hidden />
              <PanelTitle>Signal Details</PanelTitle>
            </div>
            <Tag variant={tagVariant(item.kind)}>{item.kind}</Tag>
          </PanelHeader>

          <div className="space-y-5">
            <div>
              <p className="font-display text-2xl font-semibold text-foreground">{item.title}</p>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{item.summary}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SignalMetric label="Score" value={item.score.toFixed(1)} />
              <SignalMetric
                label="Timestamp"
                value={new Date(item.timestamp).toLocaleTimeString()}
              />
              <SignalMetric label="Kind" value={item.kind} />
            </div>

            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="mb-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Payload
              </p>
              <pre className="max-h-80 overflow-auto text-xs text-muted-foreground">
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/alpha-feed">
                  <ArrowLeft aria-hidden /> Alpha Feed
                </Link>
              </Button>
              <Button asChild variant="accent">
                <Link to={item.href}>
                  Open source view <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

function SignalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function tagVariant(kind: AlphaFeedItem['kind']): 'default' | 'accent' | 'up' | 'warning' {
  if (kind === 'funding-arbitrage') return 'up';
  if (kind === 'price-arbitrage') return 'accent';
  if (kind === 'liquidation') return 'warning';
  return 'default';
}
