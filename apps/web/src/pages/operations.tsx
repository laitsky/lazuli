import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BellRing,
  BriefcaseBusiness,
  Database,
  RefreshCw,
  Rocket,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeaderSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type RecordValue = Record<string, unknown>;

interface SliRow extends RecordValue {
  bucket_start: number;
  sli: string;
  dimension_key: string;
  value: number | null;
  completeness: number;
  source: string;
}

interface Incident extends RecordValue {
  id: string;
  state: 'open' | 'acknowledged' | 'resolved';
  severity: 'page' | 'ticket';
  summary: string;
  observed_value: number | null;
  threshold_value: number | null;
  last_observed_at: number;
  runbook_url: string;
}

interface OperationsData {
  generatedAt: number;
  dashboards: {
    realtime: { slis: SliRow[]; checkpoints: RecordValue[] };
    alerts: { slis: SliRow[]; attempts: RecordValue[]; incidents: Incident[] };
    storageJobs: { slis: SliRow[]; jobs: RecordValue[] };
    product: { metrics: RecordValue[]; slis: SliRow[] };
    release: {
      controls: RecordValue[];
      audit: RecordValue[];
      probes: RecordValue[];
      incidents: Incident[];
    };
  };
}

const TAB_NAMES = ['realtime', 'alerts', 'storage', 'product', 'release'] as const;
type TabName = (typeof TAB_NAMES)[number];

const tabMetadata: Array<{
  id: TabName;
  label: string;
  icon: typeof Activity;
}> = [
  { id: 'realtime', label: 'Realtime', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: BellRing },
  { id: 'storage', label: 'Storage & jobs', icon: Database },
  { id: 'product', label: 'Product', icon: BriefcaseBusiness },
  { id: 'release', label: 'Release', icon: Rocket },
];

export default function OperationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: TabName = TAB_NAMES.includes(requestedTab as TabName)
    ? (requestedTab as TabName)
    : 'realtime';
  const [data, setData] = useState<OperationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const response = await fetch('/ops/api/dashboard?minutes=90', {
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok) throw new Error(`Operational API returned HTTP ${response.status}`);
      setData((await response.json()) as OperationsData);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Operational data is unavailable');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);

  if (!data && !error) return <OperationsLoading />;
  if (!data && error) return <OperationsError message={error} retry={() => void load()} />;

  const openIncidents = data?.dashboards.release.incidents.filter(
    (incident) => incident.state !== 'resolved'
  ).length;

  return (
    <section aria-labelledby="operations-title" className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="info">Access protected</Badge>
            <span className="font-mono text-xs text-muted-foreground">90-minute window</span>
          </div>
          <div>
            <h1
              id="operations-title"
              className="font-display text-2xl font-semibold text-foreground"
            >
              Operations control plane
            </h1>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Live SLOs, provider state, delivery health, jobs, product completeness, and rollout
              evidence.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-xs text-muted-foreground">Last updated</p>
            <p className="font-mono text-sm text-foreground">
              {data ? formatTimestamp(data.generatedAt / 1_000) : 'Unavailable'}
            </p>
          </div>
          <Button
            variant="outline"
            size="lg"
            disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      {error ? (
        <div
          className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-warning"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">
              Refresh failed; showing the last verified snapshot.
            </p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric
          label="Active incidents"
          value={String(openIncidents ?? 0)}
          state={openIncidents ? 'bad' : 'good'}
        />
        <SummaryMetric
          label="Realtime checkpoints"
          value={String(data?.dashboards.realtime.checkpoints.length ?? 0)}
        />
        <SummaryMetric
          label="Synthetic probes"
          value={String(data?.dashboards.release.probes.length ?? 0)}
        />
      </div>

      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}>
        <TabsList aria-label="Operational dashboards" className="h-11 w-full justify-start">
          {tabMetadata.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="h-10">
              <Icon aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="realtime">
          <DashboardSection
            title="Realtime overview"
            description="Provider continuity, freshness, reconciliation, and broker ingress state."
            slis={data?.dashboards.realtime.slis ?? []}
          >
            <RecordTable
              title="Provider checkpoints"
              rows={data?.dashboards.realtime.checkpoints ?? []}
              columns={['provider', 'exchange', 'stream', 'symbol', 'status', 'updated_at']}
            />
          </DashboardSection>
        </TabsContent>

        <TabsContent value="alerts">
          <DashboardSection
            title="Alert delivery"
            description="Evaluation, dispatch, idempotency, retries, and DLQ state."
            slis={data?.dashboards.alerts.slis ?? []}
          >
            <IncidentList incidents={data?.dashboards.alerts.incidents ?? []} />
            <RecordTable
              title="Delivery attempts"
              rows={data?.dashboards.alerts.attempts ?? []}
              columns={['status', 'provider', 'count', 'oldest']}
            />
          </DashboardSection>
        </TabsContent>

        <TabsContent value="storage">
          <DashboardSection
            title="Storage and jobs"
            description="D1, R2, Queue, archive, backfill, and asynchronous backtest state."
            slis={data?.dashboards.storageJobs.slis ?? []}
          >
            <RecordTable
              title="Job state"
              rows={data?.dashboards.storageJobs.jobs ?? []}
              columns={['kind', 'status', 'count']}
            />
          </DashboardSection>
        </TabsContent>

        <TabsContent value="product">
          <DashboardSection
            title="Product completeness"
            description="Adoption signals and daily aggregation completeness."
            slis={data?.dashboards.product.slis ?? []}
          >
            <RecordTable
              title="Daily metrics"
              rows={data?.dashboards.product.metrics ?? []}
              columns={['metric_date', 'metric', 'value', 'completeness']}
            />
          </DashboardSection>
        </TabsContent>

        <TabsContent value="release">
          <DashboardSection
            title="Release state"
            description="Feature cohorts, synthetic checks, incidents, and immutable rollout history."
            slis={[]}
          >
            <IncidentList incidents={data?.dashboards.release.incidents ?? []} />
            <RecordTable
              title="Release controls"
              rows={data?.dashboards.release.controls ?? []}
              columns={['flag', 'state', 'revision', 'updatedBy', 'updatedAt']}
            />
            <RecordTable
              title="Synthetic probes"
              rows={data?.dashboards.release.probes ?? []}
              columns={['probe', 'success', 'status_code', 'latency_ms', 'observed_at']}
            />
          </DashboardSection>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function DashboardSection({
  title,
  description,
  slis,
  children,
}: {
  title: string;
  description: string;
  slis: SliRow[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {slis.length > 0 ? <SliGrid rows={slis} /> : null}
      {children}
    </div>
  );
}

function SliGrid({ rows }: { rows: SliRow[] }) {
  const latest = useMemo(() => {
    const values = new Map<string, SliRow>();
    for (const row of rows) {
      const key = `${row.sli}:${row.dimension_key}`;
      if (!values.has(key) || (values.get(key)?.bucket_start ?? 0) < row.bucket_start) {
        values.set(key, row);
      }
    }
    return [...values.values()];
  }, [rows]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {latest.map((row) => (
        <SummaryMetric
          key={`${row.sli}:${row.dimension_key}`}
          label={humanize(row.sli)}
          value={formatSli(row)}
          state={sliState(row)}
          detail={row.dimension_key || row.source}
        />
      ))}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  state = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  state?: 'good' | 'bad' | 'warning' | 'neutral';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-foreground">{value}</p>
            {detail ? (
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{detail}</p>
            ) : null}
          </div>
          <span
            className={cn(
              'mt-1 size-2.5 shrink-0 rounded-full',
              state === 'good' && 'bg-success',
              state === 'bad' && 'bg-destructive',
              state === 'warning' && 'bg-warning',
              state === 'neutral' && 'bg-muted-foreground'
            )}
            aria-label={`State: ${state}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function IncidentList({ incidents }: { incidents: Incident[] }) {
  const active = incidents.filter((incident) => incident.state !== 'resolved');
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base">Active incidents</CardTitle>
          <Badge variant={active.length > 0 ? 'destructive' : 'success'}>{active.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-0 p-5 text-center">
            <p className="text-sm font-medium">No active incidents</p>
            <p className="mt-1 text-xs text-muted-foreground">
              All evaluated SLOs are within their current thresholds.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {active.map((incident) => (
              <li
                key={incident.id}
                className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={incident.severity === 'page' ? 'destructive' : 'stale'}>
                      {incident.severity}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatTimestamp(incident.last_observed_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground">{incident.summary}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    Observed {formatValue(incident.observed_value)} · threshold{' '}
                    {formatValue(incident.threshold_value)}
                  </p>
                </div>
                <Button asChild variant="outline" size="lg">
                  <a href={incident.runbook_url} target="_blank" rel="noreferrer">
                    Open runbook
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecordTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: RecordValue[];
  columns: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-0 p-5 text-center">
            <p className="text-sm font-medium">No records in this window</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The next scheduled collection will populate this panel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead className="bg-surface-2">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {humanize(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, index) => (
                  <tr
                    key={String(row.id ?? `${title}-${index}`)}
                    className="border-b border-border last:border-0"
                  >
                    {columns.map((column) => (
                      <td
                        key={column}
                        className="max-w-64 truncate px-3 py-2.5 font-mono text-xs text-foreground"
                        title={formatValue(row[column])}
                      >
                        {formatCell(column, row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OperationsLoading() {
  return (
    <div className="space-y-6" aria-label="Loading operational dashboards">
      <PageHeaderSkeleton />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-lg border border-border bg-surface-1"
          />
        ))}
      </div>
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}

function OperationsError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-lg rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-left">
        <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
        <h1 className="mt-4 font-display text-xl font-semibold">Operational data unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message}. Verify Access and the read-only service binding, then retry.
        </p>
        <Button className="mt-5" size="lg" onClick={retry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function sliState(row: SliRow): 'good' | 'bad' | 'warning' | 'neutral' {
  if (row.value === null || row.completeness < 0.98) return 'warning';
  if (row.sli.includes('availability') || row.sli.includes('completeness'))
    return row.value >= (row.sli.includes('completeness') ? 0.98 : 0.999) ? 'good' : 'bad';
  const maximum = row.sli.includes('liquidation')
    ? 800
    : row.sli.includes('evaluation')
      ? 2_000
      : row.sli.includes('dispatch')
        ? 10_000
        : row.sli.includes('dlq')
          ? 900
          : row.sli.includes('duplicate')
            ? 0
            : null;
  return maximum === null ? 'neutral' : row.value <= maximum ? 'good' : 'bad';
}

function formatSli(row: SliRow): string {
  if (row.value === null) return 'Missing';
  if (row.sli.includes('availability') || row.sli.includes('completeness'))
    return `${(row.value * 100).toFixed(2)}%`;
  if (row.sli.includes('_ms')) return `${Math.round(row.value)} ms`;
  if (row.sli.includes('_seconds')) return `${Math.round(row.value)} s`;
  return formatValue(row.value);
}

function formatCell(column: string, value: unknown): string {
  if (typeof value === 'number' && (column.endsWith('_at') || column === 'updatedAt'))
    return formatTimestamp(value);
  if (typeof value === 'boolean' || column === 'success') return value ? 'yes' : 'no';
  return formatValue(value);
}

function formatTimestamp(value: number): string {
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    milliseconds
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number')
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
