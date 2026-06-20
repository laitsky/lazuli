/**
 * Lazuli API Worker (Cloudflare Workers + Hono)
 *
 * Cloudflare-only runtime entrypoint. The public API reads through Durable
 * Object-backed live caches where possible, uses D1/R2 for historical backfill
 * metadata and archives, and exposes a Queue consumer plus Workflow definition
 * for 2019-2020 OHLCV backfills.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type {
  AltcoinPerformance,
  AltScreenerResponse,
  BaseCurrencyPrices,
  CrossExchangeFunding,
  CrossExchangeFundingResponse,
  CustomIndexRequest,
  CustomIndexResponse,
  CustomPairResponse,
  FundingMarketStats,
  FundingRateData,
  FundingRateResponse,
  HealthResponse,
  IndexPerformancePoint,
  Market,
  MarketsResponse,
  OHLCVResponse,
  OrderBookResponse,
  SupportedExchange,
  Ticker,
  TickersResponse,
  Timeframe,
} from '@lazuli/shared';
import { DEFAULT_INDICATOR_PERIODS } from '@lazuli/shared';
import type { BackfillQueueMessage, BackfillWorkflowParams, Env, OHLCV } from './types';
import {
  ExchangeError,
  invalidExchange,
  invalidMarketType,
  invalidParameter,
  invalidTimeframe,
  tickerNotFound,
  unauthorized,
} from './errors';
import { handleError, successResponse } from './utils/response';
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
import { ccxtService } from './services/ccxtService';
import { calculateSelectedEMAs, calculateSuperEMA } from './services/emaService';
import { calculateIndicators } from './services/technicalIndicatorService';
import {
  createBackfillJob,
  enqueuePendingTasks,
  getBackfillJob,
  processBackfillMessage,
  readArchivedOhlcv,
  TerminalBackfillError,
} from './services/backfillService';

export { MarketDataCacheDO } from './services/MarketDataCacheDO';
export { RateLimiterDO } from './services/RateLimiterDO';

const exchanges = [
  { name: 'Bybit', id: 'bybit', supported: true, hasSpot: true, hasPerp: true },
  { name: 'OKX', id: 'okx', supported: true, hasSpot: true, hasPerp: true },
  { name: 'Hyperliquid', id: 'hyperliquid', supported: true, hasSpot: false, hasPerp: true },
  { name: 'Upbit', id: 'upbit', supported: true, hasSpot: true, hasPerp: false },
  { name: 'Binance', id: 'binance', supported: false, hasSpot: true, hasPerp: true },
] as const;

const supportedTimeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'];
const publicFundingExchanges: SupportedExchange[] = ['binance', 'bybit', 'okx', 'hyperliquid'];

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = c.env.CORS_ORIGIN?.split(',')
        .map((item: string) => item.trim())
        .filter(Boolean);
      if (!allowed || allowed.length === 0) {
        return origin;
      }
      return origin && allowed.includes(origin) ? origin : allowed[0]!;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-API-Key'],
    credentials: true,
    maxAge: 86400,
  })
);

app.use('*', async (c, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  c.header('X-Request-ID', requestId);

  await next();

  c.env.API_ANALYTICS?.writeDataPoint({
    blobs: [c.req.method, c.req.path, c.res.status.toString(), requestId],
    doubles: [Date.now() - startedAt],
    indexes: [c.req.path],
  });

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'api',
      msg: 'request complete',
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    })
  );
});

app.get('/', (c) => c.redirect('/api/v1/docs'));

app.get('/health', async (c) => c.json(successResponse(await buildHealth(c.env))));

const api = new Hono<{ Bindings: Env }>();

api.get('/docs', (c) =>
  c.html(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Lazuli API</title></head>
  <body>
    <h1>Lazuli API</h1>
    <p>Cloudflare Workers API. OpenAPI source is tracked at apps/api/src/api-spec.yaml.</p>
    <ul>
      <li><a href="/api/v1/health">/api/v1/health</a></li>
      <li><a href="/api/v1/exchanges">/api/v1/exchanges</a></li>
    </ul>
  </body>
</html>`)
);

api.get('/health', async (c) => c.json(successResponse(await buildHealth(c.env))));

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
  const symbol = decodeURIComponent(c.req.param('symbol'));
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
    coverage: { since: options.since, until: options.until, requestedLimit: options.limit },
  });
});

api.get('/ohlcv/multi/:exchange/:symbol', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol = decodeURIComponent(c.req.param('symbol'));
  const query = c.req.query();
  const timeframes = String(query.timeframes ?? '1h')
    .split(',')
    .map((item) => parseTimeframe(item.trim()));
  const type = parseMarketType(query.type, symbol);
  const limit = validateInteger(query.limit, 100, 1, 1000);

  const result: Record<string, OHLCV[]> = {};
  for (const timeframe of timeframes) {
    result[timeframe] = (
      await loadOhlcv(c.env, exchange, symbol, { timeframe, type, limit })
    ).candles;
  }

  return ok(c, { exchange, symbol, type, timeframes, candles: result, timestamp: Date.now() });
});

api.get('/custom-pair/:exchange/:symbol1/:symbol2', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const symbol1 = decodeURIComponent(c.req.param('symbol1'));
  const symbol2 = decodeURIComponent(c.req.param('symbol2'));
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
  const request = (await c.req.json()) as CustomIndexRequest & { limit?: number };
  const exchange = requireExchange(request.exchange);
  const timeframe = parseTimeframe(request.timeframe);
  const limit = validateInteger(request.limit, 100, 1, 1000);
  const weightTotal = request.assets.reduce((sum, asset) => sum + asset.weight, 0);

  if (request.assets.length === 0 || weightTotal <= 0) {
    throw invalidParameter('assets', 'Custom index requires at least one weighted asset');
  }

  const series = await Promise.all(
    request.assets.map(async (asset) => ({
      asset,
      candles: (
        await loadOhlcv(c.env, exchange, asset.symbol, {
          timeframe,
          type: asset.symbol.endsWith('.P') ? 'perp' : 'spot',
          limit,
        })
      ).candles,
    }))
  );
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
  const symbol = decodeURIComponent(c.req.param('symbol'));
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
  const symbol = decodeURIComponent(c.req.param('symbol'));
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
  const response = buildAltScreener(exchange, tickers, {
    base: parseBaseCurrency(query.base),
    period: parsePerformancePeriod(query.period),
    sortBy: parseScreenerSort(query.sortBy),
    sortOrder: validateSortOrder(query.sortOrder),
    limit: validateInteger(query.limit, 100, 1, 500),
    minVolume: query.minVolume ? Number(query.minVolume) : undefined,
    maxVolume: query.maxVolume ? Number(query.maxVolume) : undefined,
    minChange: query.minChange ? Number(query.minChange) : undefined,
    maxChange: query.maxChange ? Number(query.maxChange) : undefined,
    search: validateSearchQuery(query.search),
  });
  return ok(c, response, { source: 'live-cache' });
});

api.post('/screener/:exchange/ohlcv', async (c) => {
  const exchange = requireExchange(c.req.param('exchange'));
  const body = (await c.req.json()) as { symbols?: string[]; period?: string };
  const symbols = (body.symbols ?? []).slice(0, 50);
  const timeframe = periodToTimeframe(body.period);
  const ohlcv: Record<string, OHLCV[]> = {};

  for (const symbol of symbols) {
    ohlcv[symbol] = (
      await loadOhlcv(c.env, exchange, symbol, {
        timeframe,
        type: symbol.endsWith('.P') ? 'perp' : 'spot',
        limit: 60,
      })
    ).candles;
  }

  return ok(c, {
    exchange,
    period: body.period ?? '24h',
    ohlcv,
    count: symbols.length,
    timestamp: Date.now(),
  });
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
  const symbol = decodeURIComponent(c.req.param('symbol'));
  const type = parseMarketType(c.req.query('type'), symbol);
  const limit = validateInteger(c.req.query('limit'), 50, 1, 500);
  const orderbook = await ccxtService
    .fetchOrderBook(exchange, symbol, type, limit)
    .catch((error) => {
      if (!isExchangeConnectivityError(error)) {
        throw error;
      }
      return {
        symbol,
        exchange,
        type,
        bids: [],
        asks: [],
        timestamp: Date.now(),
      };
    });
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
  return ok(c, response);
});

api.post('/admin/backfills', async (c) => {
  requireAdmin(c.env, c.req.header('X-Admin-API-Key'));
  const body = await c.req.json().catch(() => ({}));
  const result = await createBackfillJob(c.env, body);
  return ok(c, result);
});

api.get('/admin/backfills/:id', async (c) => {
  requireAdmin(c.env, c.req.header('X-Admin-API-Key'));
  return ok(c, await getBackfillJob(c.env, c.req.param('id')));
});

api.post('/admin/backfills/:id/retry', async (c) => {
  requireAdmin(c.env, c.req.header('X-Admin-API-Key'));
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
      path: c.req.path,
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
          message.retry();
        }
      }
    }
  },
} satisfies ExportedHandler<Env, BackfillQueueMessage>;

async function buildHealth(env: Env): Promise<HealthResponse & Record<string, unknown>> {
  let cacheReachable = false;
  try {
    if (env.MARKET_DATA_CACHE) {
      const id = env.MARKET_DATA_CACHE.idFromName('health');
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
    cloudflare: {
      d1: !!env.DB,
      r2: !!env.OHLCV_ARCHIVE,
      queue: !!env.BACKFILL_QUEUE,
      workflow: !!env.BACKFILL_WORKFLOW,
      analytics: !!env.API_ANALYTICS,
      durableObjects: {
        marketDataCache: cacheReachable,
        rateLimiter: !!env.RATE_LIMITER,
      },
    },
  };
}

async function cachedMarketData<T>(
  env: Env,
  resource: 'tickers' | 'markets' | 'funding',
  exchange: SupportedExchange,
  type?: 'spot' | 'perp'
): Promise<{ data: T; meta: Record<string, unknown> }> {
  try {
    if (env.MARKET_DATA_CACHE) {
      const id = env.MARKET_DATA_CACHE.idFromName(`${resource}:${exchange}`);
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
    source: 'exchange' | 'r2' | 'r2+exchange';
    archiveObjects: string[];
    missingArchive: boolean;
  };
}> {
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

function isExchangeConnectivityError(error: unknown): boolean {
  if (error instanceof ExchangeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Network error connecting to exchange') ||
    message.includes('ExchangeError: Network error connecting to exchange') ||
    message.includes('fetch failed') ||
    message.includes('Request timeout') ||
    message.includes('Values cannot be larger than 131072 bytes')
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
  return {
    timeframe: parseTimeframe(query.timeframe ?? '1h'),
    type: parseMarketType(query.type, symbol),
    limit: validateInteger(query.limit, defaultLimit, 1, 1000),
    since: query.since ? Number(query.since) : undefined,
    until: query.until ? Number(query.until) : undefined,
  };
}

function parseTimeframe(value: string): Timeframe {
  if (supportedTimeframes.includes(value as Timeframe)) {
    return value as Timeframe;
  }
  throw invalidTimeframe(value, supportedTimeframes);
}

function parseMarketType(value: string | undefined, symbol: string): 'spot' | 'perp' {
  const type = validateMarketType(value);
  if (type) return type;
  if (value && value !== 'spot' && value !== 'perp') throw invalidMarketType(value);
  return symbol.endsWith('.P') ? 'perp' : 'spot';
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

function requireAdmin(env: Env, apiKey: string | undefined): void {
  if (env.ADMIN_API_KEY) {
    if (apiKey !== env.ADMIN_API_KEY) {
      throw unauthorized('Admin API key is required');
    }
    return;
  }

  if (env.ENVIRONMENT && env.ENVIRONMENT !== 'local') {
    throw unauthorized('ADMIN_API_KEY must be configured outside local development');
  }
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function ok<T>(c: { json: (value: unknown) => Response }, data: T, meta?: Record<string, unknown>) {
  const body = meta ? { ...successResponse(data), meta } : successResponse(data);
  return c.json(body);
}
