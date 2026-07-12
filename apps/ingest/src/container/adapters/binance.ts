import type { RealtimeEvent, RealtimeTopic } from '@lazuli/shared';

import type { EmitEvent } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import { canonicalSymbol, createEvent, record, requiredNumber, rows } from './event.ts';
import {
  binanceDepthIsContinuous,
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

export class BinanceAdapter extends ExchangeAdapter {
  readonly #depthSequences = new Map<string, number>();
  readonly #depthBuffers = new Map<string, BufferedDepth[]>();
  readonly #readySymbols = new Set<string>();
  readonly #frozenSymbols = new Set<string>();

  constructor(symbols: string[], emit: EmitEvent) {
    super('binance', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://fstream.binance.com/ws';
  }

  protected subscribe(socket: WebSocket): void {
    this.#depthSequences.clear();
    this.#depthBuffers.clear();
    this.#readySymbols.clear();
    this.#frozenSymbols.clear();
    this.health.pendingSnapshots = this.symbols.length;
    const streams = this.symbols.flatMap((symbol) => {
      const id = canonicalSymbol(symbol).toLowerCase();
      return [
        `${id}@aggTrade`,
        `${id}@bookTicker`,
        `${id}@forceOrder`,
        `${id}@depth@100ms`,
        `${id}@markPrice@1s`,
      ];
    });
    socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: streams, id: Date.now() }));
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
      const topic = `trades:binance:${symbol}` as const;
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
      const topic = `ticker:binance:${symbol}` as const;
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
      const topic = `liquidations:binance:${orderSymbol}` as const;
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
      if (!binanceDepthIsContinuous(previous, depth)) {
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
      const tickerTopic = `ticker:binance:${symbol}` as const;
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
      const topic = `funding:binance:${symbol}` as const;
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
    await Promise.all(this.symbols.map((symbol) => this.reconcile(symbol)));
    if (this.#frozenSymbols.size > 0) {
      throw new Error('A new Binance gap appeared while reconciliation was in progress');
    }
  }

  private async reconcile(symbol: string): Promise<void> {
    const id = canonicalSymbol(symbol);
    const response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${id}&limit=100`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Binance depth snapshot failed: ${response.status}`);
    const data = record(await response.json());
    const last = Number(data.lastUpdateId);
    if (!validSequence(last)) throw new Error(`Binance depth snapshot sequence invalid for ${id}`);
    const topic = `orderbook:binance:${id}` as RealtimeTopic & `orderbook:binance:${string}`;
    this.publish(
      createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
        type: 'orderbook-delta',
        topic,
        sequence: this.nextSequence(topic),
        exchangeTimestamp: Number(data.E ?? Date.now()),
        provider: 'binance',
        upstreamSequence: last,
        quality: 'snapshot',
        payload: {
          exchange: 'binance',
          symbol: id,
          firstSequence: last,
          lastSequence: last,
          bids: rows(data.bids).map((row) => [
            requiredNumber(row[0], 'bid price'),
            requiredNumber(row[1], 'bid quantity'),
          ]),
          asks: rows(data.asks).map((row) => [
            requiredNumber(row[0], 'ask price'),
            requiredNumber(row[1], 'ask quantity'),
          ]),
          reset: true,
        },
      })
    );
    this.#depthSequences.set(id, last);

    const buffered = this.#depthBuffers.get(id) ?? [];
    this.#depthBuffers.set(id, []);
    const bridge = findBinanceSnapshotBridge(last, buffered);
    let previous = last;
    if (bridge >= 0) {
      const bridged = buffered.slice(bridge);
      const firstDepth = bridged.shift();
      if (firstDepth) {
        this.publishDepth(firstDepth);
        previous = firstDepth.last;
      }
      for (const depth of bridged) {
        if (!binanceDepthIsContinuous(previous, depth)) {
          this.#frozenSymbols.add(id);
          throw new Error(
            `Binance buffered depth discontinuity for ${id}: expected predecessor ${previous}, received ${depth.previousFinal ?? depth.first}`
          );
        }
        this.publishDepth(depth);
        previous = depth.last;
      }
    }
    this.#frozenSymbols.delete(id);
    this.#readySymbols.add(id);
    this.health.pendingSnapshots = this.symbols.length - this.#readySymbols.size;
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
    const topic = `orderbook:binance:${depth.symbol}` as const;
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
