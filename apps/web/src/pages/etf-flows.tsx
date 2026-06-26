/**
 * ETF Flow Terminal
 *
 * Fund-level BTC/ETH spot ETF flow dashboard with streaks, anomaly days, and
 * cumulative demand leadership.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, Landmark, TrendingDown, TrendingUp } from 'lucide-react';
import type { EtfDailyFlow, EtfFund, InstitutionalAsset, InstitutionalRange } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelDescription, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { Button } from '@/components/ui/button';
import type { SortState } from '@/components/ui/data-table';
import { Tag } from '@/components/ui/tag';
import { Skeleton } from '@/components/ui/skeleton';
import { useEtfFlows } from '@/lib/queries';
import {
  AssetSwitch,
  ErrorPanel,
  FlowBars,
  ProviderBadge,
  RangeSwitch,
  formatUsd,
} from '@/components/institutional/institutional-widgets';

export default function EtfFlowsPage() {
  const [params, setParams] = useSearchParams();
  const asset = parseAsset(params.get('asset'));
  const range = parseRange(params.get('range'));
  const [fundSort, setFundSort] = useState<SortState>({ column: 'cumulative', direction: 'desc' });
  const [flowSort, setFlowSort] = useState<SortState>({ column: 'date', direction: 'desc' });
  const flows = useEtfFlows({ asset, range });
  const data = flows.data?.data;

  const setAsset = (next: InstitutionalAsset) => {
    setParams((current) => {
      current.set('asset', next);
      return current;
    });
  };
  const setRange = (next: InstitutionalRange) => {
    setParams((current) => {
      current.set('range', next);
      return current;
    });
  };

  const sortedFunds = useMemo(() => {
    const funds = data?.funds ?? [];
    const dir = fundSort.direction === 'asc' ? 1 : -1;
    return [...funds].sort((a, b) => {
      if (fundSort.column === 'ticker') return a.ticker.localeCompare(b.ticker) * dir;
      if (fundSort.column === 'latest')
        return ((a.latestFlowUsd ?? 0) - (b.latestFlowUsd ?? 0)) * dir;
      return (a.cumulativeFlowUsd - b.cumulativeFlowUsd) * dir;
    });
  }, [data, fundSort]);

  const sortedFlows = useMemo(() => {
    const rows = data?.flows ?? [];
    const dir = flowSort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (flowSort.column === 'flow') return (a.totalNetFlowUsd - b.totalNetFlowUsd) * dir;
      if (flowSort.column === 'cumulative') {
        return (a.cumulativeNetFlowUsd - b.cumulativeNetFlowUsd) * dir;
      }
      return a.date.localeCompare(b.date) * dir;
    });
  }, [data, flowSort]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Landmark}
        title="ETF Flow Terminal"
        description="Spot ETF demand by fund, streak, anomaly, and cumulative flow leadership."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AssetSwitch asset={asset} onChange={setAsset} />
            <RangeSwitch range={range} onChange={setRange} />
            <Button asChild variant="outline">
              <Link to={`/institutional?asset=${asset}`}>
                Radar
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        }
        freshnessMeta={flows.data?.meta ?? null}
      />

      {flows.isError && (
        <ErrorPanel
          title="Couldn't load ETF flows"
          message={flows.error.message}
          onRetry={() => flows.refetch()}
        />
      )}

      {flows.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Panel>
              <Metric label="Latest Flow" value={formatUsd(data.latest?.totalNetFlowUsd)} />
              <div className="mt-2 flex items-center gap-2">
                <ProviderBadge provider={data.provider} />
              </div>
            </Panel>
            <Panel>
              <Metric label="Range Net" value={formatUsd(data.totals.netFlowUsd)} />
              <p className="mt-2 text-xs text-muted-foreground">{range.toUpperCase()} aggregate</p>
            </Panel>
            <Panel>
              <Metric label="Cumulative" value={formatUsd(data.totals.cumulativeNetFlowUsd)} />
              <p className="mt-2 text-xs text-muted-foreground">Since parsed flow history start</p>
            </Panel>
            <Panel>
              <Metric label="Streak" value={`${data.streak.days}d`} />
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {data.streak.direction === 'inflow' ? (
                  <TrendingUp className="h-3.5 w-3.5 text-up" aria-hidden />
                ) : data.streak.direction === 'outflow' ? (
                  <TrendingDown className="h-3.5 w-3.5 text-down" aria-hidden />
                ) : (
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                )}
                {formatUsd(data.streak.totalUsd)}
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader>
              <div>
                <PanelTitle>Flow Tape</PanelTitle>
                <PanelDescription>
                  Positive bars indicate net creations; negative bars indicate redemptions.
                </PanelDescription>
              </div>
              <span className="numeric text-xs text-muted-foreground">
                {data.totals.positiveDays} up / {data.totals.negativeDays} down
              </span>
            </PanelHeader>
            {data.flows.length > 0 ? (
              <FlowBars flows={data.flows} height={220} />
            ) : (
              <EmptyBlock
                title="No flow rows"
                text="The provider returned no rows for this range."
              />
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Panel>
              <PanelHeader className="px-5 pt-5">
                <div>
                  <PanelTitle>Fund Leadership</PanelTitle>
                  <PanelDescription>Fund-level latest and cumulative flows</PanelDescription>
                </div>
              </PanelHeader>
              <FundLeadershipTable rows={sortedFunds} sort={fundSort} onSortChange={setFundSort} />
            </Panel>

            <Panel>
              <PanelHeader className="px-5 pt-5">
                <div>
                  <PanelTitle>Daily Flow History</PanelTitle>
                  <PanelDescription>Net flow, fund leader, and cumulative demand</PanelDescription>
                </div>
              </PanelHeader>
              <DailyFlowTable rows={sortedFlows} sort={flowSort} onSortChange={setFlowSort} />
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FundLeadershipTable({
  rows,
  sort,
  onSortChange,
}: {
  rows: EtfFund[];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
}) {
  if (rows.length === 0)
    return <EmptyBlock title="No funds" text="No ETF fund rows were returned." />;
  return (
    <div className="overflow-auto rounded-md border border-border" aria-label="ETF fund leadership">
      <table className="w-full min-w-[440px]">
        <thead className="bg-surface-1">
          <tr className="border-b border-border">
            <SortableHeader id="ticker" label="Fund" sort={sort} onSortChange={onSortChange} />
            <SortableHeader
              id="latest"
              label="Latest"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
            <SortableHeader
              id="cumulative"
              label="Cumulative"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((fund) => (
            <tr key={fund.ticker} className="border-b border-border last:border-0">
              <td className="px-3 py-3">
                <div className="font-mono text-sm font-semibold text-foreground">{fund.ticker}</div>
                <div className="text-xs text-muted-foreground">{fund.issuer}</div>
              </td>
              <td className="px-3 py-3 text-right">
                <FlowAmount value={fund.latestFlowUsd} />
              </td>
              <td className="px-3 py-3 text-right">
                <FlowAmount value={fund.cumulativeFlowUsd} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyFlowTable({
  rows,
  sort,
  onSortChange,
}: {
  rows: EtfDailyFlow[];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
}) {
  if (rows.length === 0) {
    return <EmptyBlock title="No daily flows" text="No daily flow rows were returned." />;
  }
  return (
    <div
      className="max-h-[520px] overflow-auto rounded-md border border-border"
      aria-label="ETF daily flow history"
    >
      <table className="w-full min-w-[560px]">
        <thead className="sticky top-0 z-10 bg-surface-1">
          <tr className="border-b border-border">
            <SortableHeader id="date" label="Date" sort={sort} onSortChange={onSortChange} />
            <SortableHeader
              id="flow"
              label="Net Flow"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Leader
            </th>
            <SortableHeader
              id="cumulative"
              label="Cumulative"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((flow) => (
            <tr key={flow.date} className="border-b border-border last:border-0">
              <td className="numeric px-3 py-3 text-sm text-foreground">{flow.date}</td>
              <td className="px-3 py-3 text-right">
                <FlowAmount value={flow.totalNetFlowUsd} />
              </td>
              <td className="px-3 py-3">
                <span className="font-mono text-sm text-foreground">
                  {flow.leaderTicker ?? '—'}
                </span>
                {flow.anomaly ? (
                  <Tag className="ml-2" variant="warning">
                    anomaly
                  </Tag>
                ) : null}
              </td>
              <td className="px-3 py-3 text-right">
                <FlowAmount value={flow.cumulativeNetFlowUsd} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  id,
  label,
  numeric = false,
  sort,
  onSortChange,
}: {
  id: string;
  label: string;
  numeric?: boolean;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
}) {
  const active = sort.column === id;
  const direction = active && sort.direction === 'desc' ? 'asc' : 'desc';
  return (
    <th className={`px-3 py-2 ${numeric ? 'text-right' : 'text-left'}`} scope="col">
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSortChange({ column: id, direction })}
        aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {label}
        <span aria-hidden>{active ? sort.direction : 'sort'}</span>
      </button>
    </th>
  );
}

function FlowAmount({ value }: { value: number | null | undefined }) {
  const direction =
    (value ?? 0) > 0 ? 'text-up' : (value ?? 0) < 0 ? 'text-down' : 'text-muted-foreground';
  return <span className={`numeric text-sm font-medium ${direction}`}>{formatUsd(value)}</span>;
}

function EmptyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-md border border-border bg-surface-1 p-6 text-center">
      <Landmark className="h-7 w-7 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function parseAsset(value: string | null): InstitutionalAsset {
  return value === 'ETH' ? 'ETH' : 'BTC';
}

function parseRange(value: string | null): InstitutionalRange {
  if (value === '90d' || value === 'ytd' || value === 'all') return value;
  return '30d';
}
