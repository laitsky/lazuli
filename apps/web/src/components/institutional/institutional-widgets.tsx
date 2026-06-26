import { AlertTriangle, Database, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';
import type React from 'react';
import type {
  ConfluenceSignal,
  EtfDailyFlow,
  InstitutionalAsset,
  InstitutionalProviderStatus,
  InstitutionalRange,
  OptionStrikeSummary,
  VolatilityCandle,
} from '@lazuli/shared';
import { Button } from '@/components/ui/button';
import { Panel, PanelDescription, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';

export const ASSET_OPTIONS = [
  { value: 'BTC', label: 'BTC' },
  { value: 'ETH', label: 'ETH' },
] satisfies Array<{ value: InstitutionalAsset; label: string }>;

export const RANGE_OPTIONS = [
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
] satisfies Array<{ value: InstitutionalRange; label: string }>;

export function AssetSwitch({
  asset,
  onChange,
}: {
  asset: InstitutionalAsset;
  onChange: (asset: InstitutionalAsset) => void;
}) {
  return (
    <SegmentedControl
      aria-label="Institutional asset"
      options={ASSET_OPTIONS}
      value={asset}
      onChange={onChange}
      size="md"
    />
  );
}

export function RangeSwitch({
  range,
  onChange,
}: {
  range: InstitutionalRange;
  onChange: (range: InstitutionalRange) => void;
}) {
  return (
    <SegmentedControl
      aria-label="History range"
      options={RANGE_OPTIONS}
      value={range}
      onChange={onChange}
      size="md"
    />
  );
}

export function ProviderBadge({ provider }: { provider?: InstitutionalProviderStatus | null }) {
  if (!provider) return null;
  const variant = provider.ok && !provider.stale ? 'up' : provider.ok ? 'warning' : 'down';
  return (
    <Tag
      variant={variant}
      title={`${provider.provider}: ${provider.source}${provider.message ? ` - ${provider.message}` : ''}`}
    >
      {provider.source}
      {provider.stale ? ' stale' : ''}
    </Tag>
  );
}

export function ProviderStrip({ providers }: { providers: InstitutionalProviderStatus[] }) {
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {providers.map((provider, index) => (
        <div
          key={`${provider.provider}-${provider.source}-${index}`}
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1 text-xs"
        >
          <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium text-foreground">{provider.provider}</span>
          <ProviderBadge provider={provider} />
        </div>
      ))}
    </div>
  );
}

export function LoadingGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-24" />
      ))}
    </div>
  );
}

export function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Panel className="border-destructive/30 bg-destructive/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="text-sm font-medium text-destructive">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
        <Button type="button" variant="secondary" className="min-h-10" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </Panel>
  );
}

export function FlowBars({ flows, height = 180 }: { flows: EtfDailyFlow[]; height?: number }) {
  const visible = flows.slice(-48);
  const maxAbs = Math.max(1, ...visible.map((flow) => Math.abs(flow.totalNetFlowUsd)));
  const inflowDays = visible.filter((flow) => flow.totalNetFlowUsd > 0).length;
  const netFlow = visible.reduce((sum, flow) => sum + flow.totalNetFlowUsd, 0);
  return (
    <div
      className="flex h-full min-h-40 items-end gap-1"
      style={{ height }}
      role="img"
      aria-label={`ETF flow bars. ${inflowDays} inflow days out of ${visible.length}. Net ${formatUsd(netFlow)}.`}
    >
      {visible.map((flow) => {
        const pct = Math.max(4, (Math.abs(flow.totalNetFlowUsd) / maxAbs) * 100);
        const up = flow.totalNetFlowUsd >= 0;
        return (
          <div
            key={flow.date}
            className="flex min-w-1 flex-1 flex-col items-center justify-end gap-1"
          >
            <div
              title={`${flow.date}: ${formatUsd(flow.totalNetFlowUsd)}`}
              className={cn(
                'w-full rounded-sm border',
                up ? 'border-up/35 bg-up/50' : 'border-down/35 bg-down/50'
              )}
              style={{ height: `${pct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function MarketReadPanel({
  regime,
  score,
  confidence,
  signals,
}: {
  regime: string;
  score: number;
  confidence: number;
  signals: ConfluenceSignal[];
}) {
  const freshSignals = signals.filter((signal) => signal.fresh);
  const staleSignals = signals.filter((signal) => !signal.fresh);
  const riskSignals = signals.filter((signal) => signal.direction === 'risk');
  const dominant = signals
    .slice()
    .sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50))[0];
  const bullish = signals.filter((signal) => signal.direction === 'bullish').length;
  const bearish = signals.filter((signal) => signal.direction === 'bearish').length;
  const agreement =
    bullish > bearish
      ? `${bullish} bullish inputs`
      : bearish > bullish
        ? `${bearish} bearish inputs`
        : 'mixed directional inputs';

  return (
    <Panel elevation={2}>
      <PanelHeader>
        <div>
          <PanelTitle>Market Read</PanelTitle>
          <PanelDescription>Transparent driver, agreement, risk, and data quality</PanelDescription>
        </div>
        <Tag variant={regime === 'fragile' ? 'warning' : 'accent'}>{regime}</Tag>
      </PanelHeader>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ReadCell
          label="Dominant Driver"
          value={dominant?.label ?? 'Mixed'}
          detail={dominant ? `${dominant.score}/100 · ${dominant.value}` : 'No signal leader'}
          icon={TrendingUp}
        />
        <ReadCell
          label="Agreement"
          value={agreement}
          detail={`${score}/100 composite with ${confidence}% confidence`}
        />
        <ReadCell
          label="Risk Flags"
          value={
            riskSignals.length
              ? riskSignals.map((signal) => signal.label).join(', ')
              : 'None active'
          }
          detail={
            riskSignals.length ? 'Fragility checks deserve attention' : 'No signal is marked risk'
          }
          icon={ShieldAlert}
        />
        <ReadCell
          label="Fresh Inputs"
          value={`${freshSignals.length}/${signals.length}`}
          detail={
            staleSignals.length
              ? `${staleSignals.length} stale input(s)`
              : 'All signal inputs fresh'
          }
        />
      </div>
    </Panel>
  );
}

function ReadCell({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-h-28 rounded-md border border-border bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-accent" aria-hidden /> : null}
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-semibold text-foreground">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function VolatilityPanel({
  candles,
  title = 'Volatility Regime',
}: {
  candles: VolatilityCandle[];
  title?: string;
}) {
  const values = candles.map((candle) => candle.close);
  const current = values[values.length - 1] ?? null;
  return (
    <Panel>
      <PanelHeader>
        <div>
          <PanelTitle>{title}</PanelTitle>
          <PanelDescription>Deribit volatility index history</PanelDescription>
        </div>
        <span className="numeric text-lg font-semibold text-foreground">
          {current === null ? '—' : `${current.toFixed(1)}%`}
        </span>
      </PanelHeader>
      <Sparkline
        data={[]}
        values={values}
        width={520}
        height={120}
        color="accent"
        fill
        className="h-28 w-full"
      />
    </Panel>
  );
}

export function StrikeWallChart({ strikes }: { strikes: OptionStrikeSummary[] }) {
  const visible = strikes
    .slice()
    .sort((a, b) => b.totalOpenInterest - a.totalOpenInterest)
    .slice(0, 14)
    .sort((a, b) => a.strike - b.strike);
  const maxOi = Math.max(1, ...visible.map((strike) => strike.totalOpenInterest));
  return (
    <div className="space-y-2">
      {visible.map((strike) => (
        <div key={strike.strike} className="grid grid-cols-[72px_1fr_1fr] items-center gap-2">
          <span className="numeric text-xs text-muted-foreground">
            {formatCompact(strike.strike)}
          </span>
          <div className="flex h-5 justify-end overflow-hidden rounded-sm bg-surface-2">
            <div
              className="h-full bg-up/60"
              style={{ width: `${(strike.callOpenInterest / maxOi) * 100}%` }}
              title={`Calls ${formatCompact(strike.callOpenInterest)}`}
            />
          </div>
          <div className="h-5 overflow-hidden rounded-sm bg-surface-2">
            <div
              className="h-full bg-down/60"
              style={{ width: `${(strike.putOpenInterest / maxOi) * 100}%` }}
              title={`Puts ${formatCompact(strike.putOpenInterest)}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SignalMatrix({ signals }: { signals: ConfluenceSignal[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {signals.map((signal) => (
        <Panel key={signal.id} className="min-h-36">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{signal.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{signal.explanation}</p>
            </div>
            <SignalTag signal={signal} />
          </div>
          <div className="mt-5 flex items-end justify-between gap-4">
            <span className="numeric text-2xl font-semibold text-foreground">{signal.score}</span>
            <span className="numeric text-sm text-muted-foreground">{signal.value}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                'h-full rounded-full',
                signal.direction === 'bullish' && 'bg-up',
                signal.direction === 'bearish' && 'bg-down',
                signal.direction === 'risk' && 'bg-warning',
                signal.direction === 'neutral' && 'bg-accent'
              )}
              style={{ width: `${signal.score}%` }}
            />
          </div>
        </Panel>
      ))}
    </div>
  );
}

function SignalTag({ signal }: { signal: ConfluenceSignal }) {
  if (!signal.fresh) return <Tag variant="warning">stale</Tag>;
  if (signal.direction === 'bullish') return <Tag variant="up">bullish</Tag>;
  if (signal.direction === 'bearish') return <Tag variant="down">bearish</Tag>;
  if (signal.direction === 'risk') return <Tag variant="warning">risk</Tag>;
  return <Tag variant="default">neutral</Tag>;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}
