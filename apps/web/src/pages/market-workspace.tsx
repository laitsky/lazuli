import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { CandlestickChartWithIndicators } from '@/components/candlestick-chart-with-indicators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatCurrency,
  formatPercentage,
  formatVolume,
  getFundingColor,
  LazuliAPI,
} from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { appRoutes } from '@/lib/navigation';
import type {
  ExchangeInfo,
  FundingRateData,
  IndicatorDataPoint,
  OrderBookResponse,
  SupportedExchange,
  Ticker,
  Timeframe,
} from '@lazuli/shared';
import { Activity, BookOpen, GitMerge, LineChart, PieChart, RefreshCw, Search } from 'lucide-react';

const DEFAULT_EXCHANGE: SupportedExchange = 'bybit';
const DEFAULT_TIMEFRAME: Timeframe = '1h';
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];

export default function MarketWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const exchange = parseExchange(searchParams.get('exchange'));
  const marketType = parseMarketType(searchParams.get('type'));
  const timeframe = parseTimeframe(searchParams.get('timeframe'));
  const selectedSymbol = searchParams.get('symbol') ?? '';

  const [exchanges, setExchanges] = useState<ExchangeInfo[]>([]);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [tickerLoading, setTickerLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [indicatorData, setIndicatorData] = useState<IndicatorDataPoint[]>([]);
  const [indicatorConfig, setIndicatorConfig] = useState<{
    sma: number[];
    ema: number[];
    rsi: number[];
  } | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookResponse | null>(null);
  const [funding, setFunding] = useState<FundingRateData | null>(null);

  const selectedTicker = useMemo(
    () => tickers.find((ticker) => ticker.symbol === selectedSymbol) ?? null,
    [selectedSymbol, tickers]
  );

  const visibleTickers = useMemo(() => {
    const query = symbolSearch.trim().toLowerCase();
    return tickers
      .filter((ticker) => (query ? ticker.symbol.toLowerCase().includes(query) : true))
      .slice(0, 80);
  }, [symbolSearch, tickers]);

  useEffect(() => {
    async function loadExchanges() {
      const response = await LazuliAPI.getExchanges();
      if (response.success && response.data) {
        setExchanges(response.data);
      }
    }
    loadExchanges();
  }, []);

  useEffect(() => {
    async function loadTickers() {
      setTickerLoading(true);
      setError(null);
      try {
        const response = await LazuliAPI.getTickers(exchange, {
          type: marketType,
          quote: exchange === 'hyperliquid' ? 'USDC' : 'USDT',
          sortBy: 'volume',
          sortOrder: 'desc',
          limit: 500,
        });

        if (!response.success || !response.data) {
          setError(response.error || 'Failed to load market symbols');
          setTickers([]);
          return;
        }

        setTickers(response.data.tickers);
        if (!selectedSymbol && response.data.tickers[0]) {
          updateQuery({ symbol: response.data.tickers[0].symbol });
        }
      } finally {
        setTickerLoading(false);
      }
    }

    loadTickers();
  }, [exchange, marketType]);

  useEffect(() => {
    async function loadPanels() {
      if (!selectedSymbol) {
        return;
      }

      setPanelLoading(true);
      setError(null);
      try {
        const [indicatorResponse, orderBookResponse, fundingResponse] = await Promise.all([
          LazuliAPI.getTechnicalIndicators(exchange, selectedSymbol, {
            timeframe,
            type: marketType,
            limit: 220,
          }),
          LazuliAPI.getOrderBook(exchange, selectedSymbol, { type: marketType, limit: 15 }),
          marketType === 'perp'
            ? LazuliAPI.getFundingRates(exchange, { limit: 300 })
            : Promise.resolve(null),
        ]);

        if (indicatorResponse.success && indicatorResponse.data) {
          setIndicatorData(indicatorResponse.data.data);
          setIndicatorConfig(indicatorResponse.data.indicators);
        } else {
          setIndicatorData([]);
          setIndicatorConfig(null);
        }

        if (orderBookResponse.success && orderBookResponse.data) {
          setOrderBook(orderBookResponse.data);
        } else {
          setOrderBook(null);
        }

        if (fundingResponse?.success && fundingResponse.data) {
          setFunding(
            fundingResponse.data.fundingRates.find((item) => item.symbol === selectedSymbol) ?? null
          );
        } else {
          setFunding(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workspace panels');
      } finally {
        setPanelLoading(false);
      }
    }

    loadPanels();
  }, [exchange, marketType, selectedSymbol, timeframe]);

  function updateQuery(
    nextValues: Partial<Record<'exchange' | 'symbol' | 'type' | 'timeframe', string>>
  ) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(nextValues)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    setSearchParams(next, { replace: true });
  }

  const currentExchange = exchanges.find((item) => item.id === exchange);
  const compatibleExchanges = exchanges.filter((item) =>
    marketType === 'spot' ? item.hasSpot : item.hasPerp
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LineChart}
        title="Market Workspace"
        description="Inspect one market across price action, liquidity, funding, and related strategy tools."
      />

      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Exchange">
            <select
              value={exchange}
              onChange={(event) =>
                updateQuery({ exchange: event.target.value, symbol: '', type: marketType })
              }
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {compatibleExchanges.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type">
            <select
              value={marketType}
              onChange={(event) =>
                updateQuery({ type: event.target.value, symbol: '', exchange: exchange })
              }
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="spot" disabled={currentExchange ? !currentExchange.hasSpot : false}>
                Spot
              </option>
              <option value="perp" disabled={currentExchange ? !currentExchange.hasPerp : false}>
                Perp
              </option>
            </select>
          </Field>

          <Field label="Symbol">
            <select
              value={selectedSymbol}
              onChange={(event) => updateQuery({ symbol: event.target.value })}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Select symbol</option>
              {visibleTickers.map((ticker) => (
                <option key={ticker.symbol} value={ticker.symbol}>
                  {ticker.symbol}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={symbolSearch}
                onChange={(event) => setSymbolSearch(event.target.value)}
                placeholder="Filter symbols"
                className="pl-9"
              />
            </div>
          </Field>

          <Field label="Timeframe">
            <select
              value={timeframe}
              onChange={(event) => updateQuery({ timeframe: event.target.value })}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {TIMEFRAMES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {tickerLoading ? (
        <WorkspaceSkeleton />
      ) : !selectedTicker ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            No symbol selected for this workspace.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Last" value={formatCurrency(selectedTicker.last)} />
              <MetricCard
                label="24h Change"
                value={formatPercentage(selectedTicker.percentage24h)}
              />
              <MetricCard
                label="24h Volume"
                value={formatVolume(selectedTicker.quoteVolume24h ?? selectedTicker.volume24h)}
              />
              <MetricCard
                label="Spread"
                value={
                  selectedTicker.bid && selectedTicker.ask
                    ? formatPrice(selectedTicker.ask - selectedTicker.bid)
                    : 'N/A'
                }
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-primary" />
                  Indicator Chart
                </CardTitle>
              </CardHeader>
              <CardContent>
                {panelLoading && indicatorData.length === 0 ? (
                  <Skeleton className="h-[360px] w-full" />
                ) : indicatorData.length > 0 ? (
                  <CandlestickChartWithIndicators
                    data={indicatorData}
                    timeframe={timeframe}
                    symbol={selectedSymbol}
                    height={360}
                    availableSMA={indicatorConfig?.sma}
                    availableEMA={indicatorConfig?.ema}
                    availableRSI={indicatorConfig?.rsi}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No indicator data returned.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Order Book Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {orderBook ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <MetricBlock label="Mid" value={formatCurrency(orderBook.midPrice)} />
                      <MetricBlock
                        label="Spread"
                        value={
                          orderBook.spreadPercent === null
                            ? 'N/A'
                            : `${orderBook.spreadPercent.toFixed(4)}%`
                        }
                      />
                    </div>
                    <BookSide title="Asks" rows={orderBook.orderbook.asks.slice(0, 5)} tone="ask" />
                    <BookSide title="Bids" rows={orderBook.orderbook.bids.slice(0, 5)} tone="bid" />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Order book preview unavailable.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Perp Funding</CardTitle>
              </CardHeader>
              <CardContent>
                {marketType === 'perp' && funding ? (
                  <div className="space-y-3">
                    <MetricBlock
                      label="Funding"
                      value={`${funding.fundingRatePercent >= 0 ? '+' : ''}${funding.fundingRatePercent.toFixed(4)}%`}
                      valueClassName={getFundingColor(funding.fundingRatePercent)}
                    />
                    <MetricBlock
                      label="Annualized"
                      value={`${funding.annualizedRate >= 0 ? '+' : ''}${funding.annualizedRate.toFixed(2)}%`}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Funding data appears when a perpetual symbol is selected.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Continue In</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button asChild variant="outline" className="justify-start">
                  <Link
                    to={`${appRoutes.superema.href}?exchange=${exchange}&symbol=${selectedSymbol}`}
                  >
                    <Activity className="h-4 w-4" />
                    SuperEMA
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link to={appRoutes.syntheticPair.href}>
                    <GitMerge className="h-4 w-4" />
                    Synthetic Pair
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link to={appRoutes.customIndex.href}>
                    <PieChart className="h-4 w-4" />
                    Custom Index
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => updateQuery({ symbol: selectedSymbol })}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh Workspace
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 truncate font-display text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function MetricBlock({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-mono text-sm font-semibold ${valueClassName ?? ''}`}>{value}</div>
    </div>
  );
}

function BookSide({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: { price: number; amount: number }[];
  tone: 'bid' | 'ask';
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={`${title}-${row.price}`} className="grid grid-cols-2 gap-2 text-xs">
            <span className={tone === 'bid' ? 'text-[hsl(152_60%_50%)]' : 'text-destructive'}>
              {formatPrice(row.price)}
            </span>
            <span className="truncate text-right text-muted-foreground">
              {row.amount.toFixed(4)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-[430px] w-full" />
      </div>
      <Skeleton className="h-[520px] w-full" />
    </div>
  );
}

function parseExchange(value: string | null): SupportedExchange {
  const exchanges: SupportedExchange[] = ['bybit', 'okx', 'hyperliquid', 'upbit'];
  return value && exchanges.includes(value as SupportedExchange)
    ? (value as SupportedExchange)
    : DEFAULT_EXCHANGE;
}

function parseMarketType(value: string | null): 'spot' | 'perp' {
  return value === 'perp' ? 'perp' : 'spot';
}

function parseTimeframe(value: string | null): Timeframe {
  return TIMEFRAMES.includes(value as Timeframe) ? (value as Timeframe) : DEFAULT_TIMEFRAME;
}
