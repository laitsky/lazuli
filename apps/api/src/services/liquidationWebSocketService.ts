/**
 * Liquidation WebSocket Service
 *
 * Manages real-time WebSocket connections to exchanges for live liquidation data.
 * Uses Bun's native WebSocket implementation for optimal performance.
 *
 * Supported WebSocket streams:
 * - Binance: wss://fstream.binance.com/ws/!forceOrder@arr (all liquidations)
 * - Bybit: wss://stream.bybit.com/v5/public/linear (liquidation topic)
 * - OKX: wss://ws.okx.com:8443/ws/v5/public (liquidation-orders channel)
 * - Hyperliquid: wss://api.hyperliquid.xyz/ws (trades channel with liquidation filter)
 *
 * Architecture:
 * - Each exchange has its own WebSocket connection
 * - Connections are automatically reconnected on failure
 * - Events are emitted to subscribers via callback pattern
 * - Heartbeat/ping-pong mechanism to keep connections alive
 */

import { createServiceLogger } from '../utils/logger';
import { LiquidationEvent, LiquidationExchange } from '@lazuli/shared';

// Create logger for WebSocket service
const log = createServiceLogger('liquidation-ws');

/**
 * WebSocket connection configuration
 */
interface WebSocketConfig {
  url: string;
  exchange: LiquidationExchange;
  pingInterval: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
}

/**
 * WebSocket connection state
 */
interface WebSocketConnection {
  ws: WebSocket | null;
  config: WebSocketConfig;
  isConnected: boolean;
  reconnectAttempts: number;
  pingTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastMessageTime: number;
}

/**
 * Callback type for liquidation events
 */
type LiquidationCallback = (event: LiquidationEvent) => void;

/**
 * Exchange WebSocket configurations
 */
const EXCHANGE_WS_CONFIGS: Record<LiquidationExchange, WebSocketConfig> = {
  binance: {
    url: 'wss://fstream.binance.com/ws/!forceOrder@arr',
    exchange: 'binance',
    pingInterval: 30000, // 30 seconds
    reconnectDelay: 5000, // 5 seconds
    maxReconnectAttempts: 10,
  },
  bybit: {
    url: 'wss://stream.bybit.com/v5/public/linear',
    exchange: 'bybit',
    pingInterval: 20000, // 20 seconds
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  },
  okx: {
    url: 'wss://ws.okx.com:8443/ws/v5/public',
    exchange: 'okx',
    pingInterval: 25000, // 25 seconds
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  },
  hyperliquid: {
    url: 'wss://api.hyperliquid.xyz/ws',
    exchange: 'hyperliquid',
    pingInterval: 30000,
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  },
};

/**
 * LiquidationWebSocketService
 *
 * Manages WebSocket connections to exchanges for real-time liquidation data.
 * Provides subscription mechanism for components to receive liquidation events.
 */
class LiquidationWebSocketService {
  private connections: Map<LiquidationExchange, WebSocketConnection> = new Map();
  private subscribers: Set<LiquidationCallback> = new Set();
  private eventBuffer: LiquidationEvent[] = [];
  private maxBufferSize = 1000;

  /**
   * Subscribe to liquidation events
   * @param callback - Function called when new liquidation event is received
   * @returns Unsubscribe function
   */
  subscribe(callback: LiquidationCallback): () => void {
    this.subscribers.add(callback);
    log.debug('Subscriber added', { subscriberCount: this.subscribers.size });

    return () => {
      this.subscribers.delete(callback);
      log.debug('Subscriber removed', { subscriberCount: this.subscribers.size });
    };
  }

  /**
   * Get recent liquidation events from buffer
   * @param limit - Maximum number of events to return
   * @returns Array of recent liquidation events
   */
  getRecentEvents(limit: number = 100): LiquidationEvent[] {
    return this.eventBuffer.slice(-limit);
  }

  /**
   * Get recent liquidation events for a specific exchange
   * @param exchange - Exchange to filter by
   * @param limit - Maximum number of events to return
   * @param symbol - Optional symbol filter
   * @returns Array of recent liquidation events for the exchange
   */
  getEventsByExchange(
    exchange: LiquidationExchange,
    limit: number = 100,
    symbol?: string
  ): LiquidationEvent[] {
    let events = this.eventBuffer.filter((e) => e.exchange === exchange);

    if (symbol) {
      const normalizedSymbol = symbol.replace('.P', '').replace('-', '').toUpperCase();
      events = events.filter((e) => e.symbol === normalizedSymbol);
    }

    return events.slice(-limit);
  }

  /**
   * Connect to all supported exchanges
   */
  async connectAll(): Promise<void> {
    const exchanges = Object.keys(EXCHANGE_WS_CONFIGS) as LiquidationExchange[];

    await Promise.allSettled(exchanges.map((exchange) => this.connect(exchange)));

    log.info('Connected to all exchanges', {
      connected: Array.from(this.connections.entries())
        .filter(([_, conn]) => conn.isConnected)
        .map(([ex]) => ex),
    });
  }

  /**
   * Connect to a specific exchange WebSocket
   * @param exchange - Exchange identifier
   */
  async connect(exchange: LiquidationExchange): Promise<void> {
    const config = EXCHANGE_WS_CONFIGS[exchange];
    if (!config) {
      log.error('Unknown exchange', { exchange });
      return;
    }

    // Check if already connected
    const existing = this.connections.get(exchange);
    if (existing?.isConnected) {
      log.debug('Already connected', { exchange });
      return;
    }

    const connection: WebSocketConnection = {
      ws: null,
      config,
      isConnected: false,
      reconnectAttempts: 0,
      pingTimer: null,
      reconnectTimer: null,
      lastMessageTime: Date.now(),
    };

    this.connections.set(exchange, connection);

    await this.createWebSocket(exchange, connection);
  }

  /**
   * Create WebSocket connection with event handlers
   */
  private async createWebSocket(
    exchange: LiquidationExchange,
    connection: WebSocketConnection
  ): Promise<void> {
    return new Promise((resolve) => {
      try {
        log.info('Connecting to WebSocket', { exchange, url: connection.config.url });

        const ws = new WebSocket(connection.config.url);

        ws.onopen = () => {
          log.info('WebSocket connected', { exchange });
          connection.isConnected = true;
          connection.reconnectAttempts = 0;
          connection.lastMessageTime = Date.now();

          // Send subscription message for exchanges that require it
          this.sendSubscription(exchange, ws);

          // Start ping timer
          this.startPingTimer(exchange, connection);

          resolve();
        };

        ws.onmessage = (event) => {
          connection.lastMessageTime = Date.now();
          this.handleMessage(exchange, event.data);
        };

        ws.onerror = (error) => {
          log.error('WebSocket error', { exchange, error });
        };

        ws.onclose = (event) => {
          log.warn('WebSocket closed', {
            exchange,
            code: event.code,
            reason: event.reason,
          });

          connection.isConnected = false;
          this.stopPingTimer(connection);

          // Attempt reconnection
          this.scheduleReconnect(exchange, connection);

          if (!connection.isConnected) {
            resolve();
          }
        };

        connection.ws = ws;
      } catch (error) {
        log.error('Failed to create WebSocket', { exchange, error });
        this.scheduleReconnect(exchange, connection);
        resolve();
      }
    });
  }

  /**
   * Send subscription message for exchanges that require explicit subscription
   */
  private sendSubscription(exchange: LiquidationExchange, ws: WebSocket): void {
    switch (exchange) {
      case 'bybit': {
        // Subscribe to liquidation topic for major pairs
        const subscribeMsg = {
          op: 'subscribe',
          args: ['liquidation.BTCUSDT', 'liquidation.ETHUSDT', 'liquidation.SOLUSDT'],
        };
        ws.send(JSON.stringify(subscribeMsg));
        break;
      }

      case 'okx': {
        // Subscribe to liquidation orders channel
        const subscribeMsg = {
          op: 'subscribe',
          args: [{ channel: 'liquidation-orders', instType: 'SWAP' }],
        };
        ws.send(JSON.stringify(subscribeMsg));
        break;
      }

      case 'hyperliquid': {
        // Subscribe to all trades (will filter for liquidations)
        const subscribeMsg = {
          method: 'subscribe',
          subscription: { type: 'allMids' },
        };
        ws.send(JSON.stringify(subscribeMsg));
        break;
      }

      case 'binance':
        // Binance uses a stream URL directly, no subscription needed
        break;
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(exchange: LiquidationExchange, data: string | Buffer): void {
    try {
      const message = typeof data === 'string' ? data : data.toString();
      const parsed = JSON.parse(message);

      // Handle ping/pong responses
      if (parsed.ping || parsed.pong || parsed.op === 'pong') {
        return;
      }

      // Parse exchange-specific message format
      const events = this.parseMessage(exchange, parsed);

      for (const event of events) {
        // Add to buffer
        this.eventBuffer.push(event);
        if (this.eventBuffer.length > this.maxBufferSize) {
          this.eventBuffer.shift();
        }

        // Notify subscribers
        for (const callback of this.subscribers) {
          try {
            callback(event);
          } catch (error) {
            log.error('Subscriber callback error', { error });
          }
        }
      }
    } catch (error) {
      log.debug('Failed to parse WebSocket message', { exchange, error });
    }
  }

  /**
   * Parse exchange-specific message format to unified LiquidationEvent
   */
  private parseMessage(exchange: LiquidationExchange, message: any): LiquidationEvent[] {
    const events: LiquidationEvent[] = [];

    switch (exchange) {
      case 'binance':
        // Binance force order format
        if (message.e === 'forceOrder' || message.o) {
          const order = message.o || message;
          const quantity = parseFloat(order.q || '0');
          const price = parseFloat(order.p || '0');

          events.push({
            id: `binance-${order.s}-${message.E || Date.now()}`,
            symbol: order.s,
            exchange: 'binance',
            side: order.S === 'SELL' ? 'long' : 'short',
            price,
            quantity,
            value: quantity * price,
            timestamp: message.E || Date.now(),
          });
        }
        break;

      case 'bybit':
        // Bybit liquidation format
        if (message.topic?.includes('liquidation') && message.data) {
          const data = message.data;
          const quantity = parseFloat(data.size || '0');
          const price = parseFloat(data.price || '0');

          events.push({
            id: `bybit-${data.symbol}-${data.updatedTime || Date.now()}`,
            symbol: data.symbol,
            exchange: 'bybit',
            side: data.side === 'Sell' ? 'long' : 'short',
            price,
            quantity,
            value: quantity * price,
            timestamp: parseInt(data.updatedTime) || Date.now(),
          });
        }
        break;

      case 'okx':
        // OKX liquidation orders format
        if (message.arg?.channel === 'liquidation-orders' && message.data) {
          for (const item of message.data) {
            const quantity = parseFloat(item.sz || '0');
            const price = parseFloat(item.bkPx || '0');

            // Extract symbol from instId (e.g., BTC-USDT-SWAP -> BTCUSDT)
            const symbolParts = item.instId?.split('-') || [];
            const symbol =
              symbolParts.length >= 2 ? `${symbolParts[0]}${symbolParts[1]}` : item.instId;

            events.push({
              id: `okx-${symbol}-${item.ts || Date.now()}`,
              symbol,
              exchange: 'okx',
              side: item.side === 'sell' ? 'long' : 'short',
              price,
              quantity,
              value: quantity * price,
              timestamp: parseInt(item.ts) || Date.now(),
              bankruptcyPrice: parseFloat(item.bkPx || '0'),
            });
          }
        }
        break;

      case 'hyperliquid':
        // Hyperliquid trade format (filter for liquidations)
        if (message.channel === 'trades' && Array.isArray(message.data)) {
          for (const trade of message.data) {
            if (trade.liquidation || trade.crossed) {
              const quantity = parseFloat(trade.sz || '0');
              const price = parseFloat(trade.px || '0');

              events.push({
                id: `hyperliquid-${trade.coin}-${trade.time || Date.now()}`,
                symbol: `${trade.coin}USDT`,
                exchange: 'hyperliquid',
                side: trade.side === 'S' ? 'long' : 'short',
                price,
                quantity,
                value: quantity * price,
                timestamp: trade.time || Date.now(),
              });
            }
          }
        }
        break;
    }

    return events;
  }

  /**
   * Start ping timer to keep connection alive
   */
  private startPingTimer(exchange: LiquidationExchange, connection: WebSocketConnection): void {
    this.stopPingTimer(connection);

    connection.pingTimer = setInterval(() => {
      if (connection.ws && connection.isConnected) {
        switch (exchange) {
          case 'binance':
            // Binance doesn't require explicit pings
            break;
          case 'bybit':
            connection.ws.send(JSON.stringify({ op: 'ping' }));
            break;
          case 'okx':
            connection.ws.send('ping');
            break;
          case 'hyperliquid':
            connection.ws.send(JSON.stringify({ method: 'ping' }));
            break;
        }
      }
    }, connection.config.pingInterval);
  }

  /**
   * Stop ping timer
   */
  private stopPingTimer(connection: WebSocketConnection): void {
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer);
      connection.pingTimer = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(exchange: LiquidationExchange, connection: WebSocketConnection): void {
    if (connection.reconnectTimer) {
      return;
    }

    if (connection.reconnectAttempts >= connection.config.maxReconnectAttempts) {
      log.error('Max reconnection attempts reached', { exchange });
      return;
    }

    const delay = connection.config.reconnectDelay * Math.pow(1.5, connection.reconnectAttempts);
    connection.reconnectAttempts++;

    log.info('Scheduling reconnection', {
      exchange,
      attempt: connection.reconnectAttempts,
      delay,
    });

    connection.reconnectTimer = setTimeout(async () => {
      connection.reconnectTimer = null;
      await this.createWebSocket(exchange, connection);
    }, delay);
  }

  /**
   * Disconnect from a specific exchange
   */
  disconnect(exchange: LiquidationExchange): void {
    const connection = this.connections.get(exchange);
    if (!connection) return;

    this.stopPingTimer(connection);

    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }

    if (connection.ws) {
      connection.ws.close(1000, 'Disconnecting');
      connection.ws = null;
    }

    connection.isConnected = false;
    this.connections.delete(exchange);

    log.info('Disconnected from exchange', { exchange });
  }

  /**
   * Disconnect from all exchanges
   */
  disconnectAll(): void {
    for (const exchange of this.connections.keys()) {
      this.disconnect(exchange);
    }
    this.subscribers.clear();
    this.eventBuffer = [];
    log.info('Disconnected from all exchanges');
  }

  /**
   * Get connection status for all exchanges
   */
  getStatus(): Record<LiquidationExchange, { connected: boolean; lastMessage: number }> {
    const status: Record<string, { connected: boolean; lastMessage: number }> = {};

    for (const [exchange, connection] of this.connections) {
      status[exchange] = {
        connected: connection.isConnected,
        lastMessage: connection.lastMessageTime,
      };
    }

    // Include exchanges that are not connected
    for (const exchange of Object.keys(EXCHANGE_WS_CONFIGS)) {
      if (!(exchange in status)) {
        status[exchange] = {
          connected: false,
          lastMessage: 0,
        };
      }
    }

    return status as Record<LiquidationExchange, { connected: boolean; lastMessage: number }>;
  }

  /**
   * Check if any WebSocket is connected
   */
  isConnected(): boolean {
    for (const connection of this.connections.values()) {
      if (connection.isConnected) return true;
    }
    return false;
  }
}

// Export singleton instance
export const liquidationWebSocketService = new LiquidationWebSocketService();
