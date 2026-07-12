/**
 * Options Surface
 *
 * BTC/ETH Deribit options cockpit: expiry positioning, IV regime, strike walls,
 * and normalized chain inspection.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CandlestickChart, Gauge, Waves } from 'lucide-react';
import type {
  InstitutionalAsset,
  InstitutionalRange,
  OptionExpirySummary,
  OptionInstrument,
} from '@lazuli/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelDescription, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Metric } from '@/components/ui/metric';
import { Button } from '@/components/ui/button';
import type { SortState } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag } from '@/components/ui/tag';
import {
  useOptionsChain,
  useOptionsExpiries,
  useOptionsSurface,
  useOptionsVolatility,
} from '@/lib/queries';
import {
  AssetSwitch,
  ErrorPanel,
  ProviderBadge,
  RangeSwitch,
  StrikeWallChart,
  VolatilityPanel,
  formatCompact,
} from '@/components/institutional/institutional-widgets';

export default function OptionsPage() {
  const [params, setParams] = useSearchParams();
  const asset = parseAsset(params.get('asset'));
  const range = parseRange(params.get('range'));
  const expiryParam = params.get('expiry') ?? undefined;
  const [sort, setSort] = useState<SortState>({ column: 'openInterest', direction: 'desc' });

  const expiries = useOptionsExpiries({ asset });
  const firstExpiry = expiries.data?.data.expiries[0]?.expiry;
  const selectedExpiry = expiryParam ?? firstExpiry;
  const chain = useOptionsChain({ asset, expiry: selectedExpiry });
  const volatility = useOptionsVolatility({ asset, range });
  const surface = useOptionsSurface({ asset });

  useEffect(() => {
    if (!expiryParam && firstExpiry) {
      setParams((current) => {
        current.set('expiry', firstExpiry);
        return current;
      });
    }
  }, [expiryParam, firstExpiry, setParams]);

  const setAsset = (next: InstitutionalAsset) => {
    setParams((current) => {
      current.set('asset', next);
      current.delete('expiry');
      return current;
    });
  };
  const setRange = (next: InstitutionalRange) => {
    setParams((current) => {
      current.set('range', next);
      return current;
    });
  };
  const setExpiry = (next: string) => {
    setParams((current) => {
      current.set('expiry', next);
      return current;
    });
  };

  const chainData = chain.data?.data;
  const expiry = chainData?.expiries.find((item) => item.expiry === chainData.expiry) ?? null;
  const sortedChain = useMemo(() => {
    const rows = chainData?.chain ?? [];
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.column === 'strike') return (a.strike - b.strike) * dir;
      if (sort.column === 'iv')
        return ((a.impliedVolatility ?? 0) - (b.impliedVolatility ?? 0)) * dir;
      if (sort.column === 'volume') return (a.volume24h - b.volume24h) * dir;
      return (a.openInterest - b.openInterest) * dir;
    });
  }, [chainData, sort]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Waves}
        title="Options Surface"
        description="Deribit BTC/ETH options chain, IV regime, expiry walls, skew, and max-pain positioning."
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
        freshnessMeta={chain.data?.meta ?? null}
      />

      {(chain.isError || expiries.isError || volatility.isError || surface.isError) && (
        <ErrorPanel
          title="Couldn't load options surface"
          message={
            chain.error?.message ??
            expiries.error?.message ??
            volatility.error?.message ??
            surface.error?.message ??
            'Provider error'
          }
          onRetry={() => {
            expiries.refetch();
            chain.refetch();
            volatility.refetch();
            surface.refetch();
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {chain.isLoading || !chainData ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Panel>
              <Metric label="Expiry" value={chainData.expiry ?? '—'} mono={false} size="md" />
              <div className="mt-2 flex items-center gap-2">
                <ProviderBadge provider={chainData.provider} />
              </div>
            </Panel>
            <Panel>
              <Metric label="Total OI" value={formatCompact(expiry?.totalOpenInterest)} size="lg" />
              <p className="mt-2 text-xs text-muted-foreground">
                {expiry?.instrumentCount ?? 0} instruments
              </p>
            </Panel>
            <Panel>
              <Metric label="Put / Call" value={expiry?.putCallRatio.toFixed(2) ?? '—'} size="lg" />
              <p className="mt-2 text-xs text-muted-foreground">
                Skew {expiry?.skew25Delta?.toFixed(1) ?? '—'} vol pts
              </p>
            </Panel>
            <Panel>
              <Metric label="Max Pain" value={formatCompact(expiry?.maxPainStrike)} size="lg" />
              <p className="mt-2 text-xs text-muted-foreground">
                {expiry?.daysToExpiry ?? '—'} days to expiry
              </p>
            </Panel>
          </>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>Expiry Selector</PanelTitle>
              <PanelDescription>Inspect walls by settlement date</PanelDescription>
            </div>
            <Gauge className="h-4 w-4 text-accent" aria-hidden />
          </PanelHeader>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Expiry
            </span>
            <select
              value={selectedExpiry ?? ''}
              onChange={(event) => setExpiry(event.target.value)}
              className="h-10 rounded-md border border-border bg-surface-1 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {(expiries.data?.data.expiries ?? []).map((item) => (
                <option key={item.expiry} value={item.expiry}>
                  {item.expiry} · {item.daysToExpiry}d · OI {formatCompact(item.totalOpenInterest)}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 space-y-3">
            {(expiries.data?.data.expiries ?? []).slice(0, 6).map((item) => (
              <ExpiryRow key={item.expiry} expiry={item} active={item.expiry === selectedExpiry} />
            ))}
          </div>
        </Panel>

        {volatility.isLoading || !volatility.data?.data ? (
          <Skeleton className="h-72" />
        ) : (
          <VolatilityPanel candles={volatility.data.data.candles} />
        )}
      </div>

      <Panel>
        <PanelHeader>
          <div>
            <PanelTitle>Observed IV Term Structure</PanelTitle>
            <PanelDescription>
              Nearest-strike ATM volatility and computed 25-delta skew. Missing or illiquid
              observations are never interpolated.
            </PanelDescription>
          </div>
          {surface.data?.data && (
            <Tag variant={surface.data.data.quality.coveragePercent >= 70 ? 'up' : 'warning'}>
              {surface.data.data.quality.coveragePercent.toFixed(0)}% coverage
            </Tag>
          )}
        </PanelHeader>
        {surface.isLoading ? (
          <div className="grid gap-2 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        ) : surface.data?.data.termStructure.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {surface.data.data.termStructure.map((point) => (
              <div key={point.expiry} className="rounded-md border border-border bg-surface-1 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-foreground">{point.expiry}</span>
                  <Tag variant={point.quality === 'observed' ? 'up' : 'warning'}>
                    {point.quality}
                  </Tag>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Metric
                    label="ATM IV"
                    value={
                      point.atmImpliedVolatility === null
                        ? '—'
                        : `${point.atmImpliedVolatility.toFixed(1)}%`
                    }
                    size="sm"
                  />
                  <Metric
                    label="25Δ Skew"
                    value={point.skew25Delta === null ? '—' : point.skew25Delta.toFixed(1)}
                    size="sm"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="No observed surface"
            text="The venue did not publish enough liquid strike observations for this asset."
          />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>Strike Walls</PanelTitle>
              <PanelDescription>Largest call and put open-interest concentrations</PanelDescription>
            </div>
            <CandlestickChart className="h-4 w-4 text-accent" aria-hidden />
          </PanelHeader>
          {chain.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className="h-5" />
              ))}
            </div>
          ) : chainData?.strikes.length ? (
            <StrikeWallChart strikes={chainData.strikes} />
          ) : (
            <EmptyBlock
              title="No strike walls"
              text="No strike-level open interest was returned."
            />
          )}
        </Panel>

        <Panel>
          <PanelHeader className="px-5 pt-5">
            <div>
              <PanelTitle>Options Chain</PanelTitle>
              <PanelDescription>Bid/ask, OI, volume, and implied volatility</PanelDescription>
            </div>
          </PanelHeader>
          {chain.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : (
            <OptionsChainTable rows={sortedChain} sort={sort} onSortChange={setSort} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function OptionsChainTable({
  rows,
  sort,
  onSortChange,
}: {
  rows: OptionInstrument[];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyBlock
        title="No options"
        text="The selected expiry has no normalized option instruments."
      />
    );
  }
  return (
    <div
      className="max-h-[560px] overflow-auto rounded-md border border-border"
      aria-label="Options chain"
    >
      <table className="w-full min-w-[760px]">
        <thead className="sticky top-0 z-10 bg-surface-1">
          <tr className="border-b border-border">
            <th
              className="px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              scope="col"
            >
              Instrument
            </th>
            <th
              className="px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              scope="col"
            >
              Type
            </th>
            <SortableHeader
              id="strike"
              label="Strike"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
            <SortableHeader
              id="openInterest"
              label="OI"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
            <SortableHeader
              id="volume"
              label="Volume"
              numeric
              sort={sort}
              onSortChange={onSortChange}
            />
            <SortableHeader id="iv" label="IV" numeric sort={sort} onSortChange={onSortChange} />
          </tr>
        </thead>
        <tbody>
          {rows.map((option) => (
            <tr key={option.instrumentName} className="border-b border-border last:border-0">
              <td className="px-3 py-3">
                <div className="font-mono text-sm font-semibold text-foreground">
                  {option.instrumentName}
                </div>
                <div className="text-xs text-muted-foreground">{option.expiry}</div>
              </td>
              <td className="px-3 py-3">
                <Tag variant={option.optionType === 'call' ? 'up' : 'down'}>
                  {option.optionType}
                </Tag>
              </td>
              <td className="numeric px-3 py-3 text-right text-sm text-foreground">
                {formatCompact(option.strike)}
              </td>
              <td className="numeric px-3 py-3 text-right text-sm text-foreground">
                {formatCompact(option.openInterest)}
              </td>
              <td className="numeric px-3 py-3 text-right text-sm text-muted-foreground">
                {formatCompact(option.volume24h)}
              </td>
              <td className="numeric px-3 py-3 text-right text-sm text-foreground">
                {option.impliedVolatility?.toFixed(1) ?? '—'}%
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

function ExpiryRow({ expiry, active }: { expiry: OptionExpirySummary; active: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 ${active ? 'border-accent bg-accent-subtle' : 'border-border bg-surface-1'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="numeric text-sm font-semibold text-foreground">{expiry.expiry}</span>
        <span className="numeric text-xs text-muted-foreground">{expiry.daysToExpiry}d</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <span className="text-muted-foreground">OI {formatCompact(expiry.totalOpenInterest)}</span>
        <span className="text-muted-foreground">PCR {expiry.putCallRatio.toFixed(2)}</span>
        <span className="text-muted-foreground">
          IV {expiry.atmImpliedVolatility?.toFixed(1) ?? '—'}%
        </span>
      </div>
    </div>
  );
}

function EmptyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-md border border-border bg-surface-1 p-6 text-center">
      <Waves className="h-7 w-7 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function parseAsset(value: string | null): InstitutionalAsset {
  return value === 'ETH' ? 'ETH' : 'BTC';
}

function parseRange(value: string | null): InstitutionalRange {
  if (value === '30d' || value === 'ytd' || value === 'all') return value;
  return '90d';
}
