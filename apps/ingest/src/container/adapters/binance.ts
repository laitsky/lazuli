import type { RealtimeEvent } from '@lazuli/shared';

import type { EmitEvent, ProviderChannelHealth } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import {
  canonicalSymbol,
  createEvent,
  marketTopic,
  record,
  requiredNumber,
  rows,
} from './event.ts';
import {
  binanceDepthDecision,
  findBinanceSnapshotBridge,
  validSequence,
  type BinanceDepthSequence,
} from './sequence.ts';

interface BufferedDepth extends BinanceDepthSequence {
  symbol: string;
  timestamp: number;
  bids: unknown[][];
  asks: unknown[][];
}

const MAX_DEPTH_BUFFER = 5_000;
const SNAPSHOT_BRIDGE_TIMEOUT_MS = 2_000;
const SNAPSHOT_BRIDGE_POLL_MS = 25;
const SNAPSHOT_FETCH_ATTEMPTS = 5;
// Routed endpoints still require an access mode. `/ws` keeps live JSON
// SUBSCRIBE/UNSUBSCRIBE control messages while separating public and market traffic.
const BINANCE_PUBLIC_URL = 'wss://fstream.binance.com/public/ws';
const BINANCE_MARKET_URL = 'wss://fstream.binance.com/market/ws';
const CHANNEL_HEARTBEAT_MS = 15_000;
const CHANNEL_STALE_MS = 45_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BinanceAdapter extends ExchangeAdapter {
  readonly #depthSequences = new Map<string, number>();
  readonly #depthBuffers = new Map<string, BufferedDepth[]>();
  readonly #readySymbols = new Set<string>();
  readonly #frozenSymbols = new Set<string>();
  #marketSocket: WebSocket | null = null;
  #marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #marketHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #marketReconnectAttempt = 0;

  constructor(symbols: string[], emit: EmitEvent) {
    super('binance', symbols, emit);
    this.health.channels = {
      public: channelHealth(),
      market: channelHealth(),
    };
  }

  protected get websocketUrl(): string {
    return BINANCE_PUBLIC_URL;
  }

  protected subscribe(socket: WebSocket): void {
    this.#depthSequences.clear();
    this.#depthBuffers.clear();
    this.#readySymbols.clear();
    this.#frozenSymbols.clear();
    this.health.pendingSnapshots = this.symbols.length;
    const streams = this.symbols.flatMap((symbol) => {
      const id = canonicalSymbol(symbol).toLowerCase();
      return [`${id}@bookTicker`, `${id}@depth@100ms`];
    });
    socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: streams, id: Date.now() }));
    this.refreshAggregateHealth();
  }

  protected onStart(): void {
    this.connectMarket();
  }

  protected onStop(): void {
    if (this.#marketReconnectTimer) clearTimeout(this.#marketReconnectTimer);
    if (this.#marketHeartbeatTimer) clearInterval(this.#marketHeartbeatTimer);
    this.#marketReconnectTimer = null;
    this.#marketHeartbeatTimer = null;
    this.#marketSocket?.close(1000, 'shutdown');
    this.#marketSocket = null;
    for (const channel of Object.values(this.health.channels ?? {})) channel.state = 'stopped';
  }

  protected onPrimaryOpen(): void {
    const channel = this.publicChannel;
    channel.state = 'connected';
    channel.connectedAt = Date.now();
    channel.lastMessageAt = Date.now();
    channel.lastError = null;
  }

  protected onPrimaryMessage(): void {
    this.publicChannel.lastMessageAt = Date.now();
  }

  protected onPrimaryClose(code: number, reason: string): void {
    const channel = this.publicChannel;
    channel.state = 'disconnected';
    channel.reconnects += 1;
    channel.lastError = `public websocket closed (${code}): ${reason || 'no reason'}`;
  }

  protected afterProtocolRecovery(): void {
    this.refreshAggregateHealth();
  }

  protected heartbeat(): void {
    // Binance sends protocol-level ping frames; Bun replies automatically.
  }

  protected handleMessage(message: string): void {
    const data = record(JSON.parse(message));
    const type = String(data.e ?? '');
    const symbol = canonicalSymbol(String(data.s ?? ''));
    const timestamp = Number(data.E ?? data.T ?? Date.now());
    if (!symbol) return;

    if (type === 'aggTrade') {
      const topic = marketTopic('trades', 'binance', symbol, 'perp');
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'trade' }>>({
          type: 'trade',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'binance',
          upstreamSequence: String(data.a),
          payload: {
            exchange: 'binance',
            symbol,
            tradeId: String(data.a),
            price: requiredNumber(data.p, 'trade price'),
            quantity: requiredNumber(data.q, 'trade quantity'),
            side: data.m === true ? 'sell' : 'buy',
          },
        })
      );
      return;
    }

    if (type === 'bookTicker') {
      const topic = marketTopic('ticker', 'binance', symbol, 'perp');
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'ticker' }>>({
          type: 'ticker',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'binance',
          upstreamSequence: String(data.u),
          payload: {
            exchange: 'binance',
            symbol,
            marketType: 'perp',
            bid: requiredNumber(data.b, 'bid'),
            ask: requiredNumber(data.a, 'ask'),
            last: null,
            volume24h: null,
            change24hPercent: null,
          },
        })
      );
      return;
    }

    if (type === 'forceOrder') {
      const order = record(data.o);
      const orderSymbol = canonicalSymbol(String(order.s ?? symbol));
      const price = requiredNumber(order.ap ?? order.p, 'liquidation price');
      const quantity = requiredNumber(order.z ?? order.q, 'liquidation quantity');
      const topic = marketTopic('liquidations', 'binance', orderSymbol, 'perp');
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'liquidation-print' }>>({
          type: 'liquidation-print',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: Number(order.T ?? timestamp),
          provider: 'binance',
          upstreamSequence: String(order.i ?? ''),
          payload: {
            exchange: 'binance',
            symbol: orderSymbol,
            side: order.S === 'SELL' ? 'long' : 'short',
            price,
            quantity,
            notionalUsd: price * quantity,
            orderId: String(order.i ?? ''),
          },
        })
      );
      return;
    }

    if (type === 'depthUpdate') {
      const previous = this.#depthSequences.get(symbol) ?? null;
      const first = Number(data.U);
      const last = Number(data.u);
      const previousFinal = validSequence(Number(data.pu)) ? Number(data.pu) : null;
      if (!validSequence(first) || !validSequence(last) || first > last) {
        throw new Error(`invalid Binance depth sequence for ${symbol}`);
      }
      const depth: BufferedDepth = {
        symbol,
        timestamp,
        first,
        last,
        previousFinal,
        bids: rows(data.b),
        asks: rows(data.a),
      };
      if (!this.#readySymbols.has(symbol)) {
        this.bufferDepth(depth);
        return;
      }
      const decision = binanceDepthDecision(previous, depth);
      if (decision === 'stale') return;
      if (decision === 'gap') {
        this.#readySymbols.delete(symbol);
        this.health.pendingSnapshots = this.symbols.length - this.#readySymbols.size;
        this.#frozenSymbols.add(symbol);
        this.bufferDepth(depth);
        this.reportSequenceGap(
          `binance:${symbol}:depth`,
          previous ?? first,
          previousFinal ?? first
        );
        return;
      }
      this.publishDepth(depth);
      return;
    }

    if (type === 'markPriceUpdate') {
      const markPrice = requiredNumber(data.p, 'mark price');
      const tickerTopic = marketTopic('ticker', 'binance', symbol, 'perp');
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'ticker' }>>({
          type: 'ticker',
          topic: tickerTopic,
          sequence: this.nextSequence(tickerTopic),
          exchangeTimestamp: timestamp,
          provider: 'binance',
          payload: {
            exchange: 'binance',
            symbol,
            marketType: 'perp',
            bid: null,
            ask: null,
            last: markPrice,
            volume24h: null,
            change24hPercent: null,
          },
        })
      );
      const topic = marketTopic('funding', 'binance', symbol, 'perp');
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'funding' }>>({
          type: 'funding',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'binance',
          payload: {
            exchange: 'binance',
            symbol,
            fundingRate: requiredNumber(data.r, 'funding rate'),
            nextFundingAt: Number(data.T) || null,
          },
        })
      );
    }
  }

  protected async reconcileAll(): Promise<void> {
    try {
      await Promise.all(this.symbols.map((symbol) => this.reconcile(symbol)));
      if (this.#frozenSymbols.size > 0) {
        throw new Error('A new Binance gap appeared while reconciliation was in progress');
      }
    } catch (error) {
      this.reconnectForSnapshot(
        `Binance snapshot reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private connectMarket(): void {
    if (this.stopped) return;
    const channel = this.marketChannel;
    channel.state = 'connecting';
    let socket: WebSocket;
    try {
      socket = new WebSocket(BINANCE_MARKET_URL);
    } catch (error) {
      this.scheduleMarketReconnect(error);
      return;
    }
    this.#marketSocket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.#marketSocket) return;
      this.#marketReconnectAttempt = 0;
      channel.state = 'connected';
      channel.connectedAt = Date.now();
      channel.lastMessageAt = Date.now();
      channel.lastError = null;
      const streams = this.symbols.flatMap((symbol) => {
        const id = canonicalSymbol(symbol).toLowerCase();
        return [`${id}@aggTrade`, `${id}@forceOrder`, `${id}@markPrice@1s`];
      });
      socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: streams, id: Date.now() }));
      this.startMarketHeartbeat(socket);
      this.refreshAggregateHealth();
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.#marketSocket) return;
      channel.lastMessageAt = Date.now();
      void decodeWebSocketMessage(event.data)
        .then((message) => this.handleMessage(message))
        .catch((error: unknown) => this.parseError(error));
    });
    socket.addEventListener('error', () => {
      channel.lastError = 'market websocket transport error';
    });
    socket.addEventListener('close', (event) => {
      if (socket !== this.#marketSocket) return;
      this.#marketSocket = null;
      this.scheduleMarketReconnect(
        `market websocket closed (${event.code}): ${event.reason || 'no reason'}`
      );
    });
  }

  private startMarketHeartbeat(socket: WebSocket): void {
    if (this.#marketHeartbeatTimer) clearInterval(this.#marketHeartbeatTimer);
    this.#marketHeartbeatTimer = setInterval(() => {
      if (socket !== this.#marketSocket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - (this.marketChannel.lastMessageAt ?? 0) <= CHANNEL_STALE_MS) return;
      this.marketChannel.state = 'degraded';
      this.marketChannel.lastError = 'market websocket heartbeat timeout';
      this.refreshAggregateHealth();
      socket.close(4000, 'heartbeat timeout');
    }, CHANNEL_HEARTBEAT_MS);
  }

  private scheduleMarketReconnect(error: unknown): void {
    if (this.stopped) return;
    if (this.#marketHeartbeatTimer) clearInterval(this.#marketHeartbeatTimer);
    this.#marketHeartbeatTimer = null;
    const channel = this.marketChannel;
    channel.state = 'disconnected';
    channel.lastError = error instanceof Error ? error.message : String(error);
    channel.reconnects += 1;
    const base = Math.min(30_000, 500 * 2 ** Math.min(this.#marketReconnectAttempt, 6));
    const wait = Math.floor(base / 2 + Math.random() * base);
    this.#marketReconnectAttempt += 1;
    this.#marketReconnectTimer = setTimeout(() => this.connectMarket(), wait);
    this.refreshAggregateHealth();
  }

  private refreshAggregateHealth(): void {
    if (this.stopped) return;
    const publicReady = this.publicChannel.state === 'connected';
    const marketReady = this.marketChannel.state === 'connected';
    if (publicReady && marketReady && this.health.pendingSnapshots === 0) {
      this.health.state = 'connected';
      this.health.lastError = null;
      return;
    }
    this.health.state = publicReady || marketReady ? 'degraded' : 'disconnected';
    this.health.lastError = [
      !publicReady ? (this.publicChannel.lastError ?? 'Binance public channel unavailable') : null,
      !marketReady ? (this.marketChannel.lastError ?? 'Binance market channel unavailable') : null,
      this.health.pendingSnapshots > 0
        ? `${this.health.pendingSnapshots} Binance order books awaiting snapshots`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join('; ');
  }

  private get publicChannel(): ProviderChannelHealth {
    return this.health.channels?.public as ProviderChannelHealth;
  }

  private get marketChannel(): ProviderChannelHealth {
    return this.health.channels?.market as ProviderChannelHealth;
  }

  private async reconcile(symbol: string): Promise<void> {
    const id = canonicalSymbol(symbol);
    let snapshot: Record<string, unknown> | null = null;
    let snapshotSequence: number | null = null;
    let bridged: BufferedDepth[] | null = null;
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt < SNAPSHOT_FETCH_ATTEMPTS; attempt += 1) {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/depth?symbol=${id}&limit=100`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (!response.ok) throw new Error(`Binance depth snapshot failed: ${response.status}`);
      const candidate = record(await response.json());
      const candidateSequence = Number(candidate.lastUpdateId);
      if (!validSequence(candidateSequence)) {
        throw new Error(`Binance depth snapshot sequence invalid for ${id}`);
      }
      try {
        bridged = await this.waitForSnapshotBridge(id, candidateSequence);
        snapshot = candidate;
        snapshotSequence = candidateSequence;
        break;
      } catch (error) {
        lastFailure = error;
      }
    }
    if (!snapshot || snapshotSequence === null || !bridged) {
      throw new Error(
        `Binance snapshot did not bridge buffered depth for ${id}: ${lastFailure instanceof Error ? lastFailure.message : String(lastFailure)}`
      );
    }
    const topic = marketTopic('orderbook', 'binance', id, 'perp');
    this.publish(
      createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
        type: 'orderbook-delta',
        topic,
        sequence: this.nextSequence(topic),
        exchangeTimestamp: Number(snapshot.E ?? Date.now()),
        provider: 'binance',
        upstreamSequence: snapshotSequence,
        quality: 'snapshot',
        payload: {
          exchange: 'binance',
          symbol: id,
          firstSequence: snapshotSequence,
          lastSequence: snapshotSequence,
          bids: rows(snapshot.bids).map((row) => [
            requiredNumber(row[0], 'bid price'),
            requiredNumber(row[1], 'bid quantity'),
          ]),
          asks: rows(snapshot.asks).map((row) => [
            requiredNumber(row[0], 'ask price'),
            requiredNumber(row[1], 'ask quantity'),
          ]),
          reset: true,
        },
      })
    );
    this.#depthSequences.set(id, snapshotSequence);

    this.#depthBuffers.set(id, []);
    let previous = snapshotSequence;
    const firstDepth = bridged.shift();
    if (!firstDepth) throw new Error(`Binance snapshot bridge disappeared for ${id}`);
    this.publishDepth(firstDepth);
    previous = firstDepth.last;
    for (const depth of bridged) {
      const decision = binanceDepthDecision(previous, depth);
      if (decision === 'stale') continue;
      if (decision === 'gap') {
        this.#frozenSymbols.add(id);
        throw new Error(
          `Binance buffered depth discontinuity for ${id}: expected predecessor ${previous}, received ${depth.previousFinal ?? depth.first}`
        );
      }
      this.publishDepth(depth);
      previous = depth.last;
    }
    this.#frozenSymbols.delete(id);
    this.#readySymbols.add(id);
    this.health.pendingSnapshots = this.symbols.length - this.#readySymbols.size;
  }

  private async waitForSnapshotBridge(
    id: string,
    snapshotSequence: number
  ): Promise<BufferedDepth[]> {
    const deadline = Date.now() + SNAPSHOT_BRIDGE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const buffered = (this.#depthBuffers.get(id) ?? []).filter(
        (depth) => depth.last >= snapshotSequence
      );
      this.#depthBuffers.set(id, buffered);
      const bridge = findBinanceSnapshotBridge(snapshotSequence, buffered);
      if (bridge >= 0) return buffered.slice(bridge);
      if (buffered.some((depth) => depth.first > snapshotSequence)) {
        throw new Error(
          `Binance snapshot ${snapshotSequence} is behind the buffered stream for ${id}`
        );
      }
      await delay(SNAPSHOT_BRIDGE_POLL_MS);
    }
    throw new Error(`Timed out waiting for Binance snapshot bridge for ${id}`);
  }

  private bufferDepth(depth: BufferedDepth): void {
    const buffered = this.#depthBuffers.get(depth.symbol) ?? [];
    if (buffered.length >= MAX_DEPTH_BUFFER) {
      buffered.shift();
      if (!this.#frozenSymbols.has(depth.symbol)) {
        this.#frozenSymbols.add(depth.symbol);
        this.reportSequenceGap(`binance:${depth.symbol}:bootstrap-buffer`, depth.first, depth.last);
      }
    }
    buffered.push(depth);
    this.#depthBuffers.set(depth.symbol, buffered);
  }

  private publishDepth(depth: BufferedDepth): void {
    this.#depthSequences.set(depth.symbol, depth.last);
    const topic = marketTopic('orderbook', 'binance', depth.symbol, 'perp');
    this.publish(
      createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
        type: 'orderbook-delta',
        topic,
        sequence: this.nextSequence(topic),
        exchangeTimestamp: depth.timestamp,
        provider: 'binance',
        upstreamSequence: depth.last,
        payload: {
          exchange: 'binance',
          symbol: depth.symbol,
          firstSequence: depth.first,
          lastSequence: depth.last,
          bids: depth.bids.map((row) => [
            requiredNumber(row[0], 'bid price'),
            requiredNumber(row[1], 'bid quantity'),
          ]),
          asks: depth.asks.map((row) => [
            requiredNumber(row[0], 'ask price'),
            requiredNumber(row[1], 'ask quantity'),
          ]),
          reset: false,
        },
      })
    );
  }
}

export function binanceChannelConfiguration(): {
  publicUrl: string;
  marketUrl: string;
  publicStreams: readonly string[];
  marketStreams: readonly string[];
} {
  return {
    publicUrl: BINANCE_PUBLIC_URL,
    marketUrl: BINANCE_MARKET_URL,
    publicStreams: ['bookTicker', 'depth@100ms'],
    marketStreams: ['aggTrade', 'forceOrder', 'markPrice@1s'],
  };
}

function channelHealth(): ProviderChannelHealth {
  return {
    state: 'stopped',
    connectedAt: null,
    lastMessageAt: null,
    reconnects: 0,
    lastError: null,
  };
}

async function decodeWebSocketMessage(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (data instanceof Blob) return data.text();
  throw new Error('unsupported websocket message type');
}
