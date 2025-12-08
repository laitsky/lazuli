# Real-Time Crypto Liquidation Monitor - Technical Specification

## Executive Summary

A real-time dashboard for monitoring cryptocurrency liquidation events across major perpetual futures exchanges. The system provides traders with instant visibility into market stress events, liquidation cascades, and high-risk price levels to inform trading decisions.

---

## Table of Contents

1. [Overview & Objectives](#1-overview--objectives)
2. [Data Sources & Exchange APIs](#2-data-sources--exchange-apis)
3. [Backend Architecture](#3-backend-architecture)
4. [Frontend Architecture](#4-frontend-architecture)
5. [UI/UX Design & Mockups](#5-uiux-design--mockups)
6. [Real-Time Data Strategy](#6-real-time-data-strategy)
7. [Implementation Plan](#7-implementation-plan)

---

## 1. Overview & Objectives

### 1.1 Problem Statement

Cryptocurrency perpetual futures markets experience frequent liquidation events that can:
- Cascade into larger price movements
- Indicate market sentiment extremes
- Create trading opportunities (reversal signals)
- Signal high-risk price zones for position management

Traders currently lack a unified view of liquidation activity across exchanges.

### 1.2 Solution

A real-time liquidation monitoring dashboard that:
- Aggregates liquidation data from Binance, Bybit, OKX, and Hyperliquid
- Visualizes liquidation events in real-time with price context
- Identifies liquidation clusters and high-risk zones
- Provides historical liquidation analytics
- Alerts on significant liquidation cascades

### 1.3 Key Features

| Feature | Priority | Description |
|---------|----------|-------------|
| Live Liquidation Feed | P0 | Real-time stream of liquidation events |
| Liquidation Heatmap | P0 | Visual density map by price level |
| Cascade Detection | P1 | Alert when liquidations exceed threshold |
| Multi-Exchange View | P1 | Side-by-side exchange comparison |
| Historical Analysis | P2 | Liquidation patterns over time |
| Price Level Overlay | P2 | Liquidation zones on candlestick chart |

### 1.4 Target Users

- **Day Traders**: Monitor for reversal signals and cascade events
- **Swing Traders**: Identify accumulation/distribution zones
- **Risk Managers**: Track market stress and position exposure
- **Market Makers**: Understand liquidity depth and risk zones

---

## 2. Data Sources & Exchange APIs

### 2.1 Exchange Liquidation Data Availability

| Exchange | Liquidation API | Method | Rate Limit | Data Freshness |
|----------|-----------------|--------|------------|----------------|
| **Binance** | ✅ forceOrders | REST + WebSocket | 10 req/s | Real-time |
| **Bybit** | ✅ /v5/market/liquidation | REST | 120 req/min | ~1s delay |
| **OKX** | ✅ /api/v5/public/liquidation-orders | REST | 20 req/2s | ~2s delay |
| **Hyperliquid** | ✅ /info (liquidations) | REST | 1200 req/min | Real-time |

### 2.2 CCXT Liquidation Support

CCXT provides unified liquidation fetching via `fetchLiquidations()`:

```typescript
// CCXT Unified Liquidation API
const liquidations = await exchange.fetchLiquidations(
  symbol,      // 'BTC/USDT:USDT'
  since,       // Timestamp in ms
  limit,       // Max results (default 100)
  params       // Exchange-specific params
);

// Returns unified format:
interface CCXTLiquidation {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';        // 'buy' = short liquidated, 'sell' = long liquidated
  price: number;
  baseQuantity: number;
  quoteQuantity: number;
  timestamp: number;
  datetime: string;
}
```

### 2.3 Data Fields by Exchange

#### Binance Force Orders
```json
{
  "symbol": "BTCUSDT",
  "side": "SELL",
  "orderType": "LIMIT",
  "timeInForce": "IOC",
  "origQty": "0.012",
  "price": "43500.00",
  "avgPrice": "43480.00",
  "orderStatus": "FILLED",
  "time": 1703001234567
}
```

#### Bybit Liquidation
```json
{
  "symbol": "BTCUSDT",
  "side": "Sell",
  "size": "0.015",
  "price": "43500",
  "updatedTime": "1703001234567"
}
```

#### OKX Liquidation Orders
```json
{
  "instId": "BTC-USDT-SWAP",
  "side": "sell",
  "sz": "0.01",
  "px": "43500",
  "ts": "1703001234567",
  "bkPx": "43520",
  "bkLoss": "0.20"
}
```

### 2.4 Calculated Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **Liquidation Value** | `price × quantity` | USD value of liquidation |
| **Long/Short Ratio** | `longLiqs / shortLiqs` | Directional bias |
| **Liquidation Intensity** | `count / timeWindow` | Events per minute |
| **Cascade Score** | `sum(value) in 60s > threshold` | Cascade detection |
| **Price Impact** | `priceChange / liquidationValue` | Market sensitivity |

---

## 3. Backend Architecture

### 3.1 New Service: `liquidationService.ts`

```
apps/api/src/services/liquidationService.ts
```

#### Service Interface

```typescript
/**
 * LiquidationService - Handles fetching and processing liquidation data
 * from multiple perpetual futures exchanges via CCXT.
 *
 * Features:
 * - Real-time liquidation event aggregation
 * - Cross-exchange liquidation comparison
 * - Liquidation statistics and analytics
 * - Cascade detection algorithms
 */
interface LiquidationService {
  // Core Data Fetching
  getLiquidations(exchange: string, symbol?: string, limit?: number): Promise<LiquidationEvent[]>;
  getRecentLiquidations(exchange: string, since?: number): Promise<LiquidationEvent[]>;

  // Cross-Exchange Aggregation
  getAllExchangeLiquidations(symbol: string, limit?: number): Promise<AggregatedLiquidations>;

  // Analytics
  getLiquidationStats(exchange: string, symbol?: string, period?: string): Promise<LiquidationStats>;
  getLiquidationHeatmap(exchange: string, symbol: string): Promise<LiquidationHeatmap>;

  // Real-time Monitoring
  getCascadeAlerts(threshold?: number): Promise<CascadeAlert[]>;
  getLiquidationZones(exchange: string, symbol: string): Promise<LiquidationZone[]>;
}
```

#### Implementation Structure

```typescript
// apps/api/src/services/liquidationService.ts

import { ccxtService } from './ccxtService';
import { cacheService } from './cacheService';

/**
 * Configuration for liquidation data fetching and processing
 */
const LIQUIDATION_CONFIG = {
  // Cache TTLs (in seconds)
  CACHE_TTL_LIVE: 5,           // Live feed - 5 second cache
  CACHE_TTL_STATS: 30,         // Stats - 30 second cache
  CACHE_TTL_HEATMAP: 60,       // Heatmap - 1 minute cache

  // Cascade detection thresholds
  CASCADE_THRESHOLD_USD: 1000000,   // $1M in 60s triggers cascade
  CASCADE_TIME_WINDOW: 60000,       // 60 second rolling window

  // Data limits
  DEFAULT_LIMIT: 100,
  MAX_LIMIT: 500,

  // Supported perpetual exchanges
  SUPPORTED_EXCHANGES: ['binance', 'bybit', 'okx', 'hyperliquid'],
};

class LiquidationService {
  /**
   * Fetch recent liquidations from a specific exchange
   * Uses CCXT unified API for consistent data format
   */
  async getLiquidations(
    exchange: string,
    symbol?: string,
    limit: number = LIQUIDATION_CONFIG.DEFAULT_LIMIT
  ): Promise<LiquidationEvent[]> {
    // Implementation details...
  }

  /**
   * Aggregate liquidations across all supported exchanges
   * Useful for market-wide liquidation monitoring
   */
  async getAllExchangeLiquidations(
    symbol: string,
    limit?: number
  ): Promise<AggregatedLiquidations> {
    // Fetch from all exchanges in parallel
    // Merge and sort by timestamp
  }

  /**
   * Calculate liquidation statistics for analytics
   * Includes volume, counts, long/short ratio, intensity
   */
  async getLiquidationStats(
    exchange: string,
    symbol?: string,
    period: '1h' | '4h' | '24h' = '24h'
  ): Promise<LiquidationStats> {
    // Aggregate stats calculation
  }

  /**
   * Generate heatmap data showing liquidation density by price level
   * Used for visualizing high-risk price zones
   */
  async getLiquidationHeatmap(
    exchange: string,
    symbol: string,
    priceBuckets: number = 50
  ): Promise<LiquidationHeatmap> {
    // Group liquidations by price buckets
    // Calculate density per bucket
  }

  /**
   * Detect liquidation cascades based on volume threshold
   * Returns active cascade alerts
   */
  async getCascadeAlerts(
    threshold: number = LIQUIDATION_CONFIG.CASCADE_THRESHOLD_USD
  ): Promise<CascadeAlert[]> {
    // Monitor rolling window for cascade events
  }
}

export const liquidationService = new LiquidationService();
```

### 3.2 New Route: `liquidation.ts`

```
apps/api/src/routes/liquidation.ts
```

#### Route Definitions

```typescript
// apps/api/src/routes/liquidation.ts

import { Elysia } from 'elysia';
import { liquidationService } from '../services/liquidationService';
import { successResponse, validateExchange, validateInteger } from '../utils';

/**
 * Liquidation Routes - Real-time liquidation monitoring endpoints
 *
 * Base path: /api/v1/liquidations
 *
 * Endpoints:
 * - GET /:exchange - Get recent liquidations for an exchange
 * - GET /:exchange/:symbol - Get liquidations for specific symbol
 * - GET /aggregate/:symbol - Cross-exchange liquidations
 * - GET /stats/:exchange - Liquidation statistics
 * - GET /heatmap/:exchange/:symbol - Price-level liquidation density
 * - GET /cascades - Active cascade alerts
 * - GET /zones/:exchange/:symbol - High-risk liquidation zones
 */
export const liquidationRoutes = new Elysia({ prefix: '/liquidations' })

  /**
   * GET /api/v1/liquidations/:exchange
   * Fetch recent liquidations from a specific exchange
   *
   * Query params:
   * - limit: number (default: 100, max: 500)
   * - since: timestamp in ms (optional)
   * - symbol: filter by symbol (optional)
   */
  .get('/:exchange', async ({ params, query }) => {
    const exchange = validateExchange(params.exchange, 'perp');
    const limit = validateInteger(query.limit, 100, 1, 500);
    const since = query.since ? parseInt(query.since as string) : undefined;
    const symbol = query.symbol as string | undefined;

    const liquidations = await liquidationService.getLiquidations(
      exchange,
      symbol,
      limit,
      since
    );

    return successResponse(liquidations);
  })

  /**
   * GET /api/v1/liquidations/:exchange/:symbol
   * Fetch liquidations for a specific trading pair
   */
  .get('/:exchange/:symbol', async ({ params, query }) => {
    const exchange = validateExchange(params.exchange, 'perp');
    const symbol = decodeURIComponent(params.symbol);
    const limit = validateInteger(query.limit, 100, 1, 500);

    const liquidations = await liquidationService.getLiquidations(
      exchange,
      symbol,
      limit
    );

    return successResponse(liquidations);
  })

  /**
   * GET /api/v1/liquidations/aggregate/:symbol
   * Cross-exchange liquidation aggregation
   * Combines data from all supported perpetual exchanges
   */
  .get('/aggregate/:symbol', async ({ params, query }) => {
    const symbol = decodeURIComponent(params.symbol);
    const limit = validateInteger(query.limit, 50, 1, 200);

    const aggregated = await liquidationService.getAllExchangeLiquidations(
      symbol,
      limit
    );

    return successResponse(aggregated);
  })

  /**
   * GET /api/v1/liquidations/stats/:exchange
   * Liquidation statistics and analytics
   *
   * Query params:
   * - period: '1h' | '4h' | '24h' (default: '24h')
   * - symbol: filter by symbol (optional)
   */
  .get('/stats/:exchange', async ({ params, query }) => {
    const exchange = validateExchange(params.exchange, 'perp');
    const period = (query.period as '1h' | '4h' | '24h') || '24h';
    const symbol = query.symbol as string | undefined;

    const stats = await liquidationService.getLiquidationStats(
      exchange,
      symbol,
      period
    );

    return successResponse(stats);
  })

  /**
   * GET /api/v1/liquidations/heatmap/:exchange/:symbol
   * Price-level liquidation density for heatmap visualization
   */
  .get('/heatmap/:exchange/:symbol', async ({ params, query }) => {
    const exchange = validateExchange(params.exchange, 'perp');
    const symbol = decodeURIComponent(params.symbol);
    const buckets = validateInteger(query.buckets, 50, 10, 100);

    const heatmap = await liquidationService.getLiquidationHeatmap(
      exchange,
      symbol,
      buckets
    );

    return successResponse(heatmap);
  })

  /**
   * GET /api/v1/liquidations/cascades
   * Active liquidation cascade alerts
   */
  .get('/cascades', async ({ query }) => {
    const threshold = validateInteger(query.threshold, 1000000, 100000, 10000000);

    const cascades = await liquidationService.getCascadeAlerts(threshold);

    return successResponse(cascades);
  })

  /**
   * GET /api/v1/liquidations/zones/:exchange/:symbol
   * High-risk liquidation price zones
   * Based on historical liquidation clusters
   */
  .get('/zones/:exchange/:symbol', async ({ params }) => {
    const exchange = validateExchange(params.exchange, 'perp');
    const symbol = decodeURIComponent(params.symbol);

    const zones = await liquidationService.getLiquidationZones(
      exchange,
      symbol
    );

    return successResponse(zones);
  });
```

### 3.3 New Types: `packages/shared/src/liquidation.ts`

```typescript
// packages/shared/src/liquidation.ts

/**
 * Core liquidation event from exchange
 */
export interface LiquidationEvent {
  /** Unique identifier */
  id: string;
  /** Trading pair symbol (e.g., "BTCUSDT") */
  symbol: string;
  /** Source exchange */
  exchange: SupportedExchange;
  /** Position side that was liquidated */
  side: 'long' | 'short';
  /** Liquidation execution price */
  price: number;
  /** Quantity in base currency */
  quantity: number;
  /** Value in quote currency (USD) */
  value: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Bankruptcy price (if available) */
  bankruptcyPrice?: number;
  /** Insurance fund contribution (if available) */
  insuranceFundContribution?: number;
}

/**
 * Aggregated liquidations from multiple exchanges
 */
export interface AggregatedLiquidations {
  /** Target symbol */
  symbol: string;
  /** Combined liquidation events */
  liquidations: LiquidationEvent[];
  /** Per-exchange breakdown */
  byExchange: {
    [exchange: string]: {
      count: number;
      totalValue: number;
      longCount: number;
      shortCount: number;
    };
  };
  /** Aggregation metadata */
  meta: {
    exchanges: string[];
    totalCount: number;
    totalValue: number;
    timestamp: number;
  };
}

/**
 * Liquidation statistics for analytics
 */
export interface LiquidationStats {
  /** Target exchange */
  exchange: string;
  /** Optional symbol filter */
  symbol?: string;
  /** Time period for stats */
  period: '1h' | '4h' | '24h';
  /** Total liquidation count */
  totalCount: number;
  /** Total USD value liquidated */
  totalValue: number;
  /** Long position liquidations */
  longCount: number;
  /** Short position liquidations */
  shortCount: number;
  /** Long liquidation USD value */
  longValue: number;
  /** Short liquidation USD value */
  shortValue: number;
  /** Long/Short ratio (>1 = more longs liquidated) */
  longShortRatio: number;
  /** Largest single liquidation */
  largestLiquidation: LiquidationEvent | null;
  /** Liquidations per minute */
  intensity: number;
  /** Top symbols by liquidation volume */
  topSymbols: {
    symbol: string;
    count: number;
    value: number;
  }[];
  /** Hourly breakdown */
  hourlyBreakdown: {
    hour: number;
    count: number;
    value: number;
  }[];
  /** Stats generation timestamp */
  timestamp: number;
}

/**
 * Heatmap data for price-level liquidation density
 */
export interface LiquidationHeatmap {
  /** Target symbol */
  symbol: string;
  /** Source exchange */
  exchange: string;
  /** Current market price */
  currentPrice: number;
  /** Price range covered */
  priceRange: {
    min: number;
    max: number;
  };
  /** Price buckets with liquidation density */
  buckets: LiquidationBucket[];
  /** Metadata */
  meta: {
    bucketCount: number;
    totalLiquidations: number;
    totalValue: number;
    timestamp: number;
  };
}

/**
 * Single bucket in liquidation heatmap
 */
export interface LiquidationBucket {
  /** Price range for this bucket */
  priceMin: number;
  priceMax: number;
  priceCenter: number;
  /** Long liquidations in this bucket */
  longCount: number;
  longValue: number;
  /** Short liquidations in this bucket */
  shortCount: number;
  shortValue: number;
  /** Total liquidations */
  totalCount: number;
  totalValue: number;
  /** Normalized intensity (0-1) */
  intensity: number;
  /** Distance from current price as percentage */
  distanceFromPrice: number;
}

/**
 * Liquidation cascade alert
 */
export interface CascadeAlert {
  /** Alert identifier */
  id: string;
  /** Affected symbol */
  symbol: string;
  /** Source exchange */
  exchange: string;
  /** Cascade type */
  type: 'long_cascade' | 'short_cascade' | 'mixed_cascade';
  /** Alert severity */
  severity: 'warning' | 'critical' | 'extreme';
  /** Total value liquidated in cascade */
  totalValue: number;
  /** Number of liquidations */
  liquidationCount: number;
  /** Cascade duration in seconds */
  duration: number;
  /** Price change during cascade */
  priceChange: number;
  priceChangePercent: number;
  /** Cascade start time */
  startTime: number;
  /** Most recent liquidation time */
  lastUpdate: number;
  /** Whether cascade is still active */
  isActive: boolean;
}

/**
 * High-risk liquidation zone on chart
 */
export interface LiquidationZone {
  /** Zone identifier */
  id: string;
  /** Zone type */
  type: 'long_liquidation_zone' | 'short_liquidation_zone';
  /** Price range */
  priceMin: number;
  priceMax: number;
  /** Estimated liquidation value in zone */
  estimatedValue: number;
  /** Risk level */
  risk: 'low' | 'medium' | 'high' | 'extreme';
  /** Distance from current price */
  distanceFromPrice: number;
  distancePercent: number;
}

/**
 * Real-time liquidation feed item (for WebSocket/polling)
 */
export interface LiveLiquidationFeed {
  /** Latest liquidation events */
  events: LiquidationEvent[];
  /** Summary stats */
  summary: {
    last1m: { count: number; value: number };
    last5m: { count: number; value: number };
    last15m: { count: number; value: number };
  };
  /** Active cascade alerts */
  cascades: CascadeAlert[];
  /** Feed timestamp */
  timestamp: number;
}

/**
 * Supported exchanges for liquidation data
 */
export type LiquidationExchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid';
```

---

## 4. Frontend Architecture

### 4.1 Page Structure

```
apps/web/app/liquidations/
├── page.tsx                    # Server component (data fetching)
├── loading.tsx                 # Loading skeleton
├── liquidations-client.tsx     # Main client component
└── components/
    ├── liquidation-feed.tsx    # Live event stream
    ├── liquidation-stats.tsx   # Statistics cards
    ├── liquidation-heatmap.tsx # Price-level heatmap
    ├── liquidation-chart.tsx   # Time-series chart
    ├── cascade-alerts.tsx      # Cascade notifications
    └── exchange-selector.tsx   # Multi-exchange tabs
```

### 4.2 Component Specifications

#### LiquidationFeed Component

```typescript
// apps/web/components/liquidation-feed.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { LazuliAPI } from '@/lib/api-client';
import { LiquidationEvent } from '@lazuli/shared';
import { Badge } from '@/components/ui/badge';
import {
  Flame,
  TrendingDown,
  TrendingUp,
  Zap,
  AlertTriangle
} from 'lucide-react';

interface LiquidationFeedProps {
  exchange: string;
  symbol?: string;
  maxItems?: number;
  refreshInterval?: number;
}

/**
 * LiquidationFeed - Real-time liquidation event stream
 *
 * Features:
 * - Auto-refreshing liquidation feed (5s default)
 * - Animated entry for new liquidations
 * - Color-coded by side (long = red, short = green)
 * - Size-based visual emphasis
 * - Sound alerts for large liquidations (optional)
 */
export function LiquidationFeed({
  exchange,
  symbol,
  maxItems = 50,
  refreshInterval = 5000,
}: LiquidationFeedProps) {
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  const { data, isRefreshing } = useAutoRefresh({
    fetchFn: () => LazuliAPI.getLiquidations(exchange, { symbol, limit: maxItems }),
    interval: refreshInterval,
    fetchOnMount: true,
  });

  // Track new liquidations for animation
  const newLiquidations = data?.filter(liq => !seenIds.has(liq.id)) || [];

  useEffect(() => {
    if (data) {
      setSeenIds(new Set(data.map(l => l.id)));
    }
  }, [data]);

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {data?.map((liq, index) => (
          <LiquidationItem
            key={liq.id}
            liquidation={liq}
            isNew={newLiquidations.some(n => n.id === liq.id)}
            index={index}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Single liquidation event display
 */
function LiquidationItem({
  liquidation,
  isNew,
  index
}: {
  liquidation: LiquidationEvent;
  isNew: boolean;
  index: number;
}) {
  const isLong = liquidation.side === 'long';
  const isLarge = liquidation.value > 100000; // >$100k
  const isHuge = liquidation.value > 1000000; // >$1M

  return (
    <motion.div
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`
        flex items-center justify-between p-3 rounded-lg border
        ${isNew ? 'ring-2 ring-primary/50' : ''}
        ${isHuge ? 'bg-destructive/10 border-destructive/30' :
          isLarge ? 'bg-warning/10 border-warning/30' :
          'bg-card border-border'}
      `}
    >
      {/* Side indicator */}
      <div className="flex items-center gap-3">
        <div className={`
          p-2 rounded-full
          ${isLong ? 'bg-destructive/20 text-destructive' : 'bg-success/20 text-success'}
        `}>
          {isLong ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{liquidation.symbol}</span>
            <Badge variant={isLong ? 'destructive' : 'success'} className="text-xs">
              {isLong ? 'LONG' : 'SHORT'}
            </Badge>
            {isHuge && <Flame className="w-4 h-4 text-orange-500 animate-pulse" />}
          </div>
          <div className="text-sm text-muted-foreground">
            @ ${liquidation.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Value */}
      <div className="text-right">
        <div className={`font-mono font-bold ${isHuge ? 'text-xl' : isLarge ? 'text-lg' : ''}`}>
          ${formatValue(liquidation.value)}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatTimeAgo(liquidation.timestamp)}
        </div>
      </div>
    </motion.div>
  );
}
```

#### LiquidationHeatmap Component

```typescript
// apps/web/components/liquidation-heatmap.tsx

'use client';

import { useMemo } from 'react';
import { LiquidationHeatmap as HeatmapData, LiquidationBucket } from '@lazuli/shared';

interface LiquidationHeatmapProps {
  data: HeatmapData;
  height?: number;
  showCurrentPrice?: boolean;
}

/**
 * LiquidationHeatmap - Visual representation of liquidation density by price level
 *
 * Features:
 * - Vertical bar chart showing liquidation intensity
 * - Color gradient from low (blue) to high (red) intensity
 * - Current price indicator line
 * - Hover tooltips with detailed breakdown
 * - Long/Short separation
 */
export function LiquidationHeatmap({
  data,
  height = 400,
  showCurrentPrice = true,
}: LiquidationHeatmapProps) {
  const maxIntensity = useMemo(() =>
    Math.max(...data.buckets.map(b => b.intensity)),
    [data.buckets]
  );

  const currentPriceIndex = useMemo(() => {
    return data.buckets.findIndex(
      b => data.currentPrice >= b.priceMin && data.currentPrice <= b.priceMax
    );
  }, [data]);

  return (
    <div className="relative" style={{ height }}>
      {/* Price axis (left) */}
      <div className="absolute left-0 top-0 bottom-0 w-16 flex flex-col justify-between text-xs text-muted-foreground">
        <span>${formatPrice(data.priceRange.max)}</span>
        <span>${formatPrice(data.currentPrice)}</span>
        <span>${formatPrice(data.priceRange.min)}</span>
      </div>

      {/* Heatmap bars */}
      <div className="ml-20 h-full flex flex-col gap-0.5">
        {data.buckets.map((bucket, index) => (
          <HeatmapBar
            key={index}
            bucket={bucket}
            maxIntensity={maxIntensity}
            isCurrentPrice={index === currentPriceIndex}
          />
        ))}
      </div>

      {/* Current price line */}
      {showCurrentPrice && (
        <div
          className="absolute left-20 right-0 h-0.5 bg-primary z-10"
          style={{
            top: `${((data.priceRange.max - data.currentPrice) /
                   (data.priceRange.max - data.priceRange.min)) * 100}%`
          }}
        >
          <span className="absolute -top-3 right-0 text-xs bg-primary text-primary-foreground px-1 rounded">
            ${formatPrice(data.currentPrice)}
          </span>
        </div>
      )}
    </div>
  );
}

function HeatmapBar({
  bucket,
  maxIntensity,
  isCurrentPrice
}: {
  bucket: LiquidationBucket;
  maxIntensity: number;
  isCurrentPrice: boolean;
}) {
  const longWidth = (bucket.longValue / (bucket.totalValue || 1)) * 100;
  const shortWidth = 100 - longWidth;
  const opacity = bucket.intensity / maxIntensity;

  return (
    <div
      className={`
        flex h-full min-h-[4px] rounded-sm overflow-hidden
        ${isCurrentPrice ? 'ring-2 ring-primary' : ''}
      `}
      title={`$${bucket.priceCenter.toLocaleString()} | Long: $${formatValue(bucket.longValue)} | Short: $${formatValue(bucket.shortValue)}`}
    >
      {/* Long liquidations (red) */}
      <div
        className="bg-destructive transition-all duration-300"
        style={{
          width: `${longWidth}%`,
          opacity: 0.3 + (opacity * 0.7),
        }}
      />
      {/* Short liquidations (green) */}
      <div
        className="bg-success transition-all duration-300"
        style={{
          width: `${shortWidth}%`,
          opacity: 0.3 + (opacity * 0.7),
        }}
      />
    </div>
  );
}
```

### 4.3 API Client Extensions

```typescript
// Add to apps/web/lib/api-client.ts

class LazuliAPI {
  // ... existing methods ...

  /**
   * Liquidation Endpoints
   */

  static async getLiquidations(
    exchange: string,
    params?: { symbol?: string; limit?: number; since?: number }
  ): Promise<ApiResponse<LiquidationEvent[]>> {
    const searchParams = new URLSearchParams();
    if (params?.symbol) searchParams.set('symbol', params.symbol);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.since) searchParams.set('since', params.since.toString());

    return this.fetch(`/liquidations/${exchange}?${searchParams}`);
  }

  static async getAggregatedLiquidations(
    symbol: string,
    limit?: number
  ): Promise<ApiResponse<AggregatedLiquidations>> {
    const params = limit ? `?limit=${limit}` : '';
    return this.fetch(`/liquidations/aggregate/${encodeURIComponent(symbol)}${params}`);
  }

  static async getLiquidationStats(
    exchange: string,
    params?: { symbol?: string; period?: '1h' | '4h' | '24h' }
  ): Promise<ApiResponse<LiquidationStats>> {
    const searchParams = new URLSearchParams();
    if (params?.symbol) searchParams.set('symbol', params.symbol);
    if (params?.period) searchParams.set('period', params.period);

    return this.fetch(`/liquidations/stats/${exchange}?${searchParams}`);
  }

  static async getLiquidationHeatmap(
    exchange: string,
    symbol: string,
    buckets?: number
  ): Promise<ApiResponse<LiquidationHeatmap>> {
    const params = buckets ? `?buckets=${buckets}` : '';
    return this.fetch(
      `/liquidations/heatmap/${exchange}/${encodeURIComponent(symbol)}${params}`
    );
  }

  static async getCascadeAlerts(
    threshold?: number
  ): Promise<ApiResponse<CascadeAlert[]>> {
    const params = threshold ? `?threshold=${threshold}` : '';
    return this.fetch(`/liquidations/cascades${params}`);
  }

  static async getLiquidationZones(
    exchange: string,
    symbol: string
  ): Promise<ApiResponse<LiquidationZone[]>> {
    return this.fetch(
      `/liquidations/zones/${exchange}/${encodeURIComponent(symbol)}`
    );
  }
}
```

### 4.4 Custom Hook: useLiquidationFeed

```typescript
// apps/web/hooks/use-liquidation-feed.ts

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAutoRefresh } from './use-auto-refresh';
import { LazuliAPI } from '@/lib/api-client';
import { LiquidationEvent, CascadeAlert } from '@lazuli/shared';

interface UseLiquidationFeedOptions {
  exchange: string;
  symbol?: string;
  refreshInterval?: number;
  maxEvents?: number;
  cascadeThreshold?: number;
  onNewLiquidation?: (event: LiquidationEvent) => void;
  onCascadeAlert?: (alert: CascadeAlert) => void;
}

interface LiquidationFeedState {
  events: LiquidationEvent[];
  cascades: CascadeAlert[];
  stats: {
    last1m: { count: number; value: number };
    last5m: { count: number; value: number };
  };
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
}

/**
 * useLiquidationFeed - Hook for managing real-time liquidation data
 *
 * Features:
 * - Auto-refreshing liquidation events
 * - New event detection with callbacks
 * - Cascade alert monitoring
 * - Rolling statistics calculation
 * - Sound/notification triggers
 */
export function useLiquidationFeed({
  exchange,
  symbol,
  refreshInterval = 5000,
  maxEvents = 100,
  cascadeThreshold = 1000000,
  onNewLiquidation,
  onCascadeAlert,
}: UseLiquidationFeedOptions) {
  const [state, setState] = useState<LiquidationFeedState>({
    events: [],
    cascades: [],
    stats: {
      last1m: { count: 0, value: 0 },
      last5m: { count: 0, value: 0 },
    },
    isLoading: true,
    isRefreshing: false,
    error: null,
  });

  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastCascadeIdsRef = useRef<Set<string>>(new Set());

  // Fetch liquidation events
  const { data: liquidationData, isRefreshing: eventsRefreshing } = useAutoRefresh({
    fetchFn: () => LazuliAPI.getLiquidations(exchange, { symbol, limit: maxEvents }),
    interval: refreshInterval,
    fetchOnMount: true,
  });

  // Fetch cascade alerts
  const { data: cascadeData, isRefreshing: cascadesRefreshing } = useAutoRefresh({
    fetchFn: () => LazuliAPI.getCascadeAlerts(cascadeThreshold),
    interval: refreshInterval * 2, // Check cascades less frequently
    fetchOnMount: true,
  });

  // Process new liquidations
  useEffect(() => {
    if (!liquidationData?.data) return;

    const events = liquidationData.data;
    const newEvents = events.filter(e => !seenIdsRef.current.has(e.id));

    // Trigger callbacks for new events
    newEvents.forEach(event => {
      seenIdsRef.current.add(event.id);
      onNewLiquidation?.(event);
    });

    // Calculate rolling stats
    const now = Date.now();
    const last1m = events.filter(e => now - e.timestamp < 60000);
    const last5m = events.filter(e => now - e.timestamp < 300000);

    setState(prev => ({
      ...prev,
      events,
      stats: {
        last1m: {
          count: last1m.length,
          value: last1m.reduce((sum, e) => sum + e.value, 0),
        },
        last5m: {
          count: last5m.length,
          value: last5m.reduce((sum, e) => sum + e.value, 0),
        },
      },
      isLoading: false,
      isRefreshing: eventsRefreshing,
    }));
  }, [liquidationData, eventsRefreshing, onNewLiquidation]);

  // Process cascade alerts
  useEffect(() => {
    if (!cascadeData?.data) return;

    const cascades = cascadeData.data;
    const newCascades = cascades.filter(c => !lastCascadeIdsRef.current.has(c.id));

    // Trigger callbacks for new cascades
    newCascades.forEach(cascade => {
      lastCascadeIdsRef.current.add(cascade.id);
      onCascadeAlert?.(cascade);
    });

    setState(prev => ({ ...prev, cascades }));
  }, [cascadeData, onCascadeAlert]);

  return state;
}
```

---

## 5. UI/UX Design & Mockups

### 5.1 Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🔵 LAZULI                                        [BTC: $43,521]  [🔔] [⚙️]    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  LIQUIDATION MONITOR                              [Binance ▼] [BTCUSDT ▼]      │
│  ═══════════════════                                                           │
│                                                                                 │
│  ┌─────────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  📊 24H STATS                       │  │  🔥 CASCADE ALERTS               │ │
│  │  ─────────────────────────────────  │  │  ────────────────────────────── │ │
│  │                                     │  │                                  │ │
│  │  Total Liquidated    $142.5M        │  │  ⚠️  BTC Short Cascade          │ │
│  │  Long Liquidations   $89.2M  (62%)  │  │      $4.2M in 45s | ACTIVE      │ │
│  │  Short Liquidations  $53.3M  (38%)  │  │                                  │ │
│  │  Largest Single      $2.1M          │  │  ✅  ETH Long Cascade           │ │
│  │  Intensity           45/min         │  │      $1.8M in 120s | ENDED      │ │
│  │                                     │  │                                  │ │
│  └─────────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  📈 LIQUIDATION HEATMAP                                    [1H][4H][24H] │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │                                                                          │  │
│  │  $45,000 ┤                    ░░░░░░░                                    │  │
│  │  $44,500 ┤                  ░░░░░░░░░░                                   │  │
│  │  $44,000 ┤                ▓▓▓▓▓▓▓▓▓▓▓▓                                  │  │
│  │  $43,500 ┤══════════════════●══════════════════ CURRENT PRICE           │  │
│  │  $43,000 ┤              ████████████████                                 │  │
│  │  $42,500 ┤            ██████████████████████                             │  │
│  │  $42,000 ┤          ████████████████████████████  ← HIGH RISK ZONE      │  │
│  │  $41,500 ┤        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░                          │  │
│  │  $41,000 ┤      ░░░░░░░░░░░░░░░░░░░░                                     │  │
│  │          └────────────────────────────────────────────────────────────   │  │
│  │              ████ Long Liquidations    ████ Short Liquidations          │  │
│  │                                                                          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  ⚡ LIVE LIQUIDATION FEED                      [▶️ Auto-refresh: 5s]    │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │                                                                          │  │
│  │  🔴 BTCUSDT  LONG   @ $43,521.00                    $245,320    2s ago  │  │
│  │  🟢 ETHUSDT  SHORT  @ $2,234.50                      $89,450    5s ago  │  │
│  │  🔴 BTCUSDT  LONG   @ $43,498.00                    $156,780    8s ago  │  │
│  │  🔥 BTCUSDT  LONG   @ $43,475.00                  $1,234,500   12s ago  │  │
│  │  🟢 SOLUSDT  SHORT  @ $98.45                         $45,230   15s ago  │  │
│  │  🔴 ETHUSDT  LONG   @ $2,231.00                     $178,900   18s ago  │  │
│  │  🟢 BTCUSDT  SHORT  @ $43,580.00                     $67,890   22s ago  │  │
│  │  🔴 XRPUSDT  LONG   @ $0.6234                        $23,450   25s ago  │  │
│  │                                                                          │  │
│  │  ─────────────────────────────────────────────────────────────────────   │  │
│  │  Last 1m: 12 liquidations | $2.3M    Last 5m: 45 liquidations | $8.7M   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Multi-Exchange Comparison View

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  CROSS-EXCHANGE LIQUIDATION COMPARISON                              [BTCUSDT]  │
│  ═══════════════════════════════════════                                       │
│                                                                                 │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌───────────────┐ │
│  │    BINANCE      │ │     BYBIT       │ │      OKX        │ │  HYPERLIQUID  │ │
│  │    ════════     │ │    ═══════      │ │     ═════       │ │  ═══════════  │ │
│  │                 │ │                 │ │                 │ │               │ │
│  │  24H: $58.2M    │ │  24H: $42.1M    │ │  24H: $28.4M    │ │  24H: $13.8M  │ │
│  │  L/S: 1.8       │ │  L/S: 1.5       │ │  L/S: 2.1       │ │  L/S: 1.2     │ │
│  │                 │ │                 │ │                 │ │               │ │
│  │  ████████████   │ │  ██████████     │ │  ████████       │ │  █████        │ │
│  │  ████████       │ │  ██████         │ │  ██████████     │ │  ████         │ │
│  │                 │ │                 │ │                 │ │               │ │
│  │  Intensity:     │ │  Intensity:     │ │  Intensity:     │ │  Intensity:   │ │
│  │  ●●●●●○○○○○     │ │  ●●●●○○○○○○     │ │  ●●●○○○○○○○     │ │  ●●○○○○○○○○   │ │
│  │                 │ │                 │ │                 │ │               │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ └───────────────┘ │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  AGGREGATED TIMELINE                                                     │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │                                                                          │  │
│  │  $5M ┤         ╭─╮                                                       │  │
│  │      │        ╱  ╲    ╭──╮                                              │  │
│  │  $3M ┤      ╱    ╲  ╱    ╲     ╭─╮                                     │  │
│  │      │    ╱      ╲╱      ╲   ╱   ╲                                     │  │
│  │  $1M ┤──╱                  ╲─╱     ╲──────                              │  │
│  │      └────────────────────────────────────────────────────────────────  │  │
│  │       12:00    13:00    14:00    15:00    16:00    17:00    18:00       │  │
│  │                                                                          │  │
│  │       ■ Binance  ■ Bybit  ■ OKX  ■ Hyperliquid                          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Liquidation Zones on Chart

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  BTCUSDT PERPETUAL - LIQUIDATION ZONES                    [1H] [4H] [1D] [1W]   │
│  ════════════════════════════════════                                           │
│                                                                                  │
│  $46,000 ┤                                                                       │
│          │                                                                       │
│  $45,000 ┤─────────────────────────────────────────  ░░░░░░░░░░░░░░░ $4.2M     │
│          │                               ╭────╮       SHORT LIQ ZONE            │
│  $44,000 ┤                          ╭────╯    ╰──╮                              │
│          │                     ╭────╯            │                              │
│  $43,500 ┤================●====╯                 ╰─  CURRENT: $43,521           │
│          │           ╭────╯                                                      │
│  $43,000 ┤      ╭────╯                                                          │
│          │ ╭────╯                                                               │
│  $42,500 ┤─╯                                                                    │
│          │                                           ████████████████ $8.7M    │
│  $42,000 ┤─────────────────────────────────────────  LONG LIQ ZONE (HIGH RISK) │
│          │                                           ████████████████           │
│  $41,500 ┤                                                                       │
│          │                                           ░░░░░░░░░░░░░ $2.1M       │
│  $41,000 ┤─────────────────────────────────────────  LONG LIQ ZONE              │
│          └───────────────────────────────────────────────────────────────────── │
│           Mon      Tue       Wed       Thu       Fri       Sat       Sun        │
│                                                                                  │
│  LEGEND: ████ High Risk Zone (>$5M)  ░░░░ Medium Risk ($1-5M)  .... Low Risk   │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Mobile Responsive Layout

```
┌────────────────────────────┐
│  🔵 LAZULI      [BTC ▼]   │
├────────────────────────────┤
│                            │
│  LIQUIDATIONS              │
│  ═════════════             │
│                            │
│  [Binance][Bybit][OKX]     │
│                            │
│  ┌────────────────────────┐│
│  │  24H STATS             ││
│  │  ──────────────────    ││
│  │  Total:    $142.5M     ││
│  │  Long:     $89.2M      ││
│  │  Short:    $53.3M      ││
│  │  L/S:      1.67        ││
│  └────────────────────────┘│
│                            │
│  ┌────────────────────────┐│
│  │  🔥 ACTIVE CASCADE     ││
│  │  BTC SHORT | $4.2M     ││
│  │  45s | ●●●●● CRITICAL  ││
│  └────────────────────────┘│
│                            │
│  ⚡ LIVE FEED              │
│  ────────────────────────  │
│                            │
│  🔴 BTC LONG  $245K   2s  │
│  🟢 ETH SHORT  $89K   5s  │
│  🔴 BTC LONG  $156K   8s  │
│  🔥 BTC LONG $1.2M   12s  │
│  🟢 SOL SHORT  $45K  15s  │
│  🔴 ETH LONG  $178K  18s  │
│                            │
│  [Load More...]            │
│                            │
└────────────────────────────┘
```

### 5.5 Color System & Visual Language

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  LIQUIDATION MONITOR - VISUAL DESIGN SYSTEM                                    │
│  ══════════════════════════════════════════                                    │
│                                                                                 │
│  COLOR PALETTE                                                                  │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  Position Colors:                                                               │
│  ├── Long Liquidation:   #EF4444 (Red-500)      - Bearish signal               │
│  └── Short Liquidation:  #22C55E (Green-500)    - Bullish signal               │
│                                                                                 │
│  Intensity Scale (Heatmap):                                                     │
│  ├── Low:      #3B82F6 (Blue-500)    opacity: 0.3                              │
│  ├── Medium:   #F59E0B (Amber-500)   opacity: 0.5                              │
│  ├── High:     #EF4444 (Red-500)     opacity: 0.7                              │
│  └── Extreme:  #DC2626 (Red-600)     opacity: 1.0 + pulse animation            │
│                                                                                 │
│  Alert Severity:                                                                │
│  ├── Warning:  #F59E0B (Amber-500)   - Elevated activity                       │
│  ├── Critical: #EF4444 (Red-500)     - Cascade detected                        │
│  └── Extreme:  #7C3AED (Violet-600)  - Major market event                      │
│                                                                                 │
│  SIZE INDICATORS                                                                │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  Liquidation Value Thresholds:                                                  │
│  ├── Small:    < $50K       Normal text, subtle styling                        │
│  ├── Medium:   $50K - $100K  Slightly larger, standard highlight               │
│  ├── Large:    $100K - $1M   Bold text, accent border                          │
│  └── Whale:    > $1M         Extra large, 🔥 icon, glow effect, sound          │
│                                                                                 │
│  ANIMATIONS                                                                     │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  New Liquidation Entry:                                                         │
│  └── Slide in from left, fade in, scale up (0.3s ease-out)                     │
│                                                                                 │
│  Cascade Alert:                                                                 │
│  └── Pulse animation (0.5s infinite), border glow effect                       │
│                                                                                 │
│  Heatmap Update:                                                                │
│  └── Smooth width/opacity transition (0.3s ease-in-out)                        │
│                                                                                 │
│  Price Line:                                                                    │
│  └── Subtle bounce on price change (0.2s)                                      │
│                                                                                 │
│  ICONOGRAPHY                                                                    │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  ├── 📈 TrendingUp      - Short liquidation (price going up)                   │
│  ├── 📉 TrendingDown    - Long liquidation (price going down)                  │
│  ├── 🔥 Flame           - Whale liquidation (>$1M)                             │
│  ├── ⚡ Zap             - Live feed indicator                                  │
│  ├── ⚠️  AlertTriangle   - Warning level cascade                               │
│  ├── 🚨 Siren           - Critical cascade                                     │
│  ├── 📊 BarChart        - Statistics section                                   │
│  └── 🎯 Target          - Price level indicator                                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Real-Time Data Strategy

### 6.1 Polling Architecture

Given the current Lazuli architecture (no WebSocket infrastructure), we'll use optimized polling:

```typescript
/**
 * Real-Time Update Strategy
 *
 * Tier 1 - Critical Data (5s interval):
 * - Live liquidation feed
 * - Cascade alerts
 *
 * Tier 2 - Important Data (15s interval):
 * - Liquidation statistics
 * - Heatmap updates
 *
 * Tier 3 - Background Data (60s interval):
 * - Cross-exchange comparison
 * - Historical patterns
 */

const REFRESH_INTERVALS = {
  LIVE_FEED: 5000,      // 5 seconds
  CASCADE_ALERTS: 5000,  // 5 seconds
  STATS: 15000,         // 15 seconds
  HEATMAP: 15000,       // 15 seconds
  CROSS_EXCHANGE: 60000, // 60 seconds
  ZONES: 60000,         // 60 seconds
};
```

### 6.2 Caching Strategy

```typescript
/**
 * Cache Configuration for Liquidation Data
 */
const CACHE_CONFIG = {
  // Live data - very short cache
  'liquidations:live': {
    ttl: 3,  // 3 seconds
    staleWhileRevalidate: true,
  },

  // Statistics - moderate cache
  'liquidations:stats': {
    ttl: 15, // 15 seconds
    staleWhileRevalidate: true,
  },

  // Heatmap - longer cache (computationally expensive)
  'liquidations:heatmap': {
    ttl: 30, // 30 seconds
    staleWhileRevalidate: true,
  },

  // Zones - longest cache (historical data)
  'liquidations:zones': {
    ttl: 60, // 60 seconds
    staleWhileRevalidate: true,
  },
};
```

### 6.3 Future WebSocket Enhancement

```typescript
/**
 * WebSocket Integration (Future Enhancement)
 *
 * When WebSocket support is added, the liquidation monitor
 * will upgrade to true real-time streaming:
 *
 * - Binance: wss://fstream.binance.com/ws/<symbol>@forceOrder
 * - Bybit: wss://stream.bybit.com/v5/public/linear (liquidation topic)
 * - OKX: wss://ws.okx.com:8443/ws/v5/public (liquidation channel)
 *
 * The frontend architecture (hooks, components) is designed
 * to easily switch from polling to WebSocket with minimal changes.
 */
```

---

## 7. Implementation Plan

### Phase 1: Backend Foundation (3-4 days)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: BACKEND FOUNDATION                                                │
│  ═══════════════════════════                                                │
│                                                                             │
│  □ Create shared types (packages/shared/src/liquidation.ts)                 │
│    ├── LiquidationEvent interface                                           │
│    ├── LiquidationStats interface                                           │
│    ├── LiquidationHeatmap interface                                         │
│    ├── CascadeAlert interface                                               │
│    └── LiquidationZone interface                                            │
│                                                                             │
│  □ Implement liquidationService (apps/api/src/services/)                    │
│    ├── CCXT integration for fetchLiquidations                               │
│    ├── Multi-exchange aggregation                                           │
│    ├── Statistics calculation                                               │
│    ├── Heatmap generation                                                   │
│    └── Cascade detection algorithm                                          │
│                                                                             │
│  □ Create liquidation routes (apps/api/src/routes/)                         │
│    ├── GET /liquidations/:exchange                                          │
│    ├── GET /liquidations/:exchange/:symbol                                  │
│    ├── GET /liquidations/aggregate/:symbol                                  │
│    ├── GET /liquidations/stats/:exchange                                    │
│    ├── GET /liquidations/heatmap/:exchange/:symbol                          │
│    ├── GET /liquidations/cascades                                           │
│    └── GET /liquidations/zones/:exchange/:symbol                            │
│                                                                             │
│  □ Add caching layer for liquidation data                                   │
│                                                                             │
│  □ Write API tests                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Frontend Components (3-4 days)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: FRONTEND COMPONENTS                                               │
│  ════════════════════════════                                               │
│                                                                             │
│  □ Extend API client (apps/web/lib/api-client.ts)                           │
│    └── Add all liquidation endpoints                                        │
│                                                                             │
│  □ Create useLiquidationFeed hook                                           │
│    ├── Real-time event tracking                                             │
│    ├── New event detection                                                  │
│    └── Statistics calculation                                               │
│                                                                             │
│  □ Build LiquidationFeed component                                          │
│    ├── Animated event list                                                  │
│    ├── Color-coded by side                                                  │
│    ├── Size-based emphasis                                                  │
│    └── Time-ago formatting                                                  │
│                                                                             │
│  □ Build LiquidationStats component                                         │
│    ├── Summary cards                                                        │
│    ├── Long/Short ratio                                                     │
│    └── Intensity meter                                                      │
│                                                                             │
│  □ Build LiquidationHeatmap component                                       │
│    ├── Price-level bars                                                     │
│    ├── Intensity coloring                                                   │
│    ├── Current price indicator                                              │
│    └── Tooltip details                                                      │
│                                                                             │
│  □ Build CascadeAlerts component                                            │
│    ├── Alert cards                                                          │
│    ├── Severity indicators                                                  │
│    └── Active/ended states                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: Page Integration (2-3 days)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: PAGE INTEGRATION                                                  │
│  ═════════════════════════                                                  │
│                                                                             │
│  □ Create liquidations page (apps/web/app/liquidations/)                    │
│    ├── page.tsx (server component)                                          │
│    ├── loading.tsx (skeleton)                                               │
│    └── liquidations-client.tsx (interactive)                                │
│                                                                             │
│  □ Implement responsive layout                                              │
│    ├── Desktop grid (stats + heatmap + feed)                                │
│    ├── Tablet layout (stacked cards)                                        │
│    └── Mobile layout (tabs/accordion)                                       │
│                                                                             │
│  □ Add to navigation sidebar                                                │
│                                                                             │
│  □ Implement exchange/symbol selectors                                      │
│                                                                             │
│  □ Add refresh controls                                                     │
│    ├── Auto-refresh toggle                                                  │
│    ├── Manual refresh button                                                │
│    └── Refresh countdown                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 4: Polish & Enhancements (2 days)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: POLISH & ENHANCEMENTS                                             │
│  ══════════════════════════════                                             │
│                                                                             │
│  □ Add animations (Framer Motion)                                           │
│    ├── Feed item entry/exit                                                 │
│    ├── Stats counter updates                                                │
│    └── Cascade alert pulse                                                  │
│                                                                             │
│  □ Implement sound alerts (optional)                                        │
│    ├── Whale liquidation sound                                              │
│    ├── Cascade alert sound                                                  │
│    └── User preference toggle                                               │
│                                                                             │
│  □ Add keyboard shortcuts                                                   │
│    ├── R - manual refresh                                                   │
│    ├── P - pause/resume auto-refresh                                        │
│    └── 1-4 - switch exchanges                                               │
│                                                                             │
│  □ Performance optimization                                                 │
│    ├── Virtualization for long lists                                        │
│    ├── Debounced updates                                                    │
│    └── Memoized calculations                                                │
│                                                                             │
│  □ Error handling & edge cases                                              │
│    ├── Exchange unavailable                                                 │
│    ├── Rate limiting                                                        │
│    └── Empty states                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: API Reference Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/liquidations/:exchange` | GET | Recent liquidations for exchange |
| `/api/v1/liquidations/:exchange/:symbol` | GET | Liquidations for specific symbol |
| `/api/v1/liquidations/aggregate/:symbol` | GET | Cross-exchange aggregation |
| `/api/v1/liquidations/stats/:exchange` | GET | Liquidation statistics |
| `/api/v1/liquidations/heatmap/:exchange/:symbol` | GET | Price-level heatmap data |
| `/api/v1/liquidations/cascades` | GET | Active cascade alerts |
| `/api/v1/liquidations/zones/:exchange/:symbol` | GET | High-risk price zones |

---

## Appendix B: Component Hierarchy

```
LiquidationsPage (Server)
└── LiquidationsClient (Client)
    ├── ExchangeSelector
    ├── SymbolSelector
    ├── RefreshControls
    ├── StatsGrid
    │   ├── StatCard (Total Volume)
    │   ├── StatCard (Long/Short Ratio)
    │   ├── StatCard (Largest Liquidation)
    │   └── StatCard (Intensity)
    ├── CascadeAlerts
    │   └── CascadeAlertCard[]
    ├── LiquidationHeatmap
    │   └── HeatmapBar[]
    └── LiquidationFeed
        └── LiquidationItem[]
```

---

## Appendix C: Dependencies

### Backend
- `ccxt` (existing) - Exchange liquidation data
- No new dependencies required

### Frontend
- `framer-motion` (existing) - Animations
- `recharts` (existing) - Time-series charts
- `lucide-react` (existing) - Icons
- No new dependencies required

---

*Document Version: 1.0*
*Last Updated: December 2024*
*Author: Claude (Full-Stack Architect)*
