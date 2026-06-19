/**
 * Lazuli API Worker (Cloudflare Workers + Hono)
 *
 * Entry point exported as default. The MarketDataCacheDO class is also
 * exported so wrangler can wire the Durable Object binding.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { successResponse } from './utils/response';

// Durable Object class must be exported for wrangler binding wiring.
export { MarketDataCacheDO } from './services/MarketDataCacheDO';

// Static list of supported exchanges and their capabilities.
const exchanges = [
  { name: 'Binance', id: 'binance', supported: true, hasSpot: true, hasPerp: true },
  { name: 'Bybit', id: 'bybit', supported: true, hasSpot: true, hasPerp: true },
  { name: 'OKX', id: 'okx', supported: true, hasSpot: true, hasPerp: true },
  { name: 'Hyperliquid', id: 'hyperliquid', supported: true, hasSpot: false, hasPerp: true },
  { name: 'Upbit', id: 'upbit', supported: true, hasSpot: true, hasPerp: false },
];

const app = new Hono<{ Bindings: Env }>();

// --- CORS ---
// Permissive in dev; restrict via CORS_ORIGIN env in production.
app.use(
  '*',
  cors({
    origin: (origin) => origin, // reflect request origin
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-API-Key'],
    credentials: true,
    maxAge: 86400,
  })
);

// --- Root redirect ---
app.get('/', (c) => c.redirect('/api/v1/docs'));

// --- Health (also available at /api/v1/health) ---
app.get('/health', (c) => {
  const data = {
    status: 'ok' as const,
    api: 'ready' as const,
    database: c.env.DB ? 'connected' : 'not_configured',
    cache: {
      backend: 'durable-object',
      reachable: !!c.env.MARKET_DATA_CACHE,
    },
    exchanges: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'],
    timestamp: Date.now(),
  };
  return c.json(successResponse(data));
});

// --- API v1 mount point ---
// Individual route groups will be mounted here in subsequent features.
const api = new Hono<{ Bindings: Env }>();

api.get('/health', (c) => {
  const data = {
    status: 'ok' as const,
    api: 'ready' as const,
    database: c.env.DB ? 'connected' : 'not_configured',
    cache: {
      backend: 'durable-object',
      reachable: !!c.env.MARKET_DATA_CACHE,
    },
    exchanges: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'],
    timestamp: Date.now(),
  };
  return c.json(successResponse(data));
});

api.get('/exchanges', (c) => {
  return c.json(successResponse(exchanges));
});

app.route('/api/v1', api);

// --- Global error handler ---
app.notFound((c) => {
  return c.json(
    {
      success: false,
      data: null,
      error: `Route '${c.req.path}' not found`,
      timestamp: Date.now(),
    },
    404
  );
});

app.onError((err, c) => {
  console.error(JSON.stringify({ level: 'error', module: 'app', msg: 'unhandled error', err }));
  return c.json(
    {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : 'Internal server error',
      timestamp: Date.now(),
    },
    500
  );
});

export default app;
