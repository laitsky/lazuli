# Cache Warming Strategy for Market Data

## Overview

Lazuli implements a **Write-Behind / Cache Warming** strategy for market ticker data. This architecture decouples user API requests from direct exchange API calls, improving latency and reliability.

## Problem Statement

Previously, the ticker API endpoints would synchronously fetch data from cryptocurrency exchanges (Binance, Bybit, OKX, etc.) when a user made a request. This caused:

1. **High latency**: Users waited for exchange API responses (100-500ms+)
2. **Rate limit issues**: High traffic could hit exchange rate limits
3. **Cascading failures**: Exchange outages directly impacted API availability

## Solution Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Lazuli API Server                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐       ┌──────────────────┐       ┌─────────────┐  │
│  │ MarketDataWorker │──────▶│   CacheService   │◀──────│ API Routes  │  │
│  │ (Background)     │       │ (Redis/Memory)   │       │ (Read-only) │  │
│  └────────┬─────────┘       └──────────────────┘       └─────────────┘  │
│           │                                                              │
└───────────┼──────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌───────────────┐
    │   Exchanges   │
    │ (Binance, etc)│
    └───────────────┘
```

### Data Flow

1. **MarketDataWorker** polls all exchanges every 5 seconds
2. Fresh ticker data is written to cache with 10-second TTL
3. API routes read **strictly from cache**
4. Fallback to direct fetch only on cold start (cache miss)

## Implementation Details

### MarketDataWorker

Location: `apps/api/src/services/marketDataWorker.ts`

```typescript
// Configuration
REFRESH_INTERVAL = 5000; // Poll every 5 seconds
CACHE_TTL = 10000; // TTL slightly longer than poll interval
```

Key behaviors:

- Starts automatically when the server boots
- Uses `Promise.allSettled` for parallel exchange polling
- Individual exchange failures don't block others
- Logs success/failure counts per poll cycle

### Cache Keys

| Key Pattern              | Data Type  | TTL  | Description                 |
| ------------------------ | ---------- | ---- | --------------------------- |
| `tickers:{exchange}:raw` | `Ticker[]` | 10s  | All tickers for an exchange |
| `markets:{exchange}:raw` | `Market[]` | 5min | Market metadata (unchanged) |

### Route Behavior

**GET /api/v1/tickers/:exchange**

- Reads from cache first
- Falls back to `ccxtService.getAllTickers()` on cache miss
- Applies filters, sorting, and pagination after retrieval

**GET /api/v1/tickers/:exchange/:symbol**

- Reuses the list cache (`tickers:{exchange}:raw`)
- Finds specific symbol with `.find()` in cached array
- Does NOT call `ccxtService.getTicker()` directly

## Configuration

### Environment Variables

No additional environment variables are required. The worker uses existing cache configuration:

```bash
REDIS_ENABLED=false    # Optional: Enable Redis for distributed caching
REDIS_HOST=localhost   # Redis server host
REDIS_PORT=6379        # Redis server port
```

### Tuning Parameters

To adjust polling frequency, modify in `marketDataWorker.ts`:

```typescript
private readonly REFRESH_INTERVAL = 5000;  // Increase for less load
private readonly CACHE_TTL = 10000;        // Should be > REFRESH_INTERVAL
```

## Cold Start Handling

On server startup, the cache is empty. The first user request will trigger a fallback fetch:

1. Cache miss detected
2. Direct exchange fetch executed
3. Result cached immediately
4. Response returned to user

After ~5 seconds, the worker will populate all caches and subsequent requests are cache-only.

## Error Handling

### Worker Failures

- Individual exchange fetch errors are logged but don't crash the worker
- Other exchanges continue to be polled
- Stale cache entries will expire naturally (10s TTL)

### Route Fallbacks

- Cache miss triggers synchronous fetch (fallback mode)
- Exchange errors propagate as HTTP 5xx responses
- Invalid exchange/symbol errors return HTTP 4xx

## Monitoring

### Logs

The worker logs at `debug` level:

```
[market-data-worker] Poll cycle completed { succeeded: 5, failed: 0, duration: '1234ms' }
[market-data-worker] Cache updated { exchange: 'binance', count: 1523 }
```

### Health Check

The `/health` endpoint includes cache statistics via `cacheService.getStats()`:

- Hit ratio
- Cache size
- Backend status (Redis/Memory)

## Future Improvements

1. **WebSocket integration**: Use exchange WebSocket streams for real-time updates
2. **Selective polling**: Only poll exchanges with recent user activity
3. **Metrics export**: Prometheus metrics for poll latency and cache efficiency
4. **Graceful shutdown**: Stop worker and drain requests before server exit
