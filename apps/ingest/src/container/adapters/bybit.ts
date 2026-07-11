import type { RealtimeEvent } from '@lazuli/shared';

import type { EmitEvent } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import {
  canonicalSymbol,
  createEvent,
  numberOrNull,
  record,
  requiredNumber,
  rows,
} from './event.ts';

export class BybitAdapter extends ExchangeAdapter {
  readonly #depthSequences = new Map<string, number>();

  constructor(symbols: string[], emit: EmitEvent) {
    super('bybit', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://stream.bybit.com/v5/public/linear';
  }

  protected subscribe(socket: WebSocket): void {
    const topics = this.symbols.flatMap((symbol) => {
      const id = canonicalSymbol(symbol);
      return [`publicTrade.${id}`, `tickers.${id}`, `allLiquidation.${id}`, `orderbook.50.${id}`];
    });
    socket.send(JSON.stringify({ op: 'subscribe', args: topics, req_id: crypto.randomUUID() }));
  }

  protected heartbeat(socket: WebSocket): void {
    socket.send(JSON.stringify({ op: 'ping', req_id: crypto.randomUUID() }));
  }

  protected handleMessage(message: string): void {
    const envelope = record(JSON.parse(message));
    const topicName = String(envelope.topic ?? '');
    if (!topicName) return;
    const timestamp = Number(envelope.ts ?? Date.now());

    if (topicName.startsWith('publicTrade.')) {
      for (const item of Array.isArray(envelope.data) ? envelope.data : []) {
        const trade = record(item);
        const symbol = canonicalSymbol(String(trade.s ?? topicName.split('.').at(-1) ?? ''));
        const topic = `trades:bybit:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'trade' }>>({
            type: 'trade',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: Number(trade.T ?? timestamp),
            provider: 'bybit',
            upstreamSequence: String(trade.i ?? ''),
            payload: {
              exchange: 'bybit',
              symbol,
              tradeId: String(trade.i ?? `${trade.T}-${trade.p}`),
              price: requiredNumber(trade.p, 'trade price'),
              quantity: requiredNumber(trade.v, 'trade quantity'),
              side: trade.S === 'Sell' ? 'sell' : 'buy',
            },
          })
        );
      }
      return;
    }

    if (topicName.startsWith('tickers.')) {
      const ticker = record(envelope.data);
      const symbol = canonicalSymbol(String(ticker.symbol ?? topicName.split('.').at(-1) ?? ''));
      const topic = `ticker:bybit:${symbol}` as const;
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'ticker' }>>({
          type: 'ticker',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'bybit',
          upstreamSequence: Number(envelope.cs) || undefined,
          payload: {
            exchange: 'bybit',
            symbol,
            marketType: 'perp',
            bid: numberOrNull(ticker.bid1Price),
            ask: numberOrNull(ticker.ask1Price),
            last: numberOrNull(ticker.lastPrice),
            volume24h: numberOrNull(ticker.volume24h),
            change24hPercent:
              numberOrNull(ticker.price24hPcnt) === null
                ? null
                : requiredNumber(ticker.price24hPcnt, 'price change') * 100,
          },
        })
      );

      if (numberOrNull(ticker.fundingRate) !== null) {
        const fundingTopic = `funding:bybit:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'funding' }>>({
            type: 'funding',
            topic: fundingTopic,
            sequence: this.nextSequence(fundingTopic),
            exchangeTimestamp: timestamp,
            provider: 'bybit',
            payload: {
              exchange: 'bybit',
              symbol,
              fundingRate: requiredNumber(ticker.fundingRate, 'funding rate'),
              nextFundingAt: numberOrNull(ticker.nextFundingTime),
            },
          })
        );
      }

      if (numberOrNull(ticker.openInterest) !== null) {
        const oi = requiredNumber(ticker.openInterest, 'open interest');
        const oiTopic = `open-interest:bybit:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'open-interest' }>>({
            type: 'open-interest',
            topic: oiTopic,
            sequence: this.nextSequence(oiTopic),
            exchangeTimestamp: timestamp,
            provider: 'bybit',
            payload: {
              exchange: 'bybit',
              symbol,
              openInterest: oi,
              openInterestUsd:
                numberOrNull(ticker.markPrice) === null
                  ? null
                  : oi * requiredNumber(ticker.markPrice, 'mark price'),
              change5mPercent: null,
              change1hPercent: null,
              change24hPercent: null,
            },
          })
        );
      }
      return;
    }

    if (topicName.startsWith('allLiquidation.')) {
      for (const item of Array.isArray(envelope.data) ? envelope.data : []) {
        const liquidation = record(item);
        const symbol = canonicalSymbol(String(liquidation.s ?? topicName.split('.').at(-1) ?? ''));
        const price = requiredNumber(liquidation.p, 'liquidation price');
        const quantity = requiredNumber(liquidation.v, 'liquidation quantity');
        const topic = `liquidations:bybit:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'liquidation-print' }>>({
            type: 'liquidation-print',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: Number(liquidation.T ?? timestamp),
            provider: 'bybit',
            payload: {
              exchange: 'bybit',
              symbol,
              side: liquidation.S === 'Sell' ? 'long' : 'short',
              price,
              quantity,
              notionalUsd: price * quantity,
            },
          })
        );
      }
      return;
    }

    if (topicName.startsWith('orderbook.')) {
      const book = record(envelope.data);
      const symbol = canonicalSymbol(String(book.s ?? topicName.split('.').at(-1) ?? ''));
      const current = Number(book.u);
      const previous = this.#depthSequences.get(symbol) ?? null;
      if (String(envelope.type) === 'delta')
        this.detectGap(`bybit:${symbol}:depth`, previous, current);
      this.#depthSequences.set(symbol, current);
      const topic = `orderbook:bybit:${symbol}` as const;
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
          type: 'orderbook-delta',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: Number(envelope.cts ?? timestamp),
          provider: 'bybit',
          upstreamSequence: current,
          payload: {
            exchange: 'bybit',
            symbol,
            firstSequence: current,
            lastSequence: current,
            bids: rows(book.b).map((row) => [
              requiredNumber(row[0], 'bid price'),
              requiredNumber(row[1], 'bid quantity'),
            ]),
            asks: rows(book.a).map((row) => [
              requiredNumber(row[0], 'ask price'),
              requiredNumber(row[1], 'ask quantity'),
            ]),
            reset: String(envelope.type) === 'snapshot',
          },
        })
      );
    }
  }

  protected async reconcileAll(): Promise<void> {
    await Promise.all(
      this.symbols.map(async (symbol) => {
        const id = canonicalSymbol(symbol);
        const response = await fetch(
          `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${id}&limit=50`,
          { signal: AbortSignal.timeout(5_000) }
        );
        if (!response.ok) throw new Error(`Bybit depth snapshot failed: ${response.status}`);
        const envelope = record(await response.json());
        const result = record(envelope.result);
        const sequence = Number(result.u);
        this.#depthSequences.set(id, sequence);
        const topic = `orderbook:bybit:${id}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
            type: 'orderbook-delta',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: Number(envelope.time ?? Date.now()),
            provider: 'bybit',
            upstreamSequence: sequence,
            quality: 'snapshot',
            payload: {
              exchange: 'bybit',
              symbol: id,
              firstSequence: sequence,
              lastSequence: sequence,
              bids: rows(result.b).map((row) => [
                requiredNumber(row[0], 'bid price'),
                requiredNumber(row[1], 'bid quantity'),
              ]),
              asks: rows(result.a).map((row) => [
                requiredNumber(row[0], 'ask price'),
                requiredNumber(row[1], 'ask quantity'),
              ]),
              reset: true,
            },
          })
        );
      })
    );
  }
}
