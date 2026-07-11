/**
 * Lazuli API Worker (Cloudflare Workers + Hono)
 *
 * Cloudflare-only runtime entrypoint. The public API reads through Durable
 * Object-backed live caches where possible, uses D1/R2 for historical backfill
 * metadata and archives, and exposes a Queue consumer plus Workflow definition
 * for 2019-2020 OHLCV backfills.
 */

import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type {
  AltcoinPerformance,
  AlphaFeedItem,
  AlphaFeedResponse,
  AltScreenerResponse,
  BaseCurrencyPrices,
  CrossExchangeFunding,
  CrossExchangeFundingResponse,
  CustomIndexResponse,
  CustomPairResponse,
  FundingMarketStats,
  FundingRateData,
  FundingRateResponse,
  FundingRadarResponse,
  FundingArbitrageResponse,
  HealthResponse,
  InstitutionalAsset,
  InstitutionalRange,
  IndexPerformancePoint,
  LiquidationRadarResponse,
  Market,
  MarketsResponse,
  OHLCVResponse,
  OrderBook,
  OrderBookResponse,
  OrderFlowResponse,
  PriceArbitrageResponse,
  BacktestResponse,
  SupportedExchange,
  StrategyDefinition,
  Ticker,
  TickersResponse,
  Timeframe,
  TrendingVolumeResponse,
  TrendingVolumeSpike,
  UserAccount,
} from '@lazuli/shared';
import { DEFAULT_INDICATOR_PERIODS } from '@lazuli/shared';
import type { BackfillQueueMessage, BackfillWorkflowParams, Env, OHLCV } from './types';
import {
  ErrorCode,
  ExchangeError,
  invalidExchange,
  invalidMarketType,
  invalidParameter,
  tickerNotFound,
} from './errors';
import { handleError, successResponse } from './utils/response';
import { featureDisabledEnvelope, featureEnabled } from './utils/features';
import {
  parseSymbol,
  validateBoolean,
  validateExchange,
  validateInteger,
  validateMarketType,
  validateQuoteCurrency,
  validateSearchQuery,
  validateSortOrder,
  validateTickerSortBy,
} from './utils/validation';
import {
  customIndexSchema,
  multiTimeframeQuerySchema,
  ohlcvBatchSchema,
  ohlcvQuerySchema,
  parseOrThrow,
  symbolSchema,
} from './utils/requestValidation';
import {
  applySecurityHeaders,
  classifyRouteLimit,
  enforcePublicRateLimit,
  requireAdminRequest,
  requireProductionCors,
  resolveCorsOrigin,
} from './utils/security';
import { ccxtService } from './services/ccxtService';
import { calculateSelectedEMAs, calculateSuperEMA } from './services/emaService';
import {
  getEtfFlows,
  getEtfFunds,
  getInstitutionalConfluence,
  getInstitutionalOverview,
  getOptionsChain,
  getOptionsExpiries,
  getOptionsVolatility,
} from './services/institutionalService';
import { buildPriceArbitrageResponse } from './services/priceArbitrageService';
import { calculateIndicators } from './services/technicalIndicatorService';
import {
  createBackfillJob,
  enqueuePendingTasks,
  getBackfillJob,
  processBackfillMessage,
  queueRetryDelaySeconds,
  readArchivedOhlcv,
  TerminalBackfillError,
} from './services/backfillService';
import {
  buildFundingArbitrage,
  buildFundingRadar,
  buildLiquidationRadar,
  buildOrderFlowResponse,
  calculateWilderRsi,
  defaultStrategyDefinition,
  normalizePerpSymbol,
  runBacktest,
} from './services/marketIntelligenceService';
import {
  buildMarketSnapshotSvg,
  createApiKey,
  createMagicLink,
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  createPriceAlert,
  deletePasskey,
  deletePriceAlert,
  deleteSavedBacktest,
  deleteSignalLabStrategy,
  deleteWatchlist,
  deleteWorkspace,
  evaluateAlertTrigger,
  listApiKeys,
  listDuePriceAlerts,
  listPasskeys,
  listPriceAlerts,
  listSavedBacktests,
  listSignalLabStrategies,
  listWatchlists,
  listWorkspaces,
  readUserFromSession,
  revokeApiKey,
  revokeSession,
  saveBacktest,
  saveSignalLabStrategy,
  saveSignalLabStrategyVersion,
  saveWatchlist,
  saveWorkspace,
  updateSignalLabLatestBacktest,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
  verifyMagicLink,
  type CreatePasskeyAuthenticationOptionsInput,
  type CreatePriceAlertInput,
  type SaveBacktestInput,
  type SaveSignalLabStrategyInput,
  type SaveWatchlistInput,
  type SaveWorkspaceInput,
  type VerifyPasskeyAuthenticationInput,
  type VerifyPasskeyRegistrationInput,
} from './services/growthRetentionService';

export { MarketDataCacheV2DO } from './services/MarketDataCacheDO';
export { RealtimeHubV2DO } from './services/RealtimeHubDO';

const exchanges = [
  { name: 'Bybit', id: 'bybit', supported: true, hasSpot: true, hasPerp: true },
  { name: 'OKX', id: 'okx', supported: true, hasSpot: true, hasPerp: true },
  { name: 'Hyperliquid', id: 'hyperliquid', supported: true, hasSpot: false, hasPerp: true },
  { name: 'Upbit', id: 'upbit', supported: true, hasSpot: true, hasPerp: false },
  {
    name: 'Binance',
    id: 'binance',
    supported: true,
    hasSpot: true,
    hasPerp: true,
    notes:
      'Regional availability varies; blocked or rate-limited regions degrade through stale/empty payload metadata.',
  },
] as const;

const publicFundingExchanges: SupportedExchange[] = ['binance', 'bybit', 'okx', 'hyperliquid'];

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  c.header('X-Request-ID', requestId);
  requireProductionCors(c.env);
  applySecurityHeaders(c);

  await next();

  const durationMs = Date.now() - startedAt;
  if (shouldRecordRequestUsage(c.req.path, c.res.status, requestId)) {
    c.env.API_ANALYTICS?.writeDataPoint({
      blobs: [c.req.method, routeUsageClass(c.req.path), c.res.status.toString()],
      doubles: [durationMs],
      indexes: [routeUsageClass(c.req.path)],
    });
  }

  if (shouldLogRequest(c.req.path, c.res.status)) {
    console.log(
      JSON.stringify({
        level: c.res.status >= 500 ? 'error' : 'info',
        module: 'api',
        msg: 'request complete',
        requestId,
        method: c.req.method,
        routeClass: routeUsageClass(c.req.path),
        status: c.res.status,
        durationMs,
      })
    );
  }
});

app.use(
  '*',
  cors({
    origin: (origin, c) => resolveCorsOrigin(origin, c.env),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Admin-API-Key',
      'X-Admin-Key-Id',
      'X-Admin-Timestamp',
      'X-Admin-Nonce',
      'X-Admin-Signature',
    ],
    credentials: true,
    maxAge: 86400,
  })
);

app.use('/api/v1/*', enforcePublicRateLimit);

app.use('/api/v1/auth/*', async (c, next) => {
  if (!featureEnabled(c.env, 'ACCOUNT_FEATURES_ENABLED')) {
    return featureDisabled(c, 'Account features are temporarily disabled');
  }
  return next();
});

app.use('/api/v1/me/alerts/evaluate', async (c, next) => {
  if (!featureEnabled(c.env, 'ALERT_EVALUATION_ENABLED')) {
    return featureDisabled(c, 'Alert evaluation is temporarily disabled');
  }
  return next();
});

app.use('/api/v1/me', requireAccountFeatures);
app.use('/api/v1/me/*', requireAccountFeatures);

app.use('/api/v1/admin/*', async (c, next) => {
  if (!featureEnabled(c.env, 'ADMIN_ROUTES_ENABLED')) {
    return featureDisabled(c, 'Admin routes are temporarily disabled');
  }
  return next();
});

app.get('/', (c) => c.redirect('/api/v1/docs'));

app.get('/health', async (c) => ok(c, buildPublicHealth()));

app.get('/ws', (c) => {
  if (!c.env.REALTIME_HUB) {
    return c.json(
      {
        success: false,
        data: null,
        error: 'Realtime hub is not configured',
        timestamp: Date.now(),
      },
      503
    );
  }

  const id = c.env.REALTIME_HUB.idFromName('global');
  return c.env.REALTIME_HUB.get(id).fetch(c.req.raw);
});

const api = new Hono<{ Bindings: Env }>();

api.get('/docs', (c) =>
  c.html(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Lazuli API</title></head>
  <body>
    <h1>Lazuli API</h1>
    <p>REST API for live cryptocurrency market data. OpenAPI source is tracked at apps/api/src/api-spec.yaml.</p>
    <ul>
      <li><a href="/api/v1/health">/api/v1/health</a></li>
      <li><a href="/api/v1/exchanges">/api/v1/exchanges</a></li>
    </ul>
  </body>
</html>`)
);

api.get('/health', async (c) => ok(c, buildPublicHealth()));

api.get('/exchanges', (c) => c.json(successResponse(exchanges)));

api.get('/tickers/:exchange', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const query = c.req.query();
  const type = validateMarketType(query.type);
  const quote = validateQuoteCurrency(query.quote);
  const search = validateSearchQuery(query.search);
  const page = validateInteger(query.page, 1, 1, 10_000);
  const limit = validateInteger(query.limit, 100, 1, 500);
  const sortBy = validateTickerSortBy(query.sortBy);
  const sortOrder = validateSortOrder(query.sortOrder);

  const { data: rawTickers, meta } = await cachedMarketData<Ticker[]>(
    c.env,
    'tickers',
    exchange,
    type
  );
  const filtered = filterTickers(rawTickers, { type, quote, search, sortBy, sortOrder });
  const paged = paginate(filtered, page, limit);
  const response: TickersResponse = {
    exchange,
    tickers: paged.items,
    count: paged.items.length,
    pagination: paged.pagination,
    filters: { type, search, sortBy, sortOrder },
  };

  return ok(c, response, meta);
});

api.get('/tickers/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = decodeURIComponent(c.req.param('symbol'));
  const type = symbol.endsWith('.P') ? 'perp' : 'spot';
  const { data: tickers, meta } = await cachedMarketData<Ticker[]>(
    c.env,
    'tickers',
    exchange,
    type
  );
  const ticker = tickers.find((item) => item.symbol === symbol);
  if (!ticker) {
    throw tickerNotFound(symbol, exchange);
  }
  return ok(c, ticker, meta);
});

api.get('/markets/:exchange', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const query = c.req.query();
  const type = validateMarketType(query.type);
  const search = validateSearchQuery(query.search);
  const active = validateBoolean(query.active);
  const page = validateInteger(query.page, 1, 1, 10_000);
  const limit = validateInteger(query.limit, 100, 1, 500);

  const { data: rawMarkets, meta } = await cachedMarketData<Market[]>(
    c.env,
    'markets',
    exchange,
    type
  );
  const filtered = rawMarkets.filter((market) => {
    if (type && market.type !== type) return false;
    if (active !== undefined && market.active !== active) return false;
    if (search && !market.symbol.toLowerCase().includes(search)) return false;
    return true;
  });
  const paged = paginate(filtered, page, limit);
  const response: MarketsResponse = {
    exchange,
    markets: paged.items,
    count: paged.items.length,
    pagination: paged.pagination,
    filters: { type, search, active },
  };
  return ok(c, response, meta);
});

api.get('/ohlcv/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const options = parseOhlcvQuery(c.req.query(), symbol);
  const candles = await loadOhlcv(c.env, exchange, symbol, options);

  const response: OHLCVResponse = {
    exchange,
    symbol,
    timeframe: options.timeframe,
    candles: candles.candles,
    count: candles.candles.length,
  };
  return ok(c, response, {
    source: candles.meta.source,
    archiveObjects: candles.meta.archiveObjects,
    missingArchive: candles.meta.missingArchive,
    cache: candles.meta.cache,
    coverage: { since: options.since, until: options.until, requestedLimit: options.limit },
  });
});

api.get('/ohlcv/multi/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const query = parseOrThrow(multiTimeframeQuerySchema, c.req.query(), 'query');
  const type = parseMarketType(query.type, symbol);
  const limit = query.limit;

  const result: Record<string, OHLCV[]> = {};
  const partialFailures: Array<{ timeframe: Timeframe; error: string }> = [];
  const entries = await mapWithConcurrency(query.timeframes, 3, async (timeframe) => {
    try {
      return [
        timeframe,
        (await loadOhlcv(c.env, exchange, symbol, { timeframe, type, limit })).candles,
      ] as const;
    } catch (error) {
      if (!isInvalidTimeframeError(error)) {
        throw error;
      }

      partialFailures.push({
        timeframe,
        error: error instanceof Error ? error.message : String(error),
      });
      return [timeframe, [] as OHLCV[]] as const;
    }
  });
  for (const [timeframe, candles] of entries) {
    result[timeframe] = candles;
  }

  return ok(
    c,
    {
      exchange,
      symbol,
      type,
      timeframes: query.timeframes,
      candles: result,
      timestamp: Date.now(),
    },
    partialFailures.length > 0 ? { partialFailures } : undefined
  );
});

api.get('/custom-pair/:exchange/:symbol1/:symbol2', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol1 = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol1')), 'symbol1');
  const symbol2 = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol2')), 'symbol2');
  const options = parseOhlcvQuery(c.req.query(), symbol1);
  const [candles1, candles2] = await Promise.all([
    loadOhlcv(c.env, exchange, symbol1, options),
    loadOhlcv(c.env, exchange, symbol2, options),
  ]);

  const denominatorByTime = new Map(candles2.candles.map((candle) => [candle.timestamp, candle]));
  const candles = candles1.candles.flatMap((a) => {
    const b = denominatorByTime.get(a.timestamp);
    if (!b || b.close === 0) return [];
    return [
      {
        timestamp: a.timestamp,
        open: safeDivide(a.open, b.open),
        high: safeDivide(a.high, b.high),
        low: safeDivide(a.low, b.low),
        close: safeDivide(a.close, b.close),
        volume: a.volume,
      },
    ];
  });

  const response: CustomPairResponse = {
    exchange,
    symbol1,
    symbol2,
    customPairSymbol: `${parseSymbol(symbol1).base}/${parseSymbol(symbol2).base}`,
    timeframe: options.timeframe,
    marketType: options.type,
    candles,
    count: candles.length,
  };
  return ok(c, response);
});

api.post('/custom-index', async (c) => {
  const request = parseOrThrow(
    customIndexSchema,
    await c.req.json().catch(() => ({})),
    'custom-index'
  );
  const exchange = requireExchange(request.exchange);
  const timeframe = request.timeframe;
  const limit = request.limit;
  const weightTotal = request.assets.reduce((sum, asset) => sum + asset.weight, 0);

  if (request.assets.length === 0 || weightTotal <= 0) {
    throw invalidParameter('assets', 'Custom index requires at least one weighted asset');
  }

  const series = await mapWithConcurrency(request.assets, 4, async (asset) => ({
    asset,
    candles: (
      await loadOhlcv(c.env, exchange, asset.symbol, {
        timeframe,
        type: asset.symbol.endsWith('.P') ? 'perp' : 'spot',
        limit,
      })
    ).candles,
  }));
  const performance = buildIndexPerformance(series, weightTotal);
  const benchmarks = await buildBenchmarks(c.env, exchange, timeframe, limit);
  const totalReturn =
    performance.length > 1 ? performance[performance.length - 1]!.value - performance[0]!.value : 0;
  const response: CustomIndexResponse = {
    name: request.name,
    exchange,
    timeframe,
    assets: request.assets,
    performance,
    benchmarks,
    startTime: performance[0]?.timestamp ?? Date.now(),
    endTime: performance[performance.length - 1]?.timestamp ?? Date.now(),
    totalReturn,
  };
  return ok(c, response);
});

api.get('/superema/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const options = parseOhlcvQuery(c.req.query(), symbol, 500);
  const maxPeriod = validateInteger(c.req.query('maxPeriod'), 400, 1, 400);
  const candles = (await loadOhlcv(c.env, exchange, symbol, options)).candles;
  const data =
    maxPeriod >= 300
      ? calculateSuperEMA(candles, maxPeriod)
      : calculateSelectedEMAs(
          candles,
          Array.from({ length: maxPeriod }, (_, index) => index + 1)
        );
  return ok(c, {
    exchange,
    symbol,
    timeframe: options.timeframe,
    marketType: options.type,
    periods: Array.from({ length: maxPeriod }, (_, index) => index + 1),
    data,
    candleCount: candles.length,
  });
});

api.get('/indicators/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const options = parseOhlcvQuery(c.req.query(), symbol, 300);
  const candles = (await loadOhlcv(c.env, exchange, symbol, options)).candles;
  const config = {
    sma: parsePeriods(c.req.query('sma'), DEFAULT_INDICATOR_PERIODS.sma),
    ema: parsePeriods(c.req.query('ema'), DEFAULT_INDICATOR_PERIODS.ema),
    rsi: parsePeriods(c.req.query('rsi'), DEFAULT_INDICATOR_PERIODS.rsi),
  };

  return ok(c, {
    exchange,
    symbol,
    timeframe: options.timeframe,
    marketType: options.type,
    indicators: config,
    data: calculateIndicators(candles, config),
    candleCount: candles.length,
  });
});

api.get('/orderflow/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const options = parseOhlcvQuery(c.req.query(), symbol, 240);
  const candles = (await loadOhlcv(c.env, exchange, symbol, options)).candles;
  const response: OrderFlowResponse = buildOrderFlowResponse({
    exchange,
    symbol,
    type: options.type,
    timeframe: options.timeframe,
    candles,
  });
  return ok(c, response, { source: 'ohlcv-derived', model: 'candle-footprint-proxy' });
});

api.get('/screener/:exchange/stats', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const { data: tickers } = await cachedMarketData<Ticker[]>(c.env, 'tickers', exchange);
  const response = buildAltScreener(exchange, tickers, {
    base: 'USD',
    period: '24h',
    sortBy: 'performance',
    sortOrder: 'desc',
    limit: 250,
  });
  return ok(c, { exchange, stats: response.stats, timestamp: Date.now() });
});

api.get('/screener/:exchange', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const query = c.req.query();
  const { data: tickers } = await cachedMarketData<Ticker[]>(
    c.env,
    'tickers',
    exchange,
    validateMarketType(query.type)
  );
  // Technical enrichment performs one OHLCV load per symbol, so keep its
  // request fan-out within the relaunch budget regardless of requested size.
  const technicalScreener = shouldRunTechnicalScreener(query);
  const userLimit = validateInteger(query.limit, 100, 1, 500);
  const screenerPool = technicalScreener ? 50 : userLimit;
  const response = buildAltScreener(exchange, tickers, {
    base: parseBaseCurrency(query.base),
    period: parsePerformancePeriod(query.period),
    sortBy: parseScreenerSort(query.sortBy),
    sortOrder: validateSortOrder(query.sortOrder),
    limit: screenerPool,
    minVolume: query.minVolume ? Number(query.minVolume) : undefined,
    maxVolume: query.maxVolume ? Number(query.maxVolume) : undefined,
    minChange: query.minChange ? Number(query.minChange) : undefined,
    maxChange: query.maxChange ? Number(query.maxChange) : undefined,
    minFundingRate: query.minFundingRate ? Number(query.minFundingRate) : undefined,
    maxFundingRate: query.maxFundingRate ? Number(query.maxFundingRate) : undefined,
    minOpenInterest: query.minOpenInterest ? Number(query.minOpenInterest) : undefined,
    search: validateSearchQuery(query.search),
  });
  const enriched = technicalScreener
    ? await enrichScreenerTechnicals(c.env, exchange, response, {
        type: validateMarketType(query.type) ?? 'spot',
        minRsi: query.minRsi ? Number(query.minRsi) : undefined,
        maxRsi: query.maxRsi ? Number(query.maxRsi) : undefined,
        breakout:
          query.breakout === 'up' || query.breakout === 'down' || query.breakout === 'any'
            ? query.breakout
            : undefined,
        limit: userLimit,
      })
    : response;
  return ok(c, enriched, {
    source: 'live-cache',
    technicalScan: technicalScreener,
  });
});

api.get('/trending/:exchange', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const query = c.req.query();
  const type = validateMarketType(query.type) ?? 'spot';
  const limit = validateInteger(query.limit, 25, 1, 100);
  const minRatio = query.minRatio ? Number(query.minRatio) : 1.8;
  const { data: tickers } = await cachedMarketData<Ticker[]>(c.env, 'tickers', exchange, type);
  const candidates = tickers
    .filter((ticker) => {
      const parsed = parseSymbol(ticker.symbol);
      return (
        ticker.last !== null &&
        (ticker.quoteVolume24h ?? ticker.volume24h ?? 0) > 0 &&
        (!parsed.quote || ['USDT', 'USD', 'USDC'].includes(parsed.quote))
      );
    })
    .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
    .slice(0, Math.min(80, Math.max(limit * 3, 20)));

  const items = await mapWithConcurrency(candidates, 5, async (ticker) =>
    buildTrendingVolumeSpike(c.env, exchange, ticker, type)
  );
  const filtered = items
    .filter((item): item is TrendingVolumeSpike => item !== null)
    .filter((item) => (item.volumeRatio24hVs7d ?? 0) >= minRatio)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const response: TrendingVolumeResponse = {
    exchange,
    items: filtered,
    count: filtered.length,
    timestamp: Date.now(),
  };
  return ok(c, response, { source: 'live-cache+r2-ohlcv', minRatio });
});

api.post('/screener/:exchange/ohlcv', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const body = parseOrThrow(ohlcvBatchSchema, await c.req.json().catch(() => ({})), 'body');
  const symbols = body.symbols;
  const timeframe = periodToTimeframe(body.period);
  const ohlcv: Record<string, OHLCV[]> = {};

  const entries = await mapWithConcurrency(
    symbols,
    4,
    async (symbol) =>
      [
        symbol,
        (
          await loadOhlcv(c.env, exchange, symbol, {
            timeframe,
            type: symbol.endsWith('.P') ? 'perp' : 'spot',
            limit: 60,
          })
        ).candles,
      ] as const
  );
  for (const [symbol, candles] of entries) {
    ohlcv[symbol] = candles;
  }

  return ok(c, {
    exchange,
    period: body.period ?? '24h',
    ohlcv,
    count: symbols.length,
    timestamp: Date.now(),
  });
});

api.get('/arbitrage/prices', async (c) => {
  const type = validateMarketType(c.req.query('type')) ?? 'spot';
  const quote = validateQuoteCurrency(c.req.query('quote')) ?? 'USDT';
  const minSpreadBps = validateInteger(c.req.query('minSpreadBps'), 10, 0, 10_000);
  const limit = validateInteger(c.req.query('limit'), 50, 1, 200);
  const eligibleExchanges = exchanges
    .filter((exchange) => exchange.supported)
    .filter((exchange) => (type === 'spot' ? exchange.hasSpot : exchange.hasPerp))
    .map((exchange) => exchange.id as SupportedExchange);

  const tickerSets = await Promise.all(
    eligibleExchanges.map(async (exchange) => ({
      exchange,
      tickers: (await cachedMarketData<Ticker[]>(c.env, 'tickers', exchange, type)).data,
    }))
  );

  const response: PriceArbitrageResponse = buildPriceArbitrageResponse(tickerSets, {
    type,
    quote,
    minSpreadBps,
    limit,
  });

  return ok(c, response, { source: 'live-cache', eligibleExchanges });
});

api.get('/institutional/overview', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  const market = await loadInstitutionalMarketInputs(c.env, asset);
  return ok(
    c,
    await getInstitutionalOverview({
      asset,
      env: c.env,
      fundingRates: market.fundingRates,
      spotTicker: market.spotTicker,
      sourceExchange: market.sourceExchange,
    }),
    { source: 'institutional-adapters' }
  );
});

api.get('/institutional/etf/flows', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  const range = parseInstitutionalRange(c.req.query('range'));
  return ok(c, await getEtfFlows(asset, range, c.env), { source: 'institutional-adapters' });
});

api.get('/institutional/etf/funds', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  return ok(c, await getEtfFunds(asset, c.env), { source: 'institutional-adapters' });
});

api.get('/institutional/options/chain', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  const expiry = c.req.query('expiry')?.trim();
  const { data, meta } = await cachedInstitutionalData(c.env, 'options-chain', asset, {
    expiry: expiry || undefined,
    fallback: () => getOptionsChain(asset, expiry || undefined),
  });
  return ok(c, data, meta);
});

api.get('/institutional/options/expiries', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  const { data, meta } = await cachedInstitutionalData(c.env, 'options-expiries', asset, {
    fallback: () => getOptionsExpiries(asset),
  });
  return ok(c, data, meta);
});

api.get('/institutional/options/volatility', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  const range = parseInstitutionalRange(c.req.query('range'));
  const { data, meta } = await cachedInstitutionalData(c.env, 'options-volatility', asset, {
    range,
    fallback: () => getOptionsVolatility(asset, range),
  });
  return ok(c, data, meta);
});

api.get('/institutional/confluence', async (c) => {
  const asset = parseInstitutionalAsset(c.req.query('asset'));
  const market = await loadInstitutionalMarketInputs(c.env, asset);
  return ok(
    c,
    await getInstitutionalConfluence({
      asset,
      fundingRates: market.fundingRates,
      spotTicker: market.spotTicker,
    }),
    { source: 'institutional-adapters' }
  );
});

api.get('/funding/radar', async (c) => {
  const exchangeParam = c.req.query('exchange');
  const limit = validateInteger(c.req.query('limit'), 50, 1, 200);
  const selectedExchanges =
    exchangeParam && exchangeParam !== 'all'
      ? [requireExchange(exchangeParam)]
      : publicFundingExchanges;
  const rates = (
    await Promise.all(
      selectedExchanges.map(async (exchange) =>
        cachedMarketData<FundingRateData[]>(c.env, 'funding', exchange, 'perp')
          .then((result) => result.data)
          .catch(() => [])
      )
    )
  ).flat();
  const response: FundingRadarResponse = buildFundingRadar(rates, limit);
  return ok(c, response, { source: 'live-cache', exchanges: selectedExchanges });
});

api.get('/funding/arbitrage', async (c) => {
  const limit = validateInteger(c.req.query('limit'), 50, 1, 200);
  const executionCostBps = validateInteger(c.req.query('executionCostBps'), 12, 0, 500);
  const inputs = await Promise.all(
    publicFundingExchanges.map(async (exchange) => ({
      exchange,
      rates: (
        await cachedMarketData<FundingRateData[]>(c.env, 'funding', exchange, 'perp').catch(() => ({
          data: [] as FundingRateData[],
          meta: {},
        }))
      ).data,
    }))
  );
  const response: FundingArbitrageResponse = buildFundingArbitrage(inputs, limit, executionCostBps);
  return ok(c, response, { source: 'live-cache', executionCostBps });
});

api.get('/funding/compare', async (c) => {
  const limit = validateInteger(c.req.query('limit'), 50, 1, 200);
  const allRates = await Promise.all(
    publicFundingExchanges.map(async (exchange) => ({
      exchange,
      rates: (await cachedMarketData<FundingRateData[]>(c.env, 'funding', exchange, 'perp')).data,
    }))
  );
  return ok(c, buildFundingComparison(allRates, limit));
});

api.get('/funding/:exchange', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const sortBy = c.req.query('sortBy') ?? 'rate';
  const sortOrder = validateSortOrder(c.req.query('sortOrder'));
  const limit = validateInteger(c.req.query('limit'), 100, 1, 500);
  const { data: rates, meta } = await cachedMarketData<FundingRateData[]>(
    c.env,
    'funding',
    exchange,
    'perp'
  );
  const sorted = sortFundingRates(rates, sortBy, sortOrder).slice(0, limit);
  const response: FundingRateResponse = {
    exchange,
    fundingRates: sorted,
    count: sorted.length,
    stats: buildFundingStats(rates),
    timestamp: Date.now(),
  };
  return ok(c, response, meta);
});

api.get('/orderbook/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const type = parseMarketType(c.req.query('type'), symbol);
  const limit = validateInteger(c.req.query('limit'), 50, 1, 500);
  const { orderbook, meta } = await loadOrderBook(c.env, exchange, symbol, type, limit);
  const bestBid = orderbook.bids[0]?.price ?? null;
  const bestAsk = orderbook.asks[0]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const midPrice = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const response: OrderBookResponse = {
    exchange,
    symbol,
    type,
    orderbook,
    depth: Math.min(orderbook.bids.length, orderbook.asks.length),
    spread,
    spreadPercent: spread !== null && midPrice ? (spread / midPrice) * 100 : null,
    midPrice,
    timestamp: orderbook.timestamp,
  };
  return ok(c, response, meta);
});

api.get('/liquidations/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const rawSymbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const symbol = normalizePerpSymbol(rawSymbol);
  const [tickersResult, fundingResult, orderbookResult] = await Promise.all([
    cachedMarketData<Ticker[]>(c.env, 'tickers', exchange, 'perp').catch(() => ({
      data: [] as Ticker[],
      meta: {},
    })),
    cachedMarketData<FundingRateData[]>(c.env, 'funding', exchange, 'perp').catch(() => ({
      data: [] as FundingRateData[],
      meta: {},
    })),
    loadOrderBook(c.env, exchange, symbol, 'perp', 50).catch(() => ({
      orderbook: null,
      meta: {},
    })),
  ]);
  const ticker = tickersResult.data.find((item) => item.symbol === symbol) ?? null;
  const funding = fundingResult.data.find((item) => item.symbol === symbol) ?? null;
  const response: LiquidationRadarResponse = buildLiquidationRadar({
    exchange,
    symbol,
    ticker,
    funding,
    orderbook: orderbookResult.orderbook,
  });
  return ok(c, response, {
    source: 'live-cache',
    model: 'estimated-from-oi-mark-book',
    warning: 'Estimated liquidation bands, not exchange-native liquidation prints',
  });
});

api.post('/backtest/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = parseOrThrow(symbolSchema, decodeURIComponent(c.req.param('symbol')), 'symbol');
  const body = await c.req.json().catch(() => ({}));
  const query = c.req.query();
  const options = parseOhlcvQuery(
    {
      timeframe: query.timeframe ?? readString(body, 'timeframe'),
      type: query.type ?? readString(body, 'type'),
      limit: query.limit ?? readString(body, 'limit') ?? '500',
      since: query.since ?? readString(body, 'since'),
      until: query.until ?? readString(body, 'until'),
    },
    symbol,
    500
  );
  const strategy = parseStrategyDefinition(body);
  const candles = (await loadOhlcv(c.env, exchange, symbol, options)).candles;
  const response: BacktestResponse = runBacktest({
    exchange,
    symbol,
    type: options.type,
    timeframe: options.timeframe,
    candles,
    strategy,
  });
  return ok(c, response, { source: 'r2+exchange', candleCount: candles.length });
});

api.post('/auth/magic-link', async (c) => {
  const body = await readJsonRecord(c.req.raw);
  const email = readRequiredString(body, 'email');
  return ok(c, await createMagicLink(c.env, email));
});

api.get('/auth/magic-link/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) throw invalidParameter('token', 'token is required');
  return ok(c, await verifyMagicLink(c.env, token));
});

api.post('/auth/magic-link/verify', async (c) => {
  const body = await readJsonRecord(c.req.raw);
  return ok(c, await verifyMagicLink(c.env, readRequiredString(body, 'token')));
});

api.post('/auth/passkeys/registration/options', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await createPasskeyRegistrationOptions(c.env, user));
});

api.post('/auth/passkeys/registration/verify', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  const body = await readJsonRecord(c.req.raw);
  return ok(c, await verifyPasskeyRegistration(c.env, user, parsePasskeyRegistrationInput(body)));
});

api.post('/auth/passkeys/authentication/options', async (c) => {
  const body = await readJsonRecord(c.req.raw);
  return ok(
    c,
    await createPasskeyAuthenticationOptions(c.env, parsePasskeyAuthenticationOptions(body))
  );
});

api.post('/auth/passkeys/authentication/verify', async (c) => {
  const body = await readJsonRecord(c.req.raw);
  return ok(c, await verifyPasskeyAuthentication(c.env, parsePasskeyAuthenticationInput(body)));
});

api.get('/me', async (c) => ok(c, await requireUser(c.env, c.req.header('Authorization') ?? null)));

api.post('/auth/logout', async (c) =>
  ok(c, await revokeSession(c.env, c.req.header('Authorization') ?? null))
);

api.get('/me/passkeys', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listPasskeys(c.env, user.id));
});

api.delete('/me/passkeys/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await deletePasskey(c.env, user.id, c.req.param('id')));
});

api.get('/me/workspaces', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listWorkspaces(c.env, user.id));
});

api.post('/me/workspaces', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(
    c,
    await saveWorkspace(c.env, user.id, parseWorkspaceInput(await readJsonRecord(c.req.raw)))
  );
});

api.delete('/me/workspaces/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await deleteWorkspace(c.env, user.id, c.req.param('id')));
});

api.get('/me/watchlists', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listWatchlists(c.env, user.id));
});

api.post('/me/watchlists', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(
    c,
    await saveWatchlist(c.env, user.id, parseWatchlistInput(await readJsonRecord(c.req.raw)))
  );
});

api.delete('/me/watchlists/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await deleteWatchlist(c.env, user.id, c.req.param('id')));
});

api.get('/me/backtests', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listSavedBacktests(c.env, user.id));
});

api.post('/me/backtests', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(
    c,
    await saveBacktest(c.env, user.id, parseSavedBacktestInput(await readJsonRecord(c.req.raw)))
  );
});

api.delete('/me/backtests/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await deleteSavedBacktest(c.env, user.id, c.req.param('id')));
});

api.get('/me/signal-strategies', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listSignalLabStrategies(c.env, user.id));
});

api.post('/me/signal-strategies', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  const body = await readJsonRecord(c.req.raw);
  const input = parseSignalLabStrategyInput(body);
  const latestBacktest =
    body.autoBacktest === true ? await runSignalLabBacktest(c.env, input) : null;
  return ok(
    c,
    await saveSignalLabStrategy(c.env, user.id, {
      ...input,
      latestBacktest,
    })
  );
});

api.post('/me/signal-strategies/:id/versions', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  const body = await readJsonRecord(c.req.raw);
  const input = parseSignalLabStrategyInput(body);
  const latestBacktest =
    body.autoBacktest === true ? await runSignalLabBacktest(c.env, input) : null;
  return ok(
    c,
    await saveSignalLabStrategyVersion(c.env, user.id, c.req.param('id'), {
      ...input,
      latestBacktest,
    })
  );
});

api.post('/me/signal-strategies/:id/backtest', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  const body = await readJsonRecord(c.req.raw);
  const input = parseSignalLabStrategyInput(body);
  const latestBacktest = await runSignalLabBacktest(c.env, input);
  return ok(
    c,
    await updateSignalLabLatestBacktest(c.env, user.id, c.req.param('id'), latestBacktest)
  );
});

api.delete('/me/signal-strategies/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await deleteSignalLabStrategy(c.env, user.id, c.req.param('id')));
});

api.get('/me/alerts', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listPriceAlerts(c.env, user.id));
});

api.post('/me/alerts', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(
    c,
    await createPriceAlert(c.env, user.id, parsePriceAlertInput(await readJsonRecord(c.req.raw)))
  );
});

api.delete('/me/alerts/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  const id = validateInteger(c.req.param('id'), 0, 1, Number.MAX_SAFE_INTEGER);
  return ok(c, await deletePriceAlert(c.env, user.id, id));
});

api.post('/me/alerts/evaluate', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await evaluateUserAlerts(c.env, user.id));
});

api.get('/me/api-keys', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await listApiKeys(c.env, user.id));
});

api.post('/me/api-keys', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  const body = await readJsonRecord(c.req.raw);
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
    : ['read:market-data'];
  return ok(c, await createApiKey(c.env, user.id, readRequiredString(body, 'name'), scopes));
});

api.delete('/me/api-keys/:id', async (c) => {
  const user = await requireUser(c.env, c.req.header('Authorization') ?? null);
  return ok(c, await revokeApiKey(c.env, user.id, c.req.param('id')));
});

api.get('/alpha-feed', async (c) => {
  const exchange = requireExchange(c.req.query('exchange') ?? 'bybit');
  const limit = validateInteger(c.req.query('limit'), 20, 1, 50);
  return ok(c, await buildAlphaFeed(c.env, exchange, limit), { source: 'live-cache' });
});

api.get('/alpha-feed/:id', async (c) => {
  const item = await readAlphaFeedEvent(c.env, decodeURIComponent(c.req.param('id')));
  if (!item) throw invalidParameter('id', 'Alpha Feed event was not found');
  return ok(c, item, { source: 'd1' });
});

api.get('/snapshots/market/:exchange/:symbol.svg', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const rawSymbol = c.req.param('symbol') ?? c.req.param('symbol.svg') ?? '';
  const symbol = parseOrThrow(
    symbolSchema,
    decodeURIComponent(rawSymbol.endsWith('.svg') ? rawSymbol.slice(0, -4) : rawSymbol),
    'symbol'
  );
  const type = parseMarketType(c.req.query('type'), symbol);
  const { data: tickers } = await cachedMarketData<Ticker[]>(c.env, 'tickers', exchange, type);
  const ticker = tickers.find((item) => item.symbol === symbol);
  if (!ticker) throw tickerNotFound(symbol, exchange);
  const svg = buildMarketSnapshotSvg({
    symbol,
    exchange,
    price: ticker.last,
    change24h: ticker.percentage24h,
    volume24h: ticker.quoteVolume24h ?? ticker.volume24h,
    timestamp: Date.now(),
  });
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
});

api.post('/admin/backfills', async (c) => {
  await requireAdminRequest(c);
  const body = await c.req.json().catch(() => ({}));
  const result = await createBackfillJob(c.env, body);
  return ok(c, result);
});

api.get('/admin/health', async (c) => {
  await requireAdminRequest(c);
  return ok(c, await buildDeepHealth(c.env));
});

api.get('/admin/backfills/:id', async (c) => {
  await requireAdminRequest(c);
  return ok(c, await getBackfillJob(c.env, c.req.param('id')));
});

api.post('/admin/backfills/:id/retry', async (c) => {
  await requireAdminRequest(c);
  const enqueued = await enqueuePendingTasks(c.env, c.req.param('id'));
  return ok(c, { jobId: c.req.param('id'), enqueued });
});

app.route('/api/v1', api);

app.notFound((c) =>
  c.json(
    {
      success: false,
      data: null,
      error: `Route '${c.req.path}' not found`,
      timestamp: Date.now(),
    },
    404
  )
);

app.onError((error, c) => {
  const handled = handleError(error);
  console.error(
    JSON.stringify({
      level: 'error',
      module: 'app',
      msg: 'request failed',
      routeClass: routeUsageClass(c.req.path),
      error: handled.body.error,
      code: handled.body.code,
    })
  );
  return c.json(handled.body, handled.status as 500);
});

export class BackfillWorkflow extends WorkflowEntrypoint<Env, BackfillWorkflowParams> {
  async run(
    event: WorkflowEvent<BackfillWorkflowParams>,
    step: WorkflowStep
  ): Promise<{
    jobId: string;
    enqueued: number;
  }> {
    const enqueued = await step.do(
      'enqueue pending backfill tasks',
      { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' } },
      async () => enqueuePendingTasks(this.env, event.payload.jobId)
    );
    return { jobId: event.payload.jobId, enqueued };
  }
}

export default {
  fetch(request: Request, env: Env, executionCtx: ExecutionContext) {
    return app.fetch(request, env, executionCtx);
  },

  scheduled(controller: ScheduledController, env: Env, executionCtx: ExecutionContext) {
    if (featureEnabled(env, 'ALERT_EVALUATION_ENABLED')) {
      executionCtx.waitUntil(runScheduledAlertEvaluation(env, controller.scheduledTime));
    }
  },

  async queue(batch: MessageBatch<BackfillQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processBackfillMessage(env, message.body);
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            module: 'queue',
            msg: 'backfill message failed',
            taskId: message.body.taskId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        if (error instanceof TerminalBackfillError) {
          message.ack();
        } else {
          message.retry({ delaySeconds: queueRetryDelaySeconds(message.attempts) });
        }
      }
    }
  },
} satisfies ExportedHandler<Env, BackfillQueueMessage>;

function buildPublicHealth(): HealthResponse {
  return {
    status: 'ok',
    api: 'ready',
    database: 'hidden',
    exchanges: exchanges.map((exchange) => exchange.id),
    timestamp: Date.now(),
  };
}

async function buildDeepHealth(env: Env): Promise<HealthResponse & Record<string, unknown>> {
  let cacheReachable = false;
  try {
    if (env.MARKET_DATA_CACHE) {
      const id = env.MARKET_DATA_CACHE.idFromName('bybit');
      const response = await env.MARKET_DATA_CACHE.get(id).fetch('https://cache/health');
      cacheReachable = response.ok;
    }
  } catch {
    cacheReachable = false;
  }

  return {
    status: 'ok',
    api: 'ready',
    database: env.DB ? 'connected' : 'not_configured',
    exchanges: exchanges.map((exchange) => exchange.id),
    timestamp: Date.now(),
    dependencies: {
      liveCache: cacheReachable ? 'ready' : 'unavailable',
      storage: env.DB && env.OHLCV_ARCHIVE ? 'ready' : 'partial',
      backgroundJobs: env.BACKFILL_QUEUE && env.BACKFILL_WORKFLOW ? 'ready' : 'partial',
    },
  };
}

/**
 * Limits Cloudflare Analytics Engine writes to errors, admin/expensive routes,
 * and a small deterministic sample of normal public traffic. This keeps useful
 * operational signals without turning health checks or normal polling into a
 * high-volume usage trail.
 */
function shouldRecordRequestUsage(path: string, status: number, requestId: string): boolean {
  if (status >= 400 || path.includes('/admin/')) {
    return true;
  }
  if (path === '/health' || path === '/api/v1/health' || path === '/api/v1/docs') {
    return false;
  }
  if (routeUsageClass(path) === 'expensive') {
    return stableSample(requestId, 10);
  }
  return stableSample(requestId, 100);
}

/**
 * Logs only abnormal requests and sensitive admin activity. Successful market
 * data polling is intentionally quiet to avoid exposing live usage patterns in
 * Worker logs and to reduce log ingestion volume.
 */
function shouldLogRequest(path: string, status: number): boolean {
  return status >= 400 || path.includes('/admin/');
}

/**
 * Buckets paths before analytics/logging so exact symbols, exchanges, and
 * endpoint-level usage are not exported as high-cardinality Cloudflare fields.
 */
function routeUsageClass(path: string): 'admin' | 'health' | 'expensive' | 'public' {
  if (path === '/health' || path === '/api/v1/health') return 'health';
  return classifyRouteLimit(path).routeClass;
}

function stableSample(value: string, every: number): boolean {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % every === 0;
}

async function requireAccountFeatures(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  if (!featureEnabled(c.env, 'ACCOUNT_FEATURES_ENABLED')) {
    return featureDisabled(c, 'Account features are temporarily disabled');
  }
  return next();
}

function featureDisabled(c: Context<{ Bindings: Env }>, message: string): Response {
  return c.json(featureDisabledEnvelope(message), 503);
}

async function cachedMarketData<T>(
  env: Env,
  resource: 'tickers' | 'markets' | 'funding',
  exchange: SupportedExchange,
  type?: 'spot' | 'perp'
): Promise<{ data: T; meta: Record<string, unknown> }> {
  try {
    if (env.MARKET_DATA_CACHE) {
      const id = env.MARKET_DATA_CACHE.idFromName(exchange);
      const url = new URL(`https://cache/${resource}`);
      url.searchParams.set('exchange', exchange);
      if (resource === 'funding' && type) {
        url.searchParams.set('type', type);
      }
      const response = await env.MARKET_DATA_CACHE.get(id).fetch(url.toString());
      if (response.ok) {
        const payload = (await response.json()) as {
          data: T;
          meta?: Record<string, unknown>;
        };
        return { data: payload.data, meta: payload.meta ?? { source: 'durable-object' } };
      }
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ExchangeError(
        ErrorCode.EXCHANGE_UNAVAILABLE,
        payload.error ?? `Live ${resource} refresh failed`,
        exchange
      );
    }

    if (resource === 'tickers') {
      const tickers = await ccxtService.getAllTickers(exchange);
      return {
        data: (type ? tickers.filter((ticker) => ticker.type === type) : tickers) as T,
        meta: { source: 'exchange' },
      };
    }

    if (resource === 'markets') {
      const markets = await ccxtService.getMarkets(exchange);
      return {
        data: (type ? markets.filter((market) => market.type === type) : markets) as T,
        meta: { source: 'exchange' },
      };
    }

    return {
      data: (await ccxtService.getFundingRates(exchange)) as T,
      meta: { source: 'exchange' },
    };
  } catch (error) {
    if (!isExchangeConnectivityError(error)) {
      throw error;
    }

    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'api',
        msg: 'exchange resource unavailable; returning empty stale payload',
        resource,
        exchange,
        type,
        error: error instanceof Error ? error.message : String(error),
      })
    );

    return {
      data: [] as T,
      meta: {
        source: 'exchange-unavailable',
        stale: true,
        exchange,
        type,
        resource,
        refreshError: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function loadOhlcv(
  env: Env,
  exchange: SupportedExchange,
  symbol: string,
  options: {
    timeframe: Timeframe;
    type: 'spot' | 'perp';
    limit: number;
    since?: number;
    until?: number;
  }
): Promise<{
  candles: OHLCV[];
  meta: {
    source: 'exchange' | 'r2' | 'r2+exchange' | 'live-cache';
    archiveObjects: string[];
    missingArchive: boolean;
    cache?: Record<string, unknown>;
  };
}> {
  if (env.MARKET_DATA_CACHE && options.since === undefined && options.until === undefined) {
    const id = env.MARKET_DATA_CACHE.idFromName(exchange);
    const url = new URL('https://cache/ohlcv');
    url.searchParams.set('exchange', exchange);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('type', options.type);
    url.searchParams.set('timeframe', options.timeframe);
    url.searchParams.set('limit', String(options.limit));
    const response = await env.MARKET_DATA_CACHE.get(id).fetch(url.toString());
    if (response.ok) {
      const payload = (await response.json()) as {
        data: OHLCV[];
        meta?: Record<string, unknown>;
      };
      return {
        candles: payload.data,
        meta: {
          source: 'live-cache',
          archiveObjects: [],
          missingArchive: false,
          cache: payload.meta,
        },
      };
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    return {
      candles: [],
      meta: {
        source: 'live-cache',
        archiveObjects: [],
        missingArchive: false,
        cache: {
          cache: 'miss',
          stale: true,
          refreshError: payload.error ?? 'Live OHLCV refresh failed',
        },
      },
    };
  }

  const archived = options.since
    ? await readArchivedOhlcv(
        env,
        exchange,
        symbol,
        options.type,
        options.timeframe,
        options.since,
        options.until
      )
    : { candles: [], archiveObjects: [], missingArchive: false };
  const shouldFetchLive =
    archived.candles.length < options.limit &&
    (!options.until || options.until > Date.now() - 7 * 24 * 60 * 60 * 1000);
  let liveError: string | undefined;
  const live = shouldFetchLive
    ? await ccxtService
        .fetchOHLCV(exchange, symbol, options.timeframe, options.type, options.limit, options.since)
        .catch((error) => {
          if (!isExchangeConnectivityError(error)) {
            throw error;
          }
          liveError = error instanceof Error ? error.message : String(error);
          return [];
        })
    : [];
  const upper = options.until ?? Number.MAX_SAFE_INTEGER;
  const lower = options.since ?? 0;
  const merged = Array.from(
    new Map([...archived.candles, ...live].map((candle) => [candle.timestamp, candle])).values()
  )
    .filter((candle) => candle.timestamp >= lower && candle.timestamp <= upper)
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    candles: merged.slice(-options.limit),
    meta: {
      source:
        archived.archiveObjects.length > 0 && live.length > 0
          ? 'r2+exchange'
          : archived.archiveObjects.length > 0
            ? 'r2'
            : options.since !== undefined && live.length === 0
              ? 'r2'
              : 'exchange',
      archiveObjects: archived.archiveObjects,
      missingArchive: options.since !== undefined && archived.missingArchive,
      ...(liveError ? { liveError, stale: true } : {}),
    },
  };
}

async function loadOrderBook(
  env: Env,
  exchange: SupportedExchange,
  symbol: string,
  type: 'spot' | 'perp',
  limit: number
): Promise<{ orderbook: OrderBook; meta: Record<string, unknown> }> {
  try {
    if (env.MARKET_DATA_CACHE) {
      const id = env.MARKET_DATA_CACHE.idFromName(exchange);
      const url = new URL('https://cache/orderbook');
      url.searchParams.set('exchange', exchange);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('type', type);
      url.searchParams.set('limit', String(limit));
      const response = await env.MARKET_DATA_CACHE.get(id).fetch(url.toString());
      if (response.ok) {
        const payload = (await response.json()) as {
          data: OrderBook;
          meta?: Record<string, unknown>;
        };
        return { orderbook: payload.data, meta: { source: 'live-cache', cache: payload.meta } };
      }
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ExchangeError(
        ErrorCode.EXCHANGE_UNAVAILABLE,
        payload.error ?? 'Live order book refresh failed',
        exchange
      );
    }

    return {
      orderbook: await ccxtService.fetchOrderBook(exchange, symbol, type, limit),
      meta: { source: 'exchange' },
    };
  } catch (error) {
    if (!isExchangeConnectivityError(error)) {
      throw error;
    }
    return {
      orderbook: {
        symbol,
        exchange,
        type,
        bids: [],
        asks: [],
        timestamp: Date.now(),
      },
      meta: {
        source: 'exchange-unavailable',
        stale: true,
        refreshError: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function isExchangeConnectivityError(error: unknown): boolean {
  if (error instanceof ExchangeError) {
    return (
      error.code === ErrorCode.EXCHANGE_TIMEOUT ||
      error.code === ErrorCode.EXCHANGE_RATE_LIMIT ||
      error.code === ErrorCode.EXCHANGE_UNAVAILABLE ||
      error.code === ErrorCode.EXCHANGE_NETWORK_ERROR
    );
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('network error connecting to exchange') ||
    message.includes('fetch failed') ||
    message.includes('request timeout') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
}

function isInvalidTimeframeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === ErrorCode.VALIDATION_INVALID_TIMEFRAME) ||
    message.includes('Invalid timeframe')
  );
}

function filterTickers(
  tickers: Ticker[],
  options: {
    type?: 'spot' | 'perp';
    quote?: string;
    search?: string;
    sortBy: 'volume' | 'price' | 'change';
    sortOrder: 'asc' | 'desc';
  }
): Ticker[] {
  return tickers
    .filter((ticker) => {
      if (options.type && ticker.type !== options.type) return false;
      if (options.quote && parseSymbol(ticker.symbol).quote !== options.quote) return false;
      if (options.search && !ticker.symbol.toLowerCase().includes(options.search)) return false;
      return true;
    })
    .sort((a, b) => {
      const direction = options.sortOrder === 'asc' ? 1 : -1;
      const left = tickerSortValue(a, options.sortBy);
      const right = tickerSortValue(b, options.sortBy);
      return (left - right) * direction;
    });
}

function tickerSortValue(ticker: Ticker, sortBy: 'volume' | 'price' | 'change'): number {
  if (sortBy === 'price') return ticker.last ?? 0;
  if (sortBy === 'change') return ticker.percentage24h ?? 0;
  return ticker.quoteVolume24h ?? ticker.volume24h ?? 0;
}

function paginate<T>(
  items: T[],
  page: number,
  limit: number
): {
  items: T[];
  pagination: TickersResponse['pagination'];
} {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

function parseOhlcvQuery(
  query: Record<string, string | undefined>,
  symbol: string,
  defaultLimit = 100
): {
  timeframe: Timeframe;
  type: 'spot' | 'perp';
  limit: number;
  since?: number;
  until?: number;
} {
  const parsed = parseOrThrow(ohlcvQuerySchema, { limit: defaultLimit, ...query }, 'query');
  return {
    timeframe: parsed.timeframe,
    type: parseMarketType(parsed.type, symbol),
    limit: parsed.limit,
    since: parsed.since,
    until: parsed.until,
  };
}

function parseMarketType(value: string | undefined, symbol: string): 'spot' | 'perp' {
  const type = validateMarketType(value);
  if (type) return type;
  if (value && value !== 'spot' && value !== 'perp') throw invalidMarketType(value);
  return symbol.endsWith('.P') ? 'perp' : 'spot';
}

function parseInstitutionalAsset(value: string | undefined): InstitutionalAsset {
  const normalized = (value ?? 'BTC').trim().toUpperCase();
  if (normalized === 'BTC' || normalized === 'ETH') return normalized;
  throw invalidParameter('asset', 'asset must be BTC or ETH');
}

function parseInstitutionalRange(value: string | undefined): InstitutionalRange {
  const normalized = (value ?? '30d').trim().toLowerCase();
  if (
    normalized === '30d' ||
    normalized === '90d' ||
    normalized === 'ytd' ||
    normalized === 'all'
  ) {
    return normalized;
  }
  throw invalidParameter('range', 'range must be 30d, 90d, ytd, or all');
}

async function loadInstitutionalMarketInputs(
  env: Env,
  asset: InstitutionalAsset
): Promise<{
  fundingRates: FundingRateData[];
  spotTicker: Ticker | null;
  sourceExchange: SupportedExchange;
}> {
  const symbol = `${asset}-USDT`;
  const sourceExchange: SupportedExchange = 'bybit';

  const [spotTickers, fundingSets] = await Promise.all([
    cachedMarketData<Ticker[]>(env, 'tickers', sourceExchange, 'spot').catch(() => ({
      data: [] as Ticker[],
      meta: {},
    })),
    Promise.all(
      publicFundingExchanges.map(async (exchange) => ({
        exchange,
        rates: (
          await cachedMarketData<FundingRateData[]>(env, 'funding', exchange, 'perp').catch(() => ({
            data: [] as FundingRateData[],
            meta: {},
          }))
        ).data.filter((rate) => rate.baseAsset === asset),
      }))
    ),
  ]);

  return {
    fundingRates: fundingSets.flatMap((item) => item.rates),
    spotTicker: spotTickers.data.find((ticker) => ticker.symbol === symbol) ?? null,
    sourceExchange,
  };
}

async function cachedInstitutionalData<T>(
  env: Env,
  kind: 'options-chain' | 'options-expiries' | 'options-volatility',
  asset: InstitutionalAsset,
  options: {
    range?: InstitutionalRange;
    expiry?: string;
    fallback: () => Promise<T>;
  }
): Promise<{ data: T; meta: Record<string, unknown> }> {
  if (env.MARKET_DATA_CACHE) {
    const id = env.MARKET_DATA_CACHE.idFromName('institutional');
    const url = new URL('https://cache/institutional');
    url.searchParams.set('kind', kind);
    url.searchParams.set('asset', asset);
    if (options.range) url.searchParams.set('range', options.range);
    if (options.expiry) url.searchParams.set('expiry', options.expiry);
    const response = await env.MARKET_DATA_CACHE.get(id).fetch(url.toString());
    if (response.ok) {
      const payload = (await response.json()) as {
        data: T;
        meta?: Record<string, unknown>;
      };
      return {
        data: payload.data,
        meta: { source: 'durable-object', cache: payload.meta },
      };
    }
  }

  return {
    data: await options.fallback(),
    meta: { source: 'institutional-adapters' },
  };
}

function parsePeriods(value: string | undefined, fallback: readonly number[]): number[] {
  if (!value) {
    return [...fallback];
  }
  return value
    .split(',')
    .map((item) => validateInteger(item, 0, 1, 500))
    .filter((item) => item > 0);
}

function buildIndexPerformance(
  series: Array<{ asset: { symbol: string; weight: number }; candles: OHLCV[] }>,
  weightTotal: number
): IndexPerformancePoint[] {
  const timestamps = series[0]?.candles.map((candle) => candle.timestamp) ?? [];
  return timestamps.flatMap((timestamp) => {
    let value = 0;
    for (const item of series) {
      const candle = item.candles.find((candidate) => candidate.timestamp === timestamp);
      const first = item.candles[0];
      if (!candle || !first || first.close === 0) {
        return [];
      }
      value += (item.asset.weight / weightTotal) * (candle.close / first.close) * 100;
    }
    return [{ timestamp, value, change: value - 100 }];
  });
}

async function buildBenchmarks(
  env: Env,
  exchange: SupportedExchange,
  timeframe: Timeframe,
  limit: number
): Promise<CustomIndexResponse['benchmarks']> {
  const symbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];
  return Promise.all(
    symbols.map(async (symbol) => {
      const candles = (await loadOhlcv(env, exchange, symbol, { timeframe, type: 'spot', limit }))
        .candles;
      const first = candles[0]?.close || 1;
      return {
        symbol,
        name: parseSymbol(symbol).base,
        data: candles.map((candle) => ({
          timestamp: candle.timestamp,
          value: (candle.close / first) * 100,
          change: (candle.close / first) * 100 - 100,
        })),
      };
    })
  );
}

function buildAltScreener(
  exchange: SupportedExchange,
  tickers: Ticker[],
  options: {
    base: 'USD' | 'BTC' | 'ETH' | 'SOL';
    period: '1h' | '4h' | '24h' | '7d' | '30d';
    sortBy: 'performance' | 'volume' | 'name' | 'price';
    sortOrder: 'asc' | 'desc';
    limit: number;
    minVolume?: number;
    maxVolume?: number;
    minChange?: number;
    maxChange?: number;
    minFundingRate?: number;
    maxFundingRate?: number;
    minOpenInterest?: number;
    search?: string;
  }
): AltScreenerResponse {
  const basePrices = getBasePrices(tickers);
  const basePrice = basePrices[options.base];
  const candidates = tickers
    .filter((ticker) => {
      const parsed = parseSymbol(ticker.symbol);
      if (parsed.base === 'BTC') return false;
      if (parsed.quote && !['USDT', 'USD', 'USDC'].includes(parsed.quote)) return false;
      if (options.search && !ticker.symbol.toLowerCase().includes(options.search)) return false;
      const volume = ticker.quoteVolume24h ?? ticker.volume24h ?? 0;
      if (options.minVolume !== undefined && volume < options.minVolume) return false;
      if (options.maxVolume !== undefined && volume > options.maxVolume) return false;
      const change = ticker.percentage24h ?? 0;
      if (options.minChange !== undefined && change < options.minChange) return false;
      if (options.maxChange !== undefined && change > options.maxChange) return false;
      const funding =
        ticker.fundingRate !== undefined && ticker.fundingRate !== null
          ? ticker.fundingRate * 100
          : null;
      if (
        options.minFundingRate !== undefined &&
        (funding === null || funding < options.minFundingRate)
      ) {
        return false;
      }
      if (
        options.maxFundingRate !== undefined &&
        (funding === null || funding > options.maxFundingRate)
      ) {
        return false;
      }
      const openInterest = ticker.openInterest ?? null;
      if (
        options.minOpenInterest !== undefined &&
        (openInterest === null || openInterest < options.minOpenInterest)
      ) {
        return false;
      }
      return true;
    })
    .map<AltcoinPerformance>((ticker) => {
      const parsed = parseSymbol(ticker.symbol);
      const price = ticker.last ?? 0;
      return {
        symbol: ticker.symbol,
        base: parsed.base,
        quote: parsed.quote,
        exchange,
        type: ticker.type,
        price,
        priceInBase: basePrice ? price / basePrice : price,
        change1h: ticker.percentage24h,
        change4h: ticker.percentage24h,
        change24h: ticker.percentage24h,
        change7d: null,
        volume24h: ticker.quoteVolume24h ?? ticker.volume24h,
        high24h: ticker.high24h,
        low24h: ticker.low24h,
        ohlcv: [],
        derivatives: {
          fundingRatePercent:
            ticker.fundingRate !== undefined && ticker.fundingRate !== null
              ? ticker.fundingRate * 100
              : null,
          openInterestUsd: ticker.openInterest ?? null,
        },
        timestamp: ticker.timestamp,
      };
    });
  const topGainer =
    [...candidates].sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity))[0]
      ?.symbol ?? '';
  const topLoser =
    [...candidates].sort((a, b) => (a.change24h ?? Infinity) - (b.change24h ?? Infinity))[0]
      ?.symbol ?? '';
  const altcoins = candidates
    .sort((a, b) => {
      const direction = options.sortOrder === 'asc' ? 1 : -1;
      if (options.sortBy === 'name') return a.symbol.localeCompare(b.symbol) * direction;
      if (options.sortBy === 'price') return (a.price - b.price) * direction;
      if (options.sortBy === 'volume') return ((a.volume24h ?? 0) - (b.volume24h ?? 0)) * direction;
      return ((a.change24h ?? 0) - (b.change24h ?? 0)) * direction;
    })
    .slice(0, options.limit)
    .map((altcoin, index) => ({ ...altcoin, rank: index + 1 }));

  const gainers = altcoins.filter((coin) => (coin.change24h ?? 0) > 0).length;
  const losers = altcoins.filter((coin) => (coin.change24h ?? 0) < 0).length;
  const avgChange =
    altcoins.reduce((sum, coin) => sum + (coin.change24h ?? 0), 0) / Math.max(1, altcoins.length);

  return {
    exchange,
    baseCurrency: options.base,
    basePrice,
    basePrices,
    period: options.period,
    altcoins,
    count: altcoins.length,
    timestamp: Date.now(),
    stats: {
      totalAltcoins: altcoins.length,
      gainers,
      losers,
      avgChange,
      topGainer,
      topLoser,
    },
  };
}

function shouldRunTechnicalScreener(query: Record<string, string | undefined>): boolean {
  return (
    query.minRsi !== undefined ||
    query.maxRsi !== undefined ||
    query.breakout === 'up' ||
    query.breakout === 'down' ||
    query.breakout === 'any'
  );
}

async function enrichScreenerTechnicals(
  env: Env,
  exchange: SupportedExchange,
  response: AltScreenerResponse,
  options: {
    type: 'spot' | 'perp';
    minRsi?: number;
    maxRsi?: number;
    breakout?: 'up' | 'down' | 'any';
    limit: number;
  }
): Promise<AltScreenerResponse> {
  const enriched = await mapWithConcurrency(response.altcoins, 5, async (altcoin) => {
    const candles = await loadOhlcv(env, exchange, altcoin.symbol, {
      timeframe: '1d',
      type: options.type,
      limit: 40,
    }).catch(() => ({ candles: [] as OHLCV[] }));
    const closes = candles.candles.map((candle) => candle.close);
    const rsi14 = calculateWilderRsi(closes, 14);
    const ema20 = calculateLastEma(closes, 20);
    const last = closes[closes.length - 1] ?? altcoin.price;
    const high24h = altcoin.high24h ?? Number.POSITIVE_INFINITY;
    const low24h = altcoin.low24h ?? 0;
    const breakout: NonNullable<AltcoinPerformance['technical']>['breakout'] =
      last >= high24h * 0.995 ? '24h-high' : last <= low24h * 1.005 ? '24h-low' : 'none';
    const trend: NonNullable<AltcoinPerformance['technical']>['trend'] =
      ema20 === null ? 'unknown' : last >= ema20 ? 'above-ema20' : 'below-ema20';

    return {
      ...altcoin,
      technical: {
        rsi14,
        breakout,
        trend,
      },
    };
  });

  const filtered = enriched
    .filter((altcoin) => {
      const rsi14 = altcoin.technical?.rsi14;
      if (
        options.minRsi !== undefined &&
        (rsi14 === null || rsi14 === undefined || rsi14 < options.minRsi)
      ) {
        return false;
      }
      if (
        options.maxRsi !== undefined &&
        (rsi14 === null || rsi14 === undefined || rsi14 > options.maxRsi)
      ) {
        return false;
      }
      if (options.breakout === 'up' && altcoin.technical?.breakout !== '24h-high') return false;
      if (options.breakout === 'down' && altcoin.technical?.breakout !== '24h-low') return false;
      if (options.breakout === 'any' && altcoin.technical?.breakout === 'none') return false;
      return true;
    })
    .slice(0, options.limit)
    .map((altcoin, index) => ({ ...altcoin, rank: index + 1 }));

  return {
    ...response,
    altcoins: filtered,
    count: filtered.length,
    stats: {
      ...response.stats,
      totalAltcoins: filtered.length,
      gainers: filtered.filter((coin) => (coin.change24h ?? 0) > 0).length,
      losers: filtered.filter((coin) => (coin.change24h ?? 0) < 0).length,
      avgChange:
        filtered.reduce((sum, coin) => sum + (coin.change24h ?? 0), 0) /
        Math.max(1, filtered.length),
      topGainer:
        [...filtered].sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity))[0]
          ?.symbol ?? '',
      topLoser:
        [...filtered].sort((a, b) => (a.change24h ?? Infinity) - (b.change24h ?? Infinity))[0]
          ?.symbol ?? '',
    },
  };
}

async function buildTrendingVolumeSpike(
  env: Env,
  exchange: SupportedExchange,
  ticker: Ticker,
  type: 'spot' | 'perp'
): Promise<TrendingVolumeSpike | null> {
  try {
    const candles = (
      await loadOhlcv(env, exchange, ticker.symbol, {
        timeframe: '1d',
        type,
        limit: 8,
      })
    ).candles;
    const historical = candles.slice(0, -1);
    const averageVolume =
      historical.length > 0
        ? historical.reduce((sum, candle) => sum + candle.volume * candle.close, 0) /
          historical.length
        : null;
    const volume24h =
      ticker.quoteVolume24h ??
      (ticker.volume24h !== null && ticker.last !== null ? ticker.volume24h * ticker.last : null);
    const ratio =
      averageVolume && volume24h && averageVolume > 0 ? volume24h / averageVolume : null;
    const change = ticker.percentage24h ?? 0;
    const score = Math.round(
      (Math.min(5, ratio ?? 0) / 5) * 70 + Math.min(30, Math.abs(change)) * 1
    );

    return {
      symbol: ticker.symbol,
      exchange,
      type,
      price: ticker.last,
      change24h: ticker.percentage24h,
      volume24h,
      sevenDayAverageVolume: averageVolume,
      volumeRatio24hVs7d: ratio,
      score,
    };
  } catch (error) {
    if (!isExchangeConnectivityError(error) && !isInvalidTimeframeError(error)) {
      throw error;
    }
    return null;
  }
}

function calculateLastEma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / Math.max(1, period);
  for (let index = period; index < values.length; index += 1) {
    current = ((values[index] ?? current) - current) * multiplier + current;
  }
  return current;
}

function getBasePrices(tickers: Ticker[]): BaseCurrencyPrices {
  const findPrice = (symbol: string) =>
    tickers.find((ticker) => ticker.symbol === symbol)?.last ?? 0;
  return {
    USD: 1,
    BTC: findPrice('BTC-USDT') || 1,
    ETH: findPrice('ETH-USDT') || 1,
    SOL: findPrice('SOL-USDT') || 1,
  };
}

function buildFundingStats(rates: FundingRateData[]): FundingMarketStats {
  const sorted = [...rates].sort((a, b) => b.fundingRate - a.fundingRate);
  const avgFundingRate =
    rates.reduce((sum, rate) => sum + rate.fundingRate, 0) / Math.max(1, rates.length);
  const positiveCount = rates.filter((rate) => rate.fundingRate > 0.00001).length;
  const negativeCount = rates.filter((rate) => rate.fundingRate < -0.00001).length;

  return {
    totalPairs: rates.length,
    positiveCount,
    negativeCount,
    neutralCount: rates.length - positiveCount - negativeCount,
    avgFundingRate,
    avgFundingPercent: avgFundingRate * 100,
    marketSentiment:
      avgFundingRate > 0.0005
        ? 'extremely_bullish'
        : avgFundingRate > 0.0001
          ? 'bullish'
          : avgFundingRate < -0.0005
            ? 'extremely_bearish'
            : avgFundingRate < -0.0001
              ? 'bearish'
              : 'neutral',
    highestFunding: {
      symbol: sorted[0]?.symbol ?? '',
      rate: sorted[0]?.fundingRate ?? 0,
      percent: sorted[0]?.fundingRatePercent ?? 0,
    },
    lowestFunding: {
      symbol: sorted[sorted.length - 1]?.symbol ?? '',
      rate: sorted[sorted.length - 1]?.fundingRate ?? 0,
      percent: sorted[sorted.length - 1]?.fundingRatePercent ?? 0,
    },
  };
}

function buildFundingComparison(
  inputs: Array<{ exchange: string; rates: FundingRateData[] }>,
  limit: number
): CrossExchangeFundingResponse {
  const byAsset = new Map<string, CrossExchangeFunding['rates']>();

  for (const input of inputs) {
    for (const rate of input.rates) {
      const rates = byAsset.get(rate.baseAsset) ?? [];
      rates.push({
        exchange: input.exchange,
        symbol: rate.symbol,
        fundingRate: rate.fundingRate,
        fundingRatePercent: rate.fundingRatePercent,
        annualizedRate: rate.annualizedRate,
        markPrice: rate.markPrice,
      });
      byAsset.set(rate.baseAsset, rates);
    }
  }

  const comparisons = Array.from(byAsset.entries())
    .filter(([, rates]) => rates.length > 1)
    .map<CrossExchangeFunding>(([baseAsset, rates]) => {
      const sorted = [...rates].sort((a, b) => a.fundingRate - b.fundingRate);
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const spread = max.fundingRate - min.fundingRate;
      return {
        baseAsset,
        rates,
        spread,
        maxExchange: max.exchange,
        minExchange: min.exchange,
        arbitrageOpportunity: spread > 0.0002,
      };
    })
    .sort((a, b) => b.spread - a.spread)
    .slice(0, limit);

  return {
    comparisons,
    count: comparisons.length,
    exchanges: inputs.map((input) => input.exchange),
    timestamp: Date.now(),
    arbitrageOpportunities: comparisons
      .filter((item) => item.arbitrageOpportunity)
      .slice(0, 20)
      .map((item) => ({
        asset: item.baseAsset,
        spread: item.spread,
        longExchange: item.minExchange,
        shortExchange: item.maxExchange,
        estimatedDailyYield: item.spread * 3 * 100,
      })),
  };
}

function sortFundingRates(
  rates: FundingRateData[],
  sortBy: string,
  sortOrder: 'asc' | 'desc'
): FundingRateData[] {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return [...rates].sort((a, b) => {
    if (sortBy === 'volume') return ((a.volume24h ?? 0) - (b.volume24h ?? 0)) * direction;
    if (sortBy === 'openInterest')
      return ((a.openInterest ?? 0) - (b.openInterest ?? 0)) * direction;
    return (a.fundingRate - b.fundingRate) * direction;
  });
}

function parseBaseCurrency(value: string | undefined): 'USD' | 'BTC' | 'ETH' | 'SOL' {
  return value === 'BTC' || value === 'ETH' || value === 'SOL' ? value : 'USD';
}

function parsePerformancePeriod(value: string | undefined): '1h' | '4h' | '24h' | '7d' | '30d' {
  return value === '1h' || value === '4h' || value === '7d' || value === '30d' ? value : '24h';
}

function parseScreenerSort(value: string | undefined): 'performance' | 'volume' | 'name' | 'price' {
  return value === 'volume' || value === 'name' || value === 'price' ? value : 'performance';
}

function parseStrategyDefinition(body: unknown): StrategyDefinition {
  const source = isRecord(body) && isRecord(body.strategy) ? body.strategy : body;
  const mode = readString(source, 'mode');
  const parsedMode =
    mode === 'mean-reversion' || mode === 'breakout' || mode === 'momentum' ? mode : 'momentum';
  const fallback = defaultStrategyDefinition(parsedMode);
  const strategy: StrategyDefinition = {
    id: readString(source, 'id') ?? fallback.id,
    name: readString(source, 'name') ?? fallback.name,
    mode: parsedMode,
    fastPeriod: readBoundedNumber(source, 'fastPeriod', fallback.fastPeriod, 2, 200),
    slowPeriod: readBoundedNumber(source, 'slowPeriod', fallback.slowPeriod, 3, 400),
    rsiPeriod: readBoundedNumber(source, 'rsiPeriod', fallback.rsiPeriod, 2, 100),
    rsiOversold: readBoundedNumber(source, 'rsiOversold', fallback.rsiOversold, 1, 50),
    rsiOverbought: readBoundedNumber(source, 'rsiOverbought', fallback.rsiOverbought, 50, 99),
    feeBps: readBoundedNumber(source, 'feeBps', fallback.feeBps, 0, 100),
  };

  if (strategy.fastPeriod >= strategy.slowPeriod) {
    throw invalidParameter('strategy', 'fastPeriod must be lower than slowPeriod');
  }
  if (strategy.rsiOversold >= strategy.rsiOverbought) {
    throw invalidParameter('strategy', 'rsiOversold must be lower than rsiOverbought');
  }

  return strategy;
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[key];
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function readBoundedNumber(
  value: unknown,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = readString(value, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw invalidParameter(key, `${key} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => ({}))) as unknown;
  if (!isRecord(body)) {
    throw invalidParameter('body', 'JSON object body is required');
  }
  return body;
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const raw = value[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw invalidParameter(key, `${key} is required`);
  }
  return raw.trim();
}

async function requireUser(env: Env, authorization: string | null): Promise<UserAccount> {
  try {
    return await readUserFromSession(env, authorization);
  } catch (error) {
    throw invalidParameter(
      'authorization',
      error instanceof Error ? error.message : 'Valid bearer session is required'
    );
  }
}

function parsePasskeyRegistrationInput(
  body: Record<string, unknown>
): VerifyPasskeyRegistrationInput {
  const response = body.response;
  if (!isRecord(response)) {
    throw invalidParameter('response', 'response must be a WebAuthn registration object');
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
  return {
    challengeId: readRequiredString(body, 'challengeId'),
    response: response as unknown as VerifyPasskeyRegistrationInput['response'],
    name,
  };
}

function parsePasskeyAuthenticationOptions(
  body: Record<string, unknown>
): CreatePasskeyAuthenticationOptionsInput {
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : undefined;
  return { email };
}

function parsePasskeyAuthenticationInput(
  body: Record<string, unknown>
): VerifyPasskeyAuthenticationInput {
  const response = body.response;
  if (!isRecord(response)) {
    throw invalidParameter('response', 'response must be a WebAuthn authentication object');
  }
  return {
    challengeId: readRequiredString(body, 'challengeId'),
    response: response as unknown as VerifyPasskeyAuthenticationInput['response'],
  };
}

function parseWorkspaceInput(body: Record<string, unknown>): SaveWorkspaceInput {
  const state = body.state;
  if (!isRecord(state)) {
    throw invalidParameter('state', 'state must be an object');
  }
  return {
    name: readRequiredString(body, 'name'),
    state,
    isDefault: body.isDefault === true,
  };
}

function parseWatchlistInput(body: Record<string, unknown>): SaveWatchlistInput {
  if (!Array.isArray(body.items)) {
    throw invalidParameter('items', 'items must be an array of symbols');
  }
  return {
    name: readRequiredString(body, 'name'),
    items: body.items.filter((item): item is string => typeof item === 'string'),
  };
}

function parseSavedBacktestInput(body: Record<string, unknown>): SaveBacktestInput {
  if (!isRecord(body.strategy)) {
    throw invalidParameter('strategy', 'strategy must be an object');
  }
  if (body.result !== undefined && body.result !== null && !isRecord(body.result)) {
    throw invalidParameter('result', 'result must be an object when provided');
  }
  return {
    name: readRequiredString(body, 'name'),
    exchange: requireExchange(readRequiredString(body, 'exchange')),
    symbol: parseOrThrow(symbolSchema, readRequiredString(body, 'symbol'), 'symbol'),
    timeframe: parseTimeframeString(readRequiredString(body, 'timeframe')),
    strategy: body.strategy,
    result: body.result === undefined || body.result === null ? null : body.result,
  };
}

function parseSignalLabStrategyInput(body: Record<string, unknown>): SaveSignalLabStrategyInput {
  const symbol = parseOrThrow(symbolSchema, readRequiredString(body, 'symbol'), 'symbol');
  return {
    name: readRequiredString(body, 'name'),
    exchange: requireExchange(readRequiredString(body, 'exchange')),
    symbol,
    marketType: parseMarketType(
      typeof body.marketType === 'string' ? body.marketType : undefined,
      symbol
    ),
    timeframe: parseTimeframeString(readRequiredString(body, 'timeframe')),
    strategy: parseStrategyDefinition(body),
  };
}

function parsePriceAlertInput(body: Record<string, unknown>): CreatePriceAlertInput {
  const condition = readRequiredString(body, 'condition');
  if (condition !== 'above' && condition !== 'below') {
    throw invalidParameter('condition', 'condition must be above or below');
  }
  const priceTarget = Number(body.priceTarget);
  if (!Number.isFinite(priceTarget) || priceTarget <= 0) {
    throw invalidParameter('priceTarget', 'priceTarget must be a positive number');
  }
  const symbol = parseOrThrow(symbolSchema, readRequiredString(body, 'symbol'), 'symbol');
  const marketType = parseMarketType(
    typeof body.marketType === 'string' ? body.marketType : undefined,
    symbol
  );
  return {
    symbol,
    exchange: requireExchange(readRequiredString(body, 'exchange')),
    marketType,
    priceTarget,
    condition,
    delivery: isRecord(body.delivery) ? body.delivery : null,
    metadata: isRecord(body.metadata) ? body.metadata : null,
  };
}

function parseTimeframeString(value: string): Timeframe {
  if (
    value === '1m' ||
    value === '5m' ||
    value === '15m' ||
    value === '1h' ||
    value === '4h' ||
    value === '1d' ||
    value === '3d' ||
    value === '1w'
  ) {
    return value;
  }
  throw invalidParameter('timeframe', 'Invalid timeframe');
}

async function evaluateUserAlerts(
  env: Env,
  userId: string
): Promise<{ evaluated: number; triggered: number; events: string[] }> {
  const alerts = (await listPriceAlerts(env, userId)).filter((alert) => alert.active);
  return evaluateActiveAlerts(env, alerts);
}

async function runSignalLabBacktest(
  env: Env,
  input: SaveSignalLabStrategyInput
): Promise<BacktestResponse> {
  const candles = (
    await loadOhlcv(env, input.exchange as SupportedExchange, input.symbol, {
      timeframe: input.timeframe as Timeframe,
      type: input.marketType,
      limit: 500,
    })
  ).candles;
  return runBacktest({
    exchange: input.exchange as SupportedExchange,
    symbol: input.symbol,
    type: input.marketType,
    timeframe: input.timeframe as Timeframe,
    candles,
    strategy: input.strategy,
  });
}

async function runScheduledAlertEvaluation(
  env: Env,
  scheduledTime: number
): Promise<{ evaluated: number; triggered: number; events: string[] }> {
  if (!env.DB) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'alerts',
        msg: 'scheduled alert evaluation skipped because D1 is unavailable',
        scheduledTime,
      })
    );
    return { evaluated: 0, triggered: 0, events: [] };
  }

  const result = await evaluateActiveAlerts(env, await listDuePriceAlerts(env, 500));
  console.log(
    JSON.stringify({
      level: 'info',
      module: 'alerts',
      msg: 'scheduled alert evaluation complete',
      scheduledTime,
      evaluated: result.evaluated,
      triggered: result.triggered,
    })
  );
  return result;
}

async function evaluateActiveAlerts(
  env: Env,
  alerts: Array<Awaited<ReturnType<typeof listPriceAlerts>>[number]>
): Promise<{ evaluated: number; triggered: number; events: string[] }> {
  const tickerCache = new Map<string, Ticker[]>();
  const events: string[] = [];
  let evaluated = 0;

  for (const alert of alerts) {
    if (!alert.active) continue;
    const cacheKey = `${alert.exchange}:${alert.marketType}`;
    let tickers = tickerCache.get(cacheKey);
    if (!tickers) {
      tickers = (
        await cachedMarketData<Ticker[]>(
          env,
          'tickers',
          alert.exchange as SupportedExchange,
          alert.marketType
        )
      ).data;
      tickerCache.set(cacheKey, tickers);
    }
    const ticker = tickers.find((item) => item.symbol === alert.symbol);
    const currentPrice = ticker?.last ?? null;
    if (currentPrice === null) continue;
    evaluated += 1;
    const result = await evaluateAlertTrigger(env, { alert, currentPrice });
    if (result.eventId) events.push(result.eventId);
  }

  return { evaluated, triggered: events.length, events };
}

async function buildAlphaFeed(
  env: Env,
  exchange: SupportedExchange,
  limit: number
): Promise<AlphaFeedResponse> {
  const [trendingResult, arbitrageResult, fundingResult] = await Promise.all([
    cachedMarketData<Ticker[]>(env, 'tickers', exchange, 'spot').then(async ({ data }) => {
      const candidates = data
        .filter((ticker) => (ticker.quoteVolume24h ?? 0) > 0 && ticker.last !== null)
        .sort((a, b) => Math.abs(b.percentage24h ?? 0) - Math.abs(a.percentage24h ?? 0))
        .slice(0, 8);
      return candidates.map<AlphaFeedItem>((ticker, index) => ({
        id: `trend:${exchange}:${ticker.symbol}:${index}`,
        kind: 'trending',
        title: `${ticker.symbol} ${formatSignedPercent(ticker.percentage24h)} in 24h`,
        summary: `Live ${exchange} spot move with ${formatUsd(ticker.quoteVolume24h ?? ticker.volume24h)} 24h volume.`,
        score: Math.min(100, Math.abs(ticker.percentage24h ?? 0) * 3 + index),
        href: `/markets/${exchange}/${encodeURIComponent(ticker.symbol)}`,
        payload: {
          exchange,
          symbol: ticker.symbol,
          price: ticker.last,
          change24h: ticker.percentage24h,
          volume24h: ticker.quoteVolume24h ?? ticker.volume24h,
        },
        timestamp: Date.now(),
      }));
    }),
    Promise.all(
      exchanges
        .filter((item) => item.supported && item.hasSpot)
        .map(async (item) => ({
          exchange: item.id as SupportedExchange,
          tickers: (
            await cachedMarketData<Ticker[]>(env, 'tickers', item.id as SupportedExchange, 'spot')
          ).data,
        }))
    ).then((sets) =>
      buildPriceArbitrageResponse(sets, {
        type: 'spot',
        quote: 'USDT',
        minSpreadBps: 10,
        limit: 6,
      }).opportunities.map<AlphaFeedItem>((item, index) => ({
        id: `price-arb:${item.asset}:${index}`,
        kind: 'price-arbitrage',
        title: `${item.asset} spread: ${item.spreadBps.toFixed(1)} bps`,
        summary: `Buy ${item.bestBuyExchange}, sell ${item.bestSellExchange} from live exchange quotes.`,
        score: Math.min(100, item.spreadBps),
        href: '/price-arbitrage',
        payload: item as unknown as Record<string, unknown>,
        timestamp: item.timestamp,
      }))
    ),
    Promise.all(
      publicFundingExchanges.map(async (item) => ({
        exchange: item,
        rates: (
          await cachedMarketData<FundingRateData[]>(env, 'funding', item, 'perp').catch(() => ({
            data: [] as FundingRateData[],
            meta: {},
          }))
        ).data,
      }))
    ).then((inputs) =>
      buildFundingArbitrage(inputs, 6, 12).opportunities.map<AlphaFeedItem>((item, index) => ({
        id: `funding-arb:${item.asset}:${index}`,
        kind: 'funding-arbitrage',
        title: `${item.asset} funding carry`,
        summary: `${item.longExchange} vs ${item.shortExchange}, net annualized ${item.netAnnualizedYield.toFixed(2)}%.`,
        score: Math.min(100, Math.abs(item.netAnnualizedYield)),
        href: '/funding-arbitrage',
        payload: item as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      }))
    ),
  ]);

  const generatedItems = [...trendingResult, ...arbitrageResult, ...fundingResult]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const items = await persistAlphaFeedEvents(env, generatedItems);
  return {
    items,
    count: items.length,
    timestamp: Date.now(),
  };
}

interface AlphaFeedEventRow {
  id: string;
  kind: AlphaFeedItem['kind'];
  title: string;
  summary: string;
  score: number;
  payload_json: string;
  created_at: number;
}

async function persistAlphaFeedEvents(env: Env, items: AlphaFeedItem[]): Promise<AlphaFeedItem[]> {
  if (!env.DB || items.length === 0) return items;
  const persisted = items.map((item) => {
    const id = alphaFeedEventId(item);
    return { ...item, id, timestamp: Date.now() };
  });

  try {
    await env.DB.batch(
      persisted.map((storedItem, index) => {
        const sourceItem = items[index]!;
        const payloadJson = JSON.stringify({
          href: storedItem.href,
          payload: storedItem.payload,
          sourceId: sourceItem.id,
        });
        return env.DB.prepare(
          `INSERT INTO alpha_feed_events
          (id, kind, title, summary, score, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           title = excluded.title,
           summary = excluded.summary,
           score = excluded.score,
           payload_json = excluded.payload_json
         WHERE alpha_feed_events.kind <> excluded.kind
            OR alpha_feed_events.title <> excluded.title
            OR alpha_feed_events.summary <> excluded.summary
            OR alpha_feed_events.score <> excluded.score
            OR alpha_feed_events.payload_json <> excluded.payload_json`
        ).bind(
          storedItem.id,
          storedItem.kind,
          storedItem.title,
          storedItem.summary,
          storedItem.score,
          payloadJson
        );
      })
    );
    return persisted;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'alpha-feed',
        msg: 'failed to persist alpha feed batch',
        count: items.length,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return items;
  }
}

async function readAlphaFeedEvent(env: Env, id: string): Promise<AlphaFeedItem | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT * FROM alpha_feed_events WHERE id = ?`)
    .bind(id)
    .first<AlphaFeedEventRow>();
  return row ? mapAlphaFeedEvent(row) : null;
}

function mapAlphaFeedEvent(row: AlphaFeedEventRow): AlphaFeedItem {
  const payload = parseAlphaFeedPayload(row.payload_json);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    score: row.score,
    href: typeof payload.href === 'string' ? payload.href : '/alpha-feed',
    payload: isRecord(payload.payload) ? payload.payload : payload,
    timestamp: row.created_at * 1000,
  };
}

function parseAlphaFeedPayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function alphaFeedEventId(item: AlphaFeedItem): string {
  const payload = item.payload;
  const exchange = typeof payload.exchange === 'string' ? payload.exchange : 'cross';
  const symbol =
    typeof payload.symbol === 'string'
      ? payload.symbol
      : typeof payload.asset === 'string'
        ? payload.asset
        : slugify(item.title);
  return `${item.kind}:${exchange}:${slugify(symbol)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatSignedPercent(value: number | null): string {
  const normalized = value ?? 0;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)}`;
}

function periodToTimeframe(period: string | undefined): Timeframe {
  if (period === '1h') return '1m';
  if (period === '4h') return '5m';
  if (period === '7d' || period === '30d') return '1d';
  return '1h';
}

function requireExchange(value: string): SupportedExchange {
  const exchange = validateExchange(value);
  if (!exchange) {
    throw invalidExchange(value);
  }
  return exchange;
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await mapper(item, index);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => worker())
  );
  return results;
}

function ok<T>(
  c: { json: (value: unknown) => Response; res: { headers: Headers } },
  data: T,
  meta?: Record<string, unknown>
) {
  const requestId = c.res.headers.get('X-Request-ID') ?? undefined;
  const body = meta
    ? { ...successResponse(data), meta: { requestId, ...meta } }
    : { ...successResponse(data), meta: { requestId } };
  return c.json(body);
}
