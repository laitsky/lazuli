import type { RealtimeEvent, RealtimeTopic } from '@lazuli/shared';

import type { EmitEvent } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import { canonicalSymbol, createEvent, record, requiredNumber, rows } from './event.ts';

export class BinanceAdapter extends ExchangeAdapter {
  readonly #depthSequences = new Map<string, number>();

  constructor(symbols: string[], emit: EmitEvent) {
    super('binance', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://fstream.binance.com/ws';
  }

  protected subscribe(socket: WebSocket): void {
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
      this.detectGap(`binance:${symbol}:depth`, previous, first);
      this.#depthSequences.set(symbol, last);
      const topic = `orderbook:binance:${symbol}` as const;
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
          type: 'orderbook-delta',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'binance',
          upstreamSequence: last,
          payload: {
            exchange: 'binance',
            symbol,
            firstSequence: first,
            lastSequence: last,
            bids: rows(data.b).map((row) => [
              requiredNumber(row[0], 'bid price'),
              requiredNumber(row[1], 'bid quantity'),
            ]),
            asks: rows(data.a).map((row) => [
              requiredNumber(row[0], 'ask price'),
              requiredNumber(row[1], 'ask quantity'),
            ]),
            reset: false,
          },
        })
      );
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
  }

  private async reconcile(symbol: string): Promise<void> {
    const id = canonicalSymbol(symbol);
    const response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${id}&limit=100`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Binance depth snapshot failed: ${response.status}`);
    const data = record(await response.json());
    const last = Number(data.lastUpdateId);
    this.#depthSequences.set(id, last);
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
  }
}
