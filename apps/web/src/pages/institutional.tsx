/**
 * Institutional Intelligence — Flow & Vol Radar
 *
 * Flagship cockpit that answers whether BTC/ETH moves are ETF-led,
 * options-led, leverage-led, spot-led, or fragile.
 */

import { Link, useSearchParams } from 'react-router-dom';
import { Activity, ArrowRight, Building2, Gauge, Landmark, Layers3, Waves } from 'lucide-react';
import type { InstitutionalAsset, MacroHistorySeries } from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelDescription, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { PriceText } from '@/components/ui/price-text';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { Sparkline } from '@/components/ui/sparkline';
import {
  useEtfFlows,
  useInstitutionalOverview,
  useMacroHistory,
  useOptionsChain,
} from '@/lib/queries';
import {
  AssetSwitch,
  ErrorPanel,
  FlowBars,
  LoadingGrid,
  MarketReadPanel,
  ProviderStrip,
  SignalMatrix,
  StrikeWallChart,
  formatCompact,
  formatUsd,
} from '@/components/institutional/institutional-widgets';

export default function InstitutionalPage() {
  const [params, setParams] = useSearchParams();
  const asset = parseAsset(params.get('asset'));
  const overview = useInstitutionalOverview({ asset });
  const flows = useEtfFlows({ asset, range: '30d' });
  const chain = useOptionsChain({ asset });
  const macro = useMacroHistory({ range: '90d' });

  const data = overview.data?.data;
  const flowData = flows.data?.data;
  const chainData = chain.data?.data;

  const setAsset = (next: InstitutionalAsset) => {
    setParams((current) => {
      current.set('asset', next);
      return current;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Activity}
        title="Institutional Intelligence"
        description="ETF demand, options positioning, perp leverage, liquidity, and spot trend in one regime cockpit."
        actions={
          <div className="flex items-center gap-2">
            <AssetSwitch asset={asset} onChange={setAsset} />
            <Button asChild variant="outline">
              <Link to={`/etf-flows?asset=${asset}`}>
                ETF Flows
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/options?asset=${asset}`}>
                Options
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        }
        freshnessMeta={overview.data?.meta ?? null}
      />

      {overview.isError && (
        <ErrorPanel
          title="Couldn't load institutional overview"
          message={overview.error.message}
          onRetry={() => overview.refetch()}
        />
      )}

      {overview.isLoading ? (
        <LoadingGrid count={8} />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Panel>
              <Metric
                label={`${asset} Spot`}
                value={
                  <PriceText
                    value={data.price.spot}
                    changePercent={data.price.change24h}
                    size="lg"
                  />
                }
                mono={false}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Source: {data.price.sourceExchange}
              </p>
            </Panel>
            <Panel>
              <Metric label="Latest ETF Flow" value={formatUsd(data.etf.latestFlowUsd)} size="lg" />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {data.etf.streak.days} day {data.etf.streak.direction} streak
              </p>
            </Panel>
            <Panel>
              <Metric
                label="IV / Rank"
                value={`${data.options.currentIv?.toFixed(1) ?? '—'}%`}
                size="lg"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Rank {data.options.ivRank?.toFixed(0) ?? '—'} · skew{' '}
                {data.options.skew25Delta?.toFixed(1) ?? '—'}
              </p>
            </Panel>
            <Panel>
              <Metric
                label="Regime Score"
                value={data.confluence.regimeScore.toString()}
                size="lg"
              />
              <div className="mt-2 flex items-center gap-2">
                <Tag variant={data.confluence.regime === 'fragile' ? 'warning' : 'accent'}>
                  {data.confluence.regime}
                </Tag>
                <span className="numeric text-[11px] text-muted-foreground">
                  {data.confluence.confidence}% confidence
                </span>
              </div>
            </Panel>
          </div>

          <Panel elevation={2}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-display text-xl font-semibold text-foreground">
                  {data.confluence.summary}
                </p>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  The score is built from explicit signals. Stale providers lower confidence instead
                  of hiding the panel.
                </p>
              </div>
              <ProviderStrip providers={data.providers} />
            </div>
          </Panel>

          <MarketReadPanel
            regime={data.confluence.regime}
            score={data.confluence.regimeScore}
            confidence={data.confluence.confidence}
            signals={data.confluence.signals}
          />

          <MacroHistoryPanel
            loading={macro.isLoading}
            error={macro.error?.message ?? null}
            series={macro.data?.data.series ?? null}
            onRetry={() => macro.refetch()}
          />

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <Panel>
              <PanelHeader>
                <div>
                  <PanelTitle>ETF Demand Tape</PanelTitle>
                  <PanelDescription>Daily net flows, last 30 calendar days</PanelDescription>
                </div>
                <Landmark className="h-4 w-4 text-accent" aria-hidden />
              </PanelHeader>
              {flows.isLoading ? (
                <div className="h-48 skeleton-shimmer rounded-md" />
              ) : flowData && flowData.flows.length > 0 ? (
                <>
                  <FlowBars flows={flowData.flows} height={190} />
                  <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
                    <Metric label="Net" value={formatUsd(flowData.totals.netFlowUsd)} size="md" />
                    <Metric
                      label="Positive Days"
                      value={flowData.totals.positiveDays.toString()}
                      size="md"
                    />
                    <Metric
                      label="Anomalies"
                      value={flowData.totals.anomalyDays.toString()}
                      size="md"
                    />
                  </div>
                </>
              ) : (
                <EmptyCopy
                  title="No ETF flow history"
                  text="Provider returned no rows for this range."
                />
              )}
            </Panel>

            <Panel>
              <PanelHeader>
                <div>
                  <PanelTitle>Nearest Expiry</PanelTitle>
                  <PanelDescription>Options wall and put/call pressure</PanelDescription>
                </div>
                <Waves className="h-4 w-4 text-accent" aria-hidden />
              </PanelHeader>
              {chain.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-5 skeleton-shimmer rounded-sm" />
                  ))}
                </div>
              ) : chainData && chainData.strikes.length > 0 ? (
                <>
                  <StrikeWallChart strikes={chainData.strikes} />
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
                    <Metric
                      label="Max Pain"
                      value={formatCompact(chainData.expiries[0]?.maxPainStrike)}
                      size="md"
                    />
                    <Metric
                      label="Put / Call"
                      value={chainData.expiries[0]?.putCallRatio.toFixed(2) ?? '—'}
                      size="md"
                    />
                  </div>
                </>
              ) : (
                <EmptyCopy
                  title="No options chain"
                  text="Deribit returned no instruments for the selected asset."
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Panel>
              <Metric
                label="Funding Pressure"
                value={data.derivatives.fundingPressure}
                size="md"
                mono={false}
              />
              <p className="mt-2 numeric text-xs text-muted-foreground">
                Avg {data.derivatives.avgFundingRate?.toFixed(4) ?? '—'}%
              </p>
            </Panel>
            <Panel>
              <Metric
                label="Perp OI"
                value={formatUsd(data.derivatives.totalOpenInterestUsd)}
                size="md"
              />
              <p className="mt-2 text-xs text-muted-foreground">Across available funding feeds</p>
            </Panel>
            <Panel>
              <Metric
                label="Largest Wall"
                value={formatCompact(data.options.largestExpiryWall?.strike)}
                size="md"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                OI {formatCompact(data.options.largestExpiryWall?.totalOpenInterest)}
              </p>
            </Panel>
            <Panel>
              <Metric
                label="Cumulative ETF"
                value={formatUsd(data.etf.cumulativeFlowUsd)}
                size="md"
              />
              <p className="mt-2 text-xs text-muted-foreground">Public flow source snapshot</p>
            </Panel>
          </div>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-accent" aria-hidden />
              <h2 className="font-display text-lg font-semibold text-foreground">
                Confluence Matrix
              </h2>
            </div>
            <SignalMatrix signals={data.confluence.signals} />
          </section>
        </>
      ) : null}

      <Panel className="border-warning/30 bg-warning/5">
        <div className="flex items-start gap-3">
          <Layers3 className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Informational analytics only. ETF, options, and exchange data can update on different
            clocks; use provider freshness before acting on a regime read.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function MacroHistoryPanel({
  loading,
  error,
  series,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  series: {
    btcDominance: MacroHistorySeries;
    stablecoinSupplyUsd: MacroHistorySeries;
    fearGreedIndex: MacroHistorySeries;
  } | null;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="macro-history-title" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="macro-history-title"
            className="font-display text-lg font-semibold text-foreground"
          >
            Macro Liquidity Regime
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Independent public providers. A stale source lowers confidence without suppressing the
            other signals.
          </p>
        </div>
        <Tag>90d history</Tag>
      </div>

      {error ? (
        <Panel className="border-destructive/30 bg-destructive/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Couldn't load macro history</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </Panel>
      ) : loading || !series ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 skeleton-shimmer rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <MacroSeriesCard label="BTC Dominance" series={series.btcDominance} />
          <MacroSeriesCard label="Stablecoin Supply" series={series.stablecoinSupplyUsd} />
          <MacroSeriesCard label="Fear & Greed" series={series.fearGreedIndex} />
        </div>
      )}
    </section>
  );
}

function MacroSeriesCard({ label, series }: { label: string; series: MacroHistorySeries }) {
  const latest = series.latest?.value ?? null;
  const first = series.points[0]?.value ?? null;
  const change = latest !== null && first !== null ? latest - first : null;
  const value =
    latest === null
      ? '—'
      : series.unit === 'usd'
        ? formatUsd(latest)
        : `${latest.toFixed(series.unit === 'index' ? 0 : 1)}${series.unit === 'percent' ? '%' : ''}`;

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <Metric label={label} value={value} size="md" />
        <Tag variant={!series.provider.ok || series.provider.stale ? 'warning' : 'up'}>
          {!series.provider.ok ? 'unavailable' : series.provider.stale ? 'stale' : 'fresh'}
        </Tag>
      </div>
      {series.points.length > 1 ? (
        <Sparkline
          data={series.points.map((point) => ({
            timestamp: point.observedAt,
            value: point.value,
          }))}
          width={320}
          height={48}
          fill
          className="mt-4 h-12 w-full"
        />
      ) : (
        <div className="mt-4 flex h-12 items-center justify-center rounded-md border border-border bg-surface-2 text-xs text-muted-foreground">
          History unavailable
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">{series.provider.provider}</span>
        <span
          className={
            change === null
              ? 'font-mono text-muted-foreground'
              : change >= 0
                ? 'font-mono text-success'
                : 'font-mono text-destructive'
          }
        >
          {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)} / 90d`}
        </span>
      </div>
    </Panel>
  );
}

function EmptyCopy({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-border bg-surface-1 p-6 text-center">
      <Building2 className="h-7 w-7 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function parseAsset(value: string | null): InstitutionalAsset {
  return value === 'ETH' ? 'ETH' : 'BTC';
}
