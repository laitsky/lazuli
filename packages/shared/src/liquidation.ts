/**
 * Liquidation Monitor Types
 *
 * Type definitions for real-time cryptocurrency liquidation monitoring.
 * Used for tracking forced liquidations across perpetual futures exchanges.
 *
 * Liquidations occur when a trader's position margin falls below maintenance margin,
 * triggering automatic position closure by the exchange.
 *
 * Key concepts:
 * - Long liquidation: Long position closed, typically bearish signal
 * - Short liquidation: Short position closed, typically bullish signal
 * - Cascade: Multiple liquidations in rapid succession, can accelerate price moves
 */

/**
 * Supported exchanges for liquidation data
 * These exchanges provide liquidation data via API
 */
export type LiquidationExchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid';

/**
 * Core liquidation event from exchange
 * Represents a single forced liquidation order
 */
export interface LiquidationEvent {
  /** Unique identifier for this liquidation event */
  id: string;
  /** Trading pair symbol (e.g., "BTCUSDT") */
  symbol: string;
  /** Source exchange */
  exchange: LiquidationExchange;
  /** Position side that was liquidated */
  side: 'long' | 'short';
  /** Liquidation execution price */
  price: number;
  /** Quantity in base currency (e.g., BTC amount) */
  quantity: number;
  /** Value in quote currency (typically USD) */
  value: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Bankruptcy price - price at which position is completely insolvent (if available) */
  bankruptcyPrice?: number;
  /** Insurance fund contribution - amount taken from insurance fund (if available) */
  insuranceFundContribution?: number;
}

/**
 * Aggregated liquidations from multiple exchanges
 * Combines liquidation data for cross-exchange analysis
 */
export interface AggregatedLiquidations {
  /** Target symbol (e.g., "BTCUSDT") */
  symbol: string;
  /** Combined liquidation events from all exchanges */
  liquidations: LiquidationEvent[];
  /** Per-exchange breakdown statistics */
  byExchange: {
    [exchange: string]: {
      /** Number of liquidations from this exchange */
      count: number;
      /** Total USD value liquidated */
      totalValue: number;
      /** Number of long position liquidations */
      longCount: number;
      /** Number of short position liquidations */
      shortCount: number;
    };
  };
  /** Aggregation metadata */
  meta: {
    /** Exchanges included in aggregation */
    exchanges: string[];
    /** Total number of liquidation events */
    totalCount: number;
    /** Total USD value across all exchanges */
    totalValue: number;
    /** Aggregation timestamp */
    timestamp: number;
  };
}

/**
 * Liquidation statistics for analytics dashboard
 * Provides aggregated metrics over a time period
 */
export interface LiquidationStats {
  /** Target exchange */
  exchange: string;
  /** Optional symbol filter (undefined = all symbols) */
  symbol?: string;
  /** Time period for statistics */
  period: '1h' | '4h' | '24h';
  /** Total number of liquidation events */
  totalCount: number;
  /** Total USD value liquidated */
  totalValue: number;
  /** Number of long position liquidations */
  longCount: number;
  /** Number of short position liquidations */
  shortCount: number;
  /** Total USD value of long liquidations */
  longValue: number;
  /** Total USD value of short liquidations */
  shortValue: number;
  /**
   * Long/Short ratio
   * > 1 = more longs liquidated (bearish pressure)
   * < 1 = more shorts liquidated (bullish pressure)
   */
  longShortRatio: number;
  /** Largest single liquidation in the period */
  largestLiquidation: LiquidationEvent | null;
  /** Liquidation intensity - events per minute average */
  intensity: number;
  /** Top symbols by liquidation volume */
  topSymbols: {
    symbol: string;
    count: number;
    value: number;
  }[];
  /** Hourly breakdown for charting */
  hourlyBreakdown: {
    hour: number;
    count: number;
    value: number;
  }[];
  /** Statistics generation timestamp */
  timestamp: number;
}

/**
 * Heatmap data for price-level liquidation density visualization
 * Shows where liquidations cluster at different price levels
 */
export interface LiquidationHeatmap {
  /** Target symbol */
  symbol: string;
  /** Source exchange */
  exchange: string;
  /** Current market price for reference */
  currentPrice: number;
  /** Price range covered by the heatmap */
  priceRange: {
    min: number;
    max: number;
  };
  /** Price buckets with liquidation density data */
  buckets: LiquidationBucket[];
  /** Heatmap metadata */
  meta: {
    bucketCount: number;
    totalLiquidations: number;
    totalValue: number;
    timestamp: number;
  };
}

/**
 * Single bucket in liquidation heatmap
 * Represents liquidation density at a price level
 */
export interface LiquidationBucket {
  /** Minimum price for this bucket */
  priceMin: number;
  /** Maximum price for this bucket */
  priceMax: number;
  /** Center price for display */
  priceCenter: number;
  /** Number of long liquidations in this price bucket */
  longCount: number;
  /** USD value of long liquidations */
  longValue: number;
  /** Number of short liquidations in this price bucket */
  shortCount: number;
  /** USD value of short liquidations */
  shortValue: number;
  /** Total liquidations in bucket */
  totalCount: number;
  /** Total USD value in bucket */
  totalValue: number;
  /**
   * Normalized intensity (0-1)
   * Used for color scaling in visualization
   */
  intensity: number;
  /** Distance from current price as percentage */
  distanceFromPrice: number;
}

/**
 * Liquidation cascade alert
 * Triggered when liquidation volume exceeds threshold in a short time window
 *
 * Cascades often indicate:
 * - Leverage flush events
 * - Stop-loss hunting
 * - Potential reversal points
 */
export interface CascadeAlert {
  /** Alert identifier */
  id: string;
  /** Affected symbol (e.g., "BTCUSDT") */
  symbol: string;
  /** Source exchange */
  exchange: string;
  /** Type of cascade */
  type: 'long_cascade' | 'short_cascade' | 'mixed_cascade';
  /** Alert severity level */
  severity: 'warning' | 'critical' | 'extreme';
  /** Total USD value liquidated in cascade */
  totalValue: number;
  /** Number of liquidation events in cascade */
  liquidationCount: number;
  /** Cascade duration in seconds */
  duration: number;
  /** Price change during cascade (absolute) */
  priceChange: number;
  /** Price change during cascade (percentage) */
  priceChangePercent: number;
  /** Cascade start timestamp */
  startTime: number;
  /** Most recent liquidation timestamp */
  lastUpdate: number;
  /** Whether cascade is still active (receiving new liquidations) */
  isActive: boolean;
}

/**
 * High-risk liquidation zone on chart
 * Identifies price areas with historically high liquidation activity
 *
 * Useful for:
 * - Setting stop-losses outside liquidation clusters
 * - Identifying potential support/resistance from liquidation pools
 */
export interface LiquidationZone {
  /** Zone identifier */
  id: string;
  /** Zone type - indicates which positions would be liquidated */
  type: 'long_liquidation_zone' | 'short_liquidation_zone';
  /** Zone price range - minimum */
  priceMin: number;
  /** Zone price range - maximum */
  priceMax: number;
  /** Estimated total liquidation value in this zone */
  estimatedValue: number;
  /** Risk level based on liquidation volume */
  risk: 'low' | 'medium' | 'high' | 'extreme';
  /** Distance from current price (absolute) */
  distanceFromPrice: number;
  /** Distance from current price (percentage) */
  distancePercent: number;
}

/**
 * Real-time liquidation feed summary
 * Combines latest events with rolling statistics
 */
export interface LiveLiquidationFeed {
  /** Latest liquidation events */
  events: LiquidationEvent[];
  /** Rolling summary statistics */
  summary: {
    last1m: { count: number; value: number };
    last5m: { count: number; value: number };
    last15m: { count: number; value: number };
  };
  /** Currently active cascade alerts */
  cascades: CascadeAlert[];
  /** Feed generation timestamp */
  timestamp: number;
}

/**
 * Liquidation API response structure
 */
export interface LiquidationResponse {
  /** Exchange identifier */
  exchange: string;
  /** Optional symbol filter */
  symbol?: string;
  /** Liquidation events */
  liquidations: LiquidationEvent[];
  /** Number of events returned */
  count: number;
  /** Response timestamp */
  timestamp: number;
}

/**
 * WebSocket liquidation message structure
 * Used for real-time streaming updates
 */
export interface LiquidationWebSocketMessage {
  /** Message type */
  type: 'liquidation' | 'cascade_alert' | 'stats_update';
  /** Exchange source */
  exchange: LiquidationExchange;
  /** Message payload */
  data: LiquidationEvent | CascadeAlert | LiquidationStats;
  /** Message timestamp */
  timestamp: number;
}

/**
 * Cascade detection configuration
 * Thresholds for triggering cascade alerts
 */
export interface CascadeConfig {
  /** Minimum USD value in time window to trigger cascade (default: $1M) */
  thresholdUsd: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  timeWindowMs: number;
  /** Minimum number of liquidations to consider a cascade */
  minLiquidationCount: number;
}

/**
 * Default cascade detection thresholds
 */
export const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
  thresholdUsd: 1_000_000, // $1M in liquidations
  timeWindowMs: 60_000, // 60 second window
  minLiquidationCount: 5, // At least 5 liquidations
};

/**
 * Severity thresholds for cascade alerts
 */
export const CASCADE_SEVERITY_THRESHOLDS = {
  warning: 1_000_000, // $1M
  critical: 5_000_000, // $5M
  extreme: 10_000_000, // $10M
} as const;
