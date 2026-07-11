/**
 * Signal Lab — live ticker-derived setup board
 *
 * Converts exchange ticker snapshots into ranked trade setups. The score is
 * intentionally explainable: 24h move, range position, and liquidity each
 * contribute to the final rank so traders can quickly reject weak ideas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BadgeAlert,
  Copy,
  Crosshair,
  Flame,
  Gauge,
  History,
  LockKeyhole,
  Play,
  RotateCcw,
  Save,
  SearchX,
  ShieldAlert,
  Square,
} from 'lucide-react';
import type {
  AsyncBacktestJob,
  SignalLabStrategy,
  SupportedExchange,
  Ticker,
} from '@lazuli/shared';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Metric } from '@/components/ui/metric';
import { Tag } from '@/components/ui/tag';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useExchanges, useTickers } from '@/lib/queries';
import { LazuliAPI, type SignalStrategyInput } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import {
  buildBacktestIdempotencyKey,
  createDefaultStrategy,
  formatDateInput,
  parseUtcDateRange,
} from '@/lib/signal-strategy';
import { useSignalLabFilters } from '@/lib/url-state';
import { formatCompactPrice, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

type SignalMode = 'momentum' | 'contrarian' | 'breakout';

interface SignalSetup {
  ticker: Ticker;
  asset: string;
  score: number;
  scoreLabel: string;
  mode: SignalMode;
  direction: 'long' | 'short';
  thesis: string;
  trigger: string;
  invalidation: string;
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
  rangePosition: number;
  liquidityRank: number;
  move24h: number;
}

const QUOTE_OPTIONS = ['ALL', 'USDT', 'USDC', 'FDUSD', 'BTC', 'ETH'] as const;
const VOLUME_OPTIONS = [
  { value: '0', label: 'Any volume' },
  { value: '1000000', label: '$1M+' },
  { value: '10000000', label: '$10M+' },
  { value: '50000000', label: '$50M+' },
] as const;

/** Extract the base asset from both spot symbols and compact perp symbols. */
function getBaseAsset(symbol: string): string {
  if (symbol.includes('-')) return symbol.split('-')[0] ?? symbol;

  const compact = symbol.replace('.P', '');
  for (const quote of ['USDT', 'USDC', 'FDUSD', 'USD', 'BTC', 'ETH']) {
    if (compact.endsWith(quote)) return compact.slice(0, -quote.length);
  }

  return compact;
}

/** Convert a bounded numeric value to 0..1 without letting outliers dominate. */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Calculate where the current price sits inside the 24h high/low range. */
function getRangePosition(ticker: Ticker): number {
  const last = ticker.last ?? 0;
  const high = ticker.high24h ?? 0;
  const low = ticker.low24h ?? 0;
  const range = high - low;

  if (last <= 0 || high <= 0 || low <= 0 || range <= 0) return 0.5;
  return clamp01((last - low) / range);
}

/** Build one explainable signal from one ticker and the selected scanner mode. */
function buildSetup(ticker: Ticker, mode: SignalMode, maxLogVolume: number): SignalSetup | null {
  const entry = ticker.last ?? ticker.bid ?? ticker.ask ?? 0;
  const volume = ticker.quoteVolume24h ?? 0;
  const move24h = ticker.percentage24h ?? 0;
  const rangePosition = getRangePosition(ticker);
  const liquidityRank = maxLogVolume > 0 ? Math.log10(Math.max(volume, 1)) / maxLogVolume : 0;

  if (entry <= 0) return null;

  const positiveMove = clamp01(move24h / 12);
  const negativeMove = clamp01(Math.abs(Math.min(move24h, 0)) / 12);
  const absoluteMove = clamp01(Math.abs(move24h) / 16);

  let score = 0;
  let direction: SignalSetup['direction'] = 'long';
  let thesis = '';
  let trigger = '';
  let invalidation = '';
  let stop = entry * 0.97;
  let target = entry * 1.06;

  if (mode === 'momentum') {
    score = positiveMove * 52 + rangePosition * 28 + liquidityRank * 20;
    direction = 'long';
    thesis = 'Clean strength with price holding near the top of the 24h range.';
    trigger = 'Enter only if the next pullback holds above VWAP or prior local high.';
    invalidation = 'Momentum thesis fails below the lower third of the 24h range.';
    stop = entry * (1 - Math.max(0.018, Math.min(0.06, Math.abs(move24h) / 220)));
    target = entry * (1 + Math.max(0.035, Math.min(0.14, Math.abs(move24h) / 95)));
  } else if (mode === 'contrarian') {
    score = negativeMove * 46 + (1 - rangePosition) * 34 + liquidityRank * 20;
    direction = 'long';
    thesis = 'Oversold candidate with enough liquidity to make a mean-reversion attempt tradable.';
    trigger = 'Wait for reclaim of the prior 15m breakdown level before entry.';
    invalidation = 'Skip or exit if price accepts below the 24h low.';
    stop = entry * (1 - Math.max(0.014, Math.min(0.05, Math.abs(move24h) / 260)));
    target = entry * (1 + Math.max(0.025, Math.min(0.1, Math.abs(move24h) / 120)));
  } else {
    score = rangePosition * 42 + liquidityRank * 24 + absoluteMove * 34;
    direction = move24h >= 0 ? 'long' : 'short';
    thesis =
      direction === 'long'
        ? 'Pressure is building near the 24h high with enough volume to matter.'
        : 'Downside pressure is pinned near the 24h low with expanding movement.';
    trigger =
      direction === 'long'
        ? 'Require a clean break above the 24h high, then use the breakout level as risk.'
        : 'Require a clean break below the 24h low, then use the breakdown level as risk.';
    invalidation =
      direction === 'long'
        ? 'Failed breakout back inside range invalidates the setup.'
        : 'Failed breakdown back inside range invalidates the setup.';
    stop = direction === 'long' ? entry * 0.982 : entry * 1.018;
    target = direction === 'long' ? entry * 1.055 : entry * 0.945;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const riskReward = risk > 0 ? reward / risk : 0;

  return {
    ticker,
    asset: getBaseAsset(ticker.symbol),
    score: Math.round(score),
    scoreLabel: score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D',
    mode,
    direction,
    thesis,
    trigger,
    invalidation,
    entry,
    stop,
    target,
    riskReward,
    rangePosition,
    liquidityRank,
    move24h,
  };
}

export default function SignalLabPage() {
  const auth = useAuth();
  const [filters, setFilters] = useSignalLabFilters();
  const [savedStrategies, setSavedStrategies] = useState<SignalLabStrategy[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savingSymbol, setSavingSymbol] = useState<string | null>(null);
  const minVolume = Number(filters.minVolume);
  const quoteParam = filters.quote === 'ALL' ? undefined : filters.quote;
  const { data: exchangesData } = useExchanges();
  const tickers = useTickers(filters.exchange, {
    type: filters.type,
    quote: quoteParam,
    sortBy: 'volume',
    sortOrder: 'desc',
    page: 1,
    limit: 500,
  });

  const exchanges = exchangesData?.data.filter((exchange) => exchange.supported) ?? [];
  const rawTickers = tickers.data?.data.tickers ?? [];

  const setups = useMemo(() => {
    const liquidTickers = rawTickers.filter((ticker) => {
      const volume = ticker.quoteVolume24h ?? 0;
      const hasPrice = (ticker.last ?? ticker.bid ?? ticker.ask ?? 0) > 0;
      return hasPrice && volume >= minVolume;
    });
    const maxLogVolume = Math.max(
      ...liquidTickers.map((ticker) => Math.log10(Math.max(ticker.quoteVolume24h ?? 1, 1))),
      1
    );

    return liquidTickers
      .map((ticker) => buildSetup(ticker, filters.mode, maxLogVolume))
      .filter((setup): setup is SignalSetup => setup !== null)
      .filter((setup) => {
        if (!filters.search.trim()) return true;
        const query = filters.search.toLowerCase();
        return (
          setup.asset.toLowerCase().includes(query) ||
          setup.ticker.symbol.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);
  }, [filters.mode, filters.search, minVolume, rawTickers]);

  const stats = useMemo(() => {
    const tradable = setups.filter((setup) => setup.score >= 65);
    const best = setups[0] ?? null;
    const averageScore =
      setups.length > 0
        ? setups.reduce((total, setup) => total + setup.score, 0) / setups.length
        : 0;

    return {
      best,
      tradableCount: tradable.length,
      averageScore,
      scannedCount: rawTickers.length,
    };
  }, [rawTickers.length, setups]);

  const loadSavedStrategies = useCallback(async () => {
    if (auth.status !== 'authenticated') {
      setSavedStrategies([]);
      setSavedError(null);
      return;
    }
    setSavedLoading(true);
    const response = await LazuliAPI.listSignalStrategies();
    setSavedLoading(false);
    if (!response.success || !response.data) {
      setSavedError(response.error || 'Could not load saved strategies.');
      return;
    }
    setSavedError(null);
    setSavedStrategies(response.data);
  }, [auth.status]);

  useEffect(() => {
    void loadSavedStrategies();
  }, [loadSavedStrategies]);

  const saveSetup = useCallback(
    async (setup: SignalSetup) => {
      if (auth.status !== 'authenticated') return;
      setSavingSymbol(setup.ticker.symbol);
      const response = await LazuliAPI.createSignalStrategy(strategyInputFromSetup(setup));
      setSavingSymbol(null);
      if (!response.success || !response.data) {
        toast.error(response.error || 'Could not save this strategy.');
        return;
      }
      toast.success(`${setup.asset} strategy saved with an automatic quick test.`);
      await loadSavedStrategies();
    },
    [auth.status, loadSavedStrategies]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Crosshair}
        title="Signal Lab"
        description="Live ticker snapshots converted into ranked momentum, contrarian, and breakout setups. Scores are triage, not trade instructions."
        freshnessMeta={tickers.data?.meta ?? null}
        actions={
          auth.status === 'authenticated' ? (
            <Tag variant="accent">
              <LockKeyhole className="h-3 w-3" aria-hidden />
              Private library
            </Tag>
          ) : (
            <Button asChild variant="outline" className="min-h-10">
              <Link to="/account">Sign in to save</Link>
            </Button>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Panel>
          <Metric label="Setups Ranked" value={setups.length.toString()} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Top 24 after filters</p>
        </Panel>
        <Panel>
          <Metric label="Tradable Grade" value={stats.tradableCount.toString()} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Score 65 or better</p>
        </Panel>
        <Panel>
          <Metric label="Average Score" value={stats.averageScore.toFixed(0)} mono size="md" />
          <p className="mt-1 text-[11px] text-muted-foreground">Current board quality</p>
        </Panel>
        <Panel>
          <Metric
            label="Top Setup"
            value={stats.best ? `${stats.best.asset} ${stats.best.score}` : '—'}
            mono
            size="md"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {stats.scannedCount} tickers scanned
          </p>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filters.exchange}
              onValueChange={(value) => setFilters({ exchange: value as typeof filters.exchange })}
            >
              <SelectTrigger className="h-8 w-[126px]">
                <SelectValue placeholder="Exchange" />
              </SelectTrigger>
              <SelectContent>
                {exchanges.map((exchange) => (
                  <SelectItem key={exchange.id} value={exchange.id}>
                    {exchange.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SegmentedControl
              value={filters.type}
              onChange={(value) => setFilters({ type: value })}
              options={[
                { value: 'spot', label: 'Spot' },
                { value: 'perp', label: 'Perp' },
              ]}
              size="sm"
              aria-label="Market type"
            />
            <SegmentedControl
              value={filters.mode}
              onChange={(value) => setFilters({ mode: value })}
              options={[
                { value: 'momentum', label: 'Momentum', icon: Flame },
                { value: 'contrarian', label: 'Contrarian', icon: ShieldAlert },
                { value: 'breakout', label: 'Breakout', icon: Activity },
              ]}
              size="sm"
              aria-label="Signal mode"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={filters.quote}
              onValueChange={(value) => setFilters({ quote: value as typeof filters.quote })}
            >
              <SelectTrigger className="h-8 w-full sm:w-[96px]">
                <SelectValue placeholder="Quote" />
              </SelectTrigger>
              <SelectContent>
                {QUOTE_OPTIONS.map((quote) => (
                  <SelectItem key={quote} value={quote}>
                    {quote}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.minVolume}
              onValueChange={(value) =>
                setFilters({ minVolume: value as typeof filters.minVolume })
              }
            >
              <SelectTrigger className="h-8 w-full sm:w-[124px]">
                <SelectValue placeholder="Volume" />
              </SelectTrigger>
              <SelectContent>
                {VOLUME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchInput
              value={filters.search}
              onValueChange={(value) => setFilters({ search: value })}
              placeholder="Search symbol..."
              className="sm:w-56"
            />
          </div>
        </div>
      </Panel>

      <Panel className="border-warning/30 bg-warning/5">
        <div className="flex items-start gap-3">
          <BadgeAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Signal Lab ranks candidates from public ticker data only. Confirm structure on the
            chart, check order book depth, and account for fees, funding, and slippage before
            placing any trade.
          </p>
        </div>
      </Panel>

      <SavedStrategyLibrary
        authStatus={auth.status}
        strategies={savedStrategies}
        loading={savedLoading}
        error={savedError}
        onRetry={loadSavedStrategies}
        onChanged={loadSavedStrategies}
      />

      {tickers.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : tickers.error ? (
        <Panel className="border-destructive/30 bg-destructive/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Could not load live tickers</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tickers.error.message || 'Retry the scanner in a moment.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => tickers.refetch()}>
              Retry
            </Button>
          </div>
        </Panel>
      ) : setups.length === 0 ? (
        <Panel>
          <EmptyState
            icon={SearchX}
            title="No setups pass this filter"
            description="Lower the volume threshold, switch quote currency, or scan a different exchange."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {setups.map((setup) => (
            <SignalCard
              key={`${setup.ticker.exchange}:${setup.ticker.symbol}`}
              setup={setup}
              canSave={auth.status === 'authenticated'}
              saving={savingSymbol === setup.ticker.symbol}
              onSave={() => saveSetup(setup)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({
  setup,
  canSave,
  saving,
  onSave,
}: {
  setup: SignalSetup;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const workspaceHref = `/workspace?exchange=${setup.ticker.exchange}&symbol=${encodeURIComponent(
    setup.ticker.symbol
  )}&type=${setup.ticker.type}&timeframe=1h`;
  const isLong = setup.direction === 'long';

  return (
    <Panel interactive className="flex min-h-[196px] flex-col justify-between gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-semibold text-foreground">{setup.asset}</h2>
            <Tag variant={setup.score >= 80 ? 'up' : setup.score >= 65 ? 'accent' : 'warning'}>
              {setup.scoreLabel} · {setup.score}
            </Tag>
            <Tag variant={isLong ? 'up' : 'down'}>{setup.direction}</Tag>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{setup.ticker.symbol}</p>
        </div>
        <Gauge
          className={cn('h-5 w-5 shrink-0', setup.score >= 65 ? 'text-accent' : 'text-warning')}
          aria-hidden
        />
      </div>

      <p className="text-sm text-foreground">{setup.thesis}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniMetric label="Entry" value={formatPrice(setup.entry)} />
        <MiniMetric label="Stop" value={formatPrice(setup.stop)} tone={isLong ? 'down' : 'up'} />
        <MiniMetric
          label="Target"
          value={formatPrice(setup.target)}
          tone={isLong ? 'up' : 'down'}
        />
        <MiniMetric label="R:R" value={`${setup.riskReward.toFixed(2)}x`} />
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground">
        <p>
          <span className="text-foreground">Trigger:</span> {setup.trigger}
        </p>
        <p>
          <span className="text-foreground">Invalidation:</span> {setup.invalidation}
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Tag>
            {setup.move24h >= 0 ? '+' : ''}
            {setup.move24h.toFixed(2)}%
          </Tag>
          <Tag>{Math.round(setup.rangePosition * 100)}% range</Tag>
          <Tag>{formatCompactPrice(setup.ticker.quoteVolume24h ?? 0)} vol</Tag>
        </div>
        <div className="flex items-center gap-2">
          {canSave && (
            <Button
              variant="secondary"
              size="sm"
              className="min-h-10"
              disabled={saving}
              aria-busy={saving}
              onClick={onSave}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="min-h-10">
            <Link to={workspaceHref}>
              Open workspace
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function strategyInputFromSetup(setup: SignalSetup): SignalStrategyInput {
  return {
    name: `${setup.asset} ${setup.mode}`,
    exchange: setup.ticker.exchange as SupportedExchange,
    symbol: setup.ticker.symbol,
    marketType: setup.ticker.type,
    timeframe: '1h',
    strategy: createDefaultStrategy(setup.asset, setup.mode),
    autoBacktest: true,
  };
}

function strategyInputFromSaved(
  strategy: SignalLabStrategy,
  overrides: { name?: string } = {}
): SignalStrategyInput {
  return {
    name: overrides.name ?? strategy.name,
    exchange: strategy.exchange,
    symbol: strategy.symbol,
    marketType: strategy.marketType,
    timeframe: strategy.timeframe,
    strategy: { ...strategy.strategy, name: overrides.name ?? strategy.strategy.name },
    autoBacktest: true,
  };
}

function SavedStrategyLibrary({
  authStatus,
  strategies,
  loading,
  error,
  onRetry,
  onChanged,
}: {
  authStatus: 'loading' | 'authenticated' | 'guest';
  strategies: SignalLabStrategy[];
  loading: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fullHistoryId, setFullHistoryId] = useState<string | null>(null);

  const runAction = async (
    actionId: string,
    action: () => Promise<{ success: boolean; error: string | null }>,
    successMessage: string
  ) => {
    setBusyAction(actionId);
    setActionError(null);
    const response = await action();
    setBusyAction(null);
    if (!response.success) {
      setActionError(response.error || 'The strategy action failed.');
      return;
    }
    toast.success(successMessage);
    await onChanged();
  };

  return (
    <section aria-labelledby="saved-strategies-heading" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="saved-strategies-heading"
            className="font-display text-lg font-semibold text-foreground"
          >
            Strategy Library
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Private by default. Every change creates an immutable version with its own result.
          </p>
        </div>
        {authStatus === 'authenticated' && <Tag>{strategies.length} versions</Tag>}
      </div>

      {authStatus === 'loading' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : authStatus === 'guest' ? (
        <Panel>
          <EmptyState
            icon={LockKeyhole}
            title="Sign in to keep strategies private"
            description="Save scanner setups, preserve every version, and run full-history jobs across sessions."
            action={
              <Button asChild variant="outline" className="min-h-10">
                <Link to="/account">Open account</Link>
              </Button>
            }
          />
        </Panel>
      ) : loading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : error ? (
        <Panel className="border-destructive/30 bg-destructive/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">
                Could not load strategy versions
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" size="sm" className="min-h-10" onClick={() => void onRetry()}>
              Retry
            </Button>
          </div>
        </Panel>
      ) : strategies.length === 0 ? (
        <Panel>
          <EmptyState
            icon={History}
            title="No saved strategies"
            description="Save a ranked setup below. Lazuli will run a quick backtest automatically."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {actionError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
            >
              {actionError}
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {strategies.map((strategy) => {
              const isBusy = busyAction?.endsWith(strategy.id) ?? false;
              return (
                <Panel key={strategy.id} className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-display text-base font-semibold text-foreground">
                          {strategy.name}
                        </h3>
                        <Tag variant="accent">v{strategy.version}</Tag>
                        <Tag>
                          <LockKeyhole className="h-3 w-3" aria-hidden /> private
                        </Tag>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {strategy.exchange} · {strategy.symbol} · {strategy.timeframe} ·{' '}
                        {strategy.strategy.mode}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {new Date(strategy.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <StrategyResultSummary strategy={strategy} />

                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-10"
                      disabled={isBusy}
                      aria-busy={busyAction === `test:${strategy.id}`}
                      onClick={() =>
                        void runAction(
                          `test:${strategy.id}`,
                          () =>
                            LazuliAPI.runSignalStrategyBacktest(
                              strategy.id,
                              strategyInputFromSaved(strategy)
                            ),
                          `Quick test refreshed for ${strategy.name}.`
                        )
                      }
                    >
                      <Play aria-hidden /> Quick test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-10"
                      disabled={isBusy}
                      aria-busy={busyAction === `clone:${strategy.id}`}
                      onClick={() =>
                        void runAction(
                          `clone:${strategy.id}`,
                          () =>
                            LazuliAPI.createSignalStrategy(
                              strategyInputFromSaved(strategy, { name: `${strategy.name} copy` })
                            ),
                          `${strategy.name} cloned as a private strategy.`
                        )
                      }
                    >
                      <Copy aria-hidden /> Clone
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-10"
                      disabled={isBusy}
                      aria-busy={busyAction === `restore:${strategy.id}`}
                      onClick={() =>
                        void runAction(
                          `restore:${strategy.id}`,
                          () =>
                            LazuliAPI.createSignalStrategyVersion(
                              strategy.id,
                              strategyInputFromSaved(strategy)
                            ),
                          `${strategy.name} restored as a new immutable version.`
                        )
                      }
                    >
                      <RotateCcw aria-hidden /> Restore as new
                    </Button>
                    <Button
                      variant={fullHistoryId === strategy.id ? 'accent' : 'outline'}
                      size="sm"
                      className="min-h-10"
                      onClick={() =>
                        setFullHistoryId((current) =>
                          current === strategy.id ? null : strategy.id
                        )
                      }
                      aria-expanded={fullHistoryId === strategy.id}
                    >
                      <History aria-hidden /> Full history
                    </Button>
                  </div>

                  {fullHistoryId === strategy.id && <FullHistoryRunner strategy={strategy} />}
                </Panel>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function StrategyResultSummary({ strategy }: { strategy: SignalLabStrategy }) {
  const metrics = strategy.latestBacktest?.metrics;
  if (!metrics) {
    return (
      <div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
        No quick-test result. Run the strategy once to establish a baseline.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <MiniMetric
        label="Return"
        value={`${metrics.totalReturnPercent >= 0 ? '+' : ''}${metrics.totalReturnPercent.toFixed(2)}%`}
        tone={metrics.totalReturnPercent >= 0 ? 'up' : 'down'}
      />
      <MiniMetric label="Sharpe" value={metrics.sharpe.toFixed(2)} />
      <MiniMetric
        label="Drawdown"
        value={`${metrics.maxDrawdownPercent.toFixed(2)}%`}
        tone="down"
      />
      <MiniMetric label="Trades" value={metrics.tradeCount.toString()} />
    </div>
  );
}

function FullHistoryRunner({ strategy }: { strategy: SignalLabStrategy }) {
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const [startDate, setStartDate] = useState(formatDateInput(oneYearAgo));
  const [endDate, setEndDate] = useState(formatDateInput(now));
  const [job, setJob] = useState<AsyncBacktestJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = job?.status === 'queued' || job?.status === 'running';
  const progressPercent = job ? Math.round(Math.max(0, Math.min(1, job.progress)) * 100) : 0;
  useEffect(() => {
    if (!job || !active) return;
    const timer = window.setInterval(async () => {
      const response = await LazuliAPI.getAsyncBacktestJob(job.id);
      if (!response.success || !response.data) {
        setError(response.error || 'Could not refresh the backtest job.');
        return;
      }
      setJob(response.data);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [active, job?.id]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let range: { startTime: number; endTime: number };
    try {
      range = parseUtcDateRange(startDate, endDate);
    } catch (rangeError) {
      setError(rangeError instanceof Error ? rangeError.message : 'Select a valid date range.');
      return;
    }
    const { startTime, endTime } = range;
    setSubmitting(true);
    setError(null);
    const idempotencyKey = buildBacktestIdempotencyKey(strategy.id, startTime, endTime);
    const response = await LazuliAPI.createAsyncBacktestJob(
      {
        exchange: strategy.exchange,
        symbol: strategy.symbol,
        marketType: strategy.marketType,
        timeframe: strategy.timeframe,
        startTime,
        endTime,
        strategy: strategy.strategy,
        strategyId: strategy.id,
      },
      idempotencyKey
    );
    setSubmitting(false);
    if (!response.success || !response.data) {
      setError(response.error || 'Could not queue the full-history backtest.');
      return;
    }
    setJob(response.data);
    toast.success('Full-history backtest queued.');
  };

  const cancel = async () => {
    if (!job) return;
    setSubmitting(true);
    const response = await LazuliAPI.cancelAsyncBacktestJob(job.id);
    setSubmitting(false);
    if (!response.success || !response.data) {
      setError(response.error || 'Could not cancel the backtest.');
      return;
    }
    setJob(response.data);
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label
          className="space-y-1.5 text-xs text-muted-foreground"
          htmlFor={`start-${strategy.id}`}
        >
          Start date
          <Input
            id={`start-${strategy.id}`}
            type="date"
            value={startDate}
            max={endDate}
            disabled={active}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground" htmlFor={`end-${strategy.id}`}>
          End date
          <Input
            id={`end-${strategy.id}`}
            type="date"
            value={endDate}
            min={startDate}
            max={formatDateInput(now)}
            disabled={active}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={submitting || active} aria-busy={submitting}>
          <Play aria-hidden /> {submitting ? 'Queueing…' : 'Run archive'}
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        Streams compressed R2 history. Fees are fixed at {strategy.strategy.feeBps} bps for this
        immutable version.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {job && (
        <div className="space-y-3 border-t border-border pt-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Tag
                variant={
                  job.status === 'complete'
                    ? 'up'
                    : job.status === 'failed'
                      ? 'down'
                      : job.status === 'cancelled'
                        ? 'warning'
                        : 'accent'
                }
              >
                {job.status}
              </Tag>
              <span className="font-mono text-xs text-muted-foreground">
                {job.processedRows.toLocaleString()} rows
              </span>
            </div>
            {active && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-10"
                onClick={() => void cancel()}
                disabled={submitting}
              >
                <Square aria-hidden /> Cancel
              </Button>
            )}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Archive progress</span>
              <span className="font-mono">{progressPercent}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded bg-surface-3"
              role="progressbar"
              aria-label="Full-history backtest progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div
                className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          {job.result && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniMetric
                label="Return"
                value={`${job.result.metrics.totalReturnPercent >= 0 ? '+' : ''}${job.result.metrics.totalReturnPercent.toFixed(2)}%`}
                tone={job.result.metrics.totalReturnPercent >= 0 ? 'up' : 'down'}
              />
              <MiniMetric label="Sharpe" value={job.result.metrics.sharpe.toFixed(2)} />
              <MiniMetric label="Candles" value={job.result.candleCount.toLocaleString()} />
              <MiniMetric label="Trades" value={job.result.tradeCount.toLocaleString()} />
            </div>
          )}
          {job.status === 'complete' && (
            <Button asChild variant="link" size="sm">
              <a
                href={`/api/v1/backtests/jobs/${encodeURIComponent(job.id)}/result`}
                target="_blank"
                rel="noreferrer"
              >
                Open deterministic result JSON
                <ArrowRight aria-hidden />
              </a>
            </Button>
          )}
          {job.error && <p className="text-xs text-destructive">{job.error}</p>}
        </div>
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-2">
      <p className="text-[10px] uppercase tracking-normal text-muted-foreground">{label}</p>
      <p
        className={cn(
          'numeric mt-1 truncate text-sm font-semibold text-foreground',
          tone === 'up' && 'text-up',
          tone === 'down' && 'text-down'
        )}
      >
        {value}
      </p>
    </div>
  );
}
