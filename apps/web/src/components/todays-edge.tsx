import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Beaker,
  BellRing,
  History,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { Opportunity, OpportunityHorizon } from '@lazuli/shared';
import { useOpportunities } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';

export function TodaysEdge() {
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('perp');
  const [horizon, setHorizon] = useState<OpportunityHorizon>('6h');
  const opportunities = useOpportunities({
    exchange: 'bybit',
    marketType,
    horizon,
    limit: 8,
  });
  const items = opportunities.data?.data.items ?? [];
  const sourceHealth = opportunities.data?.data.sourceHealth;
  const sourceWarnings = sourceHealth?.sources.filter((source) => source.status !== 'live') ?? [];

  return (
    <section aria-labelledby="todays-edge-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-accent">
            <Sparkles className="h-4 w-4" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
              Explainable conviction engine
            </span>
          </div>
          <h1
            id="todays-edge-heading"
            className="font-display text-2xl font-semibold text-foreground"
          >
            Today&apos;s Edge
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Ranked setups with displayed evidence, costs, invalidation, freshness, and honest
            historical confidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl
            value={marketType}
            onChange={setMarketType}
            size="sm"
            aria-label="Opportunity market type"
            options={[
              { value: 'spot', label: 'Spot' },
              { value: 'perp', label: 'Perp' },
            ]}
          />
          <SegmentedControl
            value={horizon}
            onChange={setHorizon}
            size="sm"
            aria-label="Opportunity horizon"
            options={[
              { value: '1h', label: '1H' },
              { value: '6h', label: '6H' },
              { value: '24h', label: '24H' },
            ]}
          />
        </div>
      </div>

      {!opportunities.isLoading && !opportunities.isError && sourceHealth?.status === 'stale' && (
        <Panel className="border-warning/40 bg-warning/5" role="status">
          <p className="text-sm font-medium text-foreground">Some evidence is degraded</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sourceWarnings
              .map((source) => source.message)
              .filter(Boolean)
              .join(' · ')}
            {' — '}
            Rankings remain deterministic, but missing sources reduce confidence.
          </p>
        </Panel>
      )}

      {opportunities.isLoading ? (
        <div
          className="grid gap-3 lg:grid-cols-2"
          aria-busy="true"
          aria-label="Loading opportunities"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-72" />
          ))}
        </div>
      ) : opportunities.isError ? (
        <Panel>
          <EmptyState
            icon={ShieldAlert}
            title="Today’s Edge is temporarily unavailable"
            description="The market pulse below remains live. Retry the conviction scan when upstream feeds recover."
            action={
              <Button variant="outline" onClick={() => void opportunities.refetch()}>
                <RefreshCw aria-hidden /> Retry scan
              </Button>
            }
          />
        </Panel>
      ) : sourceHealth?.status === 'unavailable' ? (
        <Panel>
          <EmptyState
            icon={ShieldAlert}
            title="Live opportunity evidence is unavailable"
            description={
              sourceWarnings
                .map((source) => source.message)
                .filter(Boolean)
                .join(' · ') ||
              'The selected exchange feed did not return enough observations to rank setups.'
            }
            action={
              <Button variant="outline" onClick={() => void opportunities.refetch()}>
                <RefreshCw aria-hidden /> Retry scan
              </Button>
            }
          />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Beaker}
            title="No setup clears the evidence threshold"
            description="That is a valid result—not a blank feed. Try another horizon or market type."
            compact
          />
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((opportunity, index) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} rank={index + 1} />
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Beaker className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Scores rank current evidence; they are not probabilities. Probability stays hidden until 100
        comparable out-of-sample outcomes have resolved after recorded costs.
      </p>
    </section>
  );
}

export function OpportunityCard({
  opportunity,
  rank,
  compact = false,
}: {
  opportunity: Opportunity;
  rank?: number;
  compact?: boolean;
}) {
  const calibrated = opportunity.calibration.status === 'calibrated';
  const supporting = opportunity.evidence
    .filter((item) => evidenceSupports(item.contribution, opportunity.direction))
    .slice(0, compact ? 2 : 3);
  const opposing = opportunity.evidence
    .filter((item) => evidenceOpposes(item.contribution, opportunity.direction))
    .slice(0, 2);
  const monitorExchange = opportunity.exchange === 'cross' ? 'all' : opportunity.exchange;
  const monitorHref = `/account?recipeSymbol=${encodeURIComponent(opportunity.symbol)}&recipeExchange=${encodeURIComponent(monitorExchange)}&recipeMarketType=${opportunity.marketType}&recipeHorizon=${opportunity.horizon}`;

  return (
    <Panel className="relative overflow-hidden" aria-label={`${opportunity.title} opportunity`}>
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-0.5',
          opportunity.direction === 'long'
            ? 'bg-success'
            : opportunity.direction === 'short'
              ? 'bg-destructive'
              : 'bg-accent'
        )}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {rank && <span className="font-mono text-xs text-muted-foreground">#{rank}</span>}
            <Tag
              variant={
                opportunity.direction === 'long'
                  ? 'up'
                  : opportunity.direction === 'short'
                    ? 'down'
                    : 'accent'
              }
            >
              {opportunity.direction}
            </Tag>
            <Tag>{opportunity.marketType}</Tag>
            <Tag>{opportunity.horizon}</Tag>
            <Badge variant={calibrated ? 'fresh' : 'secondary'}>
              {calibrated
                ? `${Math.round((opportunity.calibration.probability ?? 0) * 100)}% calibrated`
                : 'experimental'}
            </Badge>
          </div>
          <h2 className="truncate font-display text-lg font-semibold text-foreground">
            {opportunity.title}
          </h2>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{opportunity.thesis}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-3xl font-semibold text-accent">{opportunity.score}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">score</div>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <EvidenceList title="Supports" evidence={supporting} tone="support" />
          <EvidenceList title="Pushback" evidence={opposing} tone="oppose" />
        </div>
      )}

      <div className="mt-4 grid gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs sm:grid-cols-2">
        <div>
          <p className="font-medium text-foreground">Trigger</p>
          <p className="mt-0.5 text-muted-foreground">{opportunity.trigger.description}</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Invalidation</p>
          <p className="mt-0.5 text-muted-foreground">{opportunity.invalidation.description}</p>
        </div>
        <div className="text-muted-foreground">
          Estimated costs{' '}
          <span className="font-mono text-foreground">
            {opportunity.estimatedCosts.totalBps.toFixed(1)} bps
          </span>
        </div>
        <div className="text-muted-foreground sm:text-right">
          Sample{' '}
          <span className="font-mono text-foreground">{opportunity.calibration.sampleSize}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={opportunity.workspaceHref}>
            Open workspace <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={monitorHref}>
            <BellRing aria-hidden /> Monitor
          </Link>
        </Button>
        {opportunity.replayId && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/replays/${encodeURIComponent(opportunity.replayId)}`}>
              <History aria-hidden /> Replay
            </Link>
          </Button>
        )}
      </div>
    </Panel>
  );
}

function EvidenceList({
  title,
  evidence,
  tone,
}: {
  title: string;
  evidence: Opportunity['evidence'];
  tone: 'support' | 'oppose';
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {evidence.length > 0 ? (
        <ul className="space-y-1.5">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  tone === 'support' ? 'bg-success' : 'bg-warning'
                )}
                aria-hidden
              />
              <span>
                {item.summary}{' '}
                <span className={cn(item.freshness === 'stale' && 'text-warning')}>
                  ({item.freshness})
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {tone === 'oppose'
            ? 'No opposing metric in the current snapshot.'
            : 'Evidence is partial.'}
        </p>
      )}
    </div>
  );
}

function evidenceSupports(
  contribution: Opportunity['evidence'][number]['contribution'],
  direction: Opportunity['direction']
): boolean {
  if (direction === 'long') return contribution === 'bullish';
  if (direction === 'short') return contribution === 'bearish';
  return contribution === 'neutral';
}

function evidenceOpposes(
  contribution: Opportunity['evidence'][number]['contribution'],
  direction: Opportunity['direction']
): boolean {
  if (direction === 'long') return contribution === 'bearish';
  if (direction === 'short') return contribution === 'bullish';
  return false;
}
