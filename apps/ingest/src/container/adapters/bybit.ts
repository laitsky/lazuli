import type { RealtimeEvent } from '@lazuli/shared';

import type { EmitEvent } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import { fetchBybitOrderbook } from './bybit-rest.ts';
import {
  canonicalSymbol,
  createEvent,
  marketTopic,
  numberOrNull,
  record,
  requiredNumber,
  rows,
} from './event.ts';
import { bybitDepthDecision, validSequence } from './sequence.ts';

export class BybitAdapter extends ExchangeAdapter {
  readonly #depthSequences = new Map<string, number>();
  readonly #frozenSymbols = new Set<string>();
  readonly #awaitingSnapshotSymbols = new Set<string>();
  protected override reconcileOnConnect = false;

  constructor(symbols: string[], emit: EmitEvent) {
    super('bybit', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://stream.bybit.com/v5/public/linear';
  }

  protected subscribe(socket: WebSocket): void {
    this.#depthSequences.clear();
    this.#frozenSymbols.clear();
    this.#awaitingSnapshotSymbols.clear();
    for (const symbol of this.symbols) {
      this.#awaitingSnapshotSymbols.add(canonicalSymbol(symbol));
    }
    this.health.pendingSnapshots = this.#awaitingSnapshotSymbols.size;
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
        const topic = marketTopic('trades', 'bybit', symbol, 'perp');
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
      const topic = marketTopic('ticker', 'bybit', symbol, 'perp');
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
        const fundingTopic = marketTopic('funding', 'bybit', symbol, 'perp');
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
        const oiTopic = marketTopic('open-interest', 'bybit', symbol, 'perp');
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
        const liquidationTimestamp = Number(liquidation.T ?? timestamp);
        if (!freshBybitLiquidationTimestamp(liquidationTimestamp)) {
          this.discardStaleEvent();
          continue;
        }
        const symbol = canonicalSymbol(String(liquidation.s ?? topicName.split('.').at(-1) ?? ''));
        const price = requiredNumber(liquidation.p, 'liquidation price');
        const quantity = requiredNumber(liquidation.v, 'liquidation quantity');
        const topic = marketTopic('liquidations', 'bybit', symbol, 'perp');
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'liquidation-print' }>>({
            type: 'liquidation-print',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: liquidationTimestamp,
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
      const messageType = String(envelope.type);
      if (!validSequence(current)) throw new Error(`invalid Bybit depth sequence for ${symbol}`);
      const decision = bybitDepthDecision({
        previous,
        current,
        messageType,
        awaitingSnapshot: this.#awaitingSnapshotSymbols.has(symbol),
        frozen: this.#frozenSymbols.has(symbol),
      });
      if (decision === 'reset') {
        this.#awaitingSnapshotSymbols.delete(symbol);
        this.health.pendingSnapshots = this.#awaitingSnapshotSymbols.size;
        this.#frozenSymbols.delete(symbol);
        this.#depthSequences.set(symbol, current);
        if (this.#frozenSymbols.size === 0 && this.#awaitingSnapshotSymbols.size === 0) {
          this.markProtocolRecovery();
        }
      } else if (decision === 'freeze') {
        if (!this.#frozenSymbols.has(symbol)) {
          this.#frozenSymbols.add(symbol);
          this.reportSequenceGap(`bybit:${symbol}:depth`, (previous ?? current) + 1, current);
        }
        return;
      } else if (decision === 'ignore-until-reset') {
        return;
      }
      this.#depthSequences.set(symbol, current);
      const topic = marketTopic('orderbook', 'bybit', symbol, 'perp');
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
            reset: messageType === 'snapshot' || current === 1,
          },
        })
      );
    }
  }

  protected async reconcileAll(): Promise<void> {
    const targets =
      this.#frozenSymbols.size > 0
        ? [...this.#frozenSymbols]
        : this.symbols.map((symbol) => canonicalSymbol(symbol));
    try {
      await Promise.all(targets.map((symbol) => this.reconcile(symbol)));
      if (this.#frozenSymbols.size > 0) {
        throw new Error('A new Bybit gap appeared while reconciliation was in progress');
      }
    } catch (error) {
      this.reconnectForSnapshot(
        `Bybit REST reconciliation unavailable; reconnecting for authoritative WebSocket snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async reconcile(id: string): Promise<void> {
    const { envelope, result } = await fetchBybitOrderbook(id);
    if (!this.#frozenSymbols.has(id)) return;
    const sequence = Number(result.u);
    if (!validSequence(sequence))
      throw new Error(`Bybit depth snapshot sequence invalid for ${id}`);
    const topic = marketTopic('orderbook', 'bybit', id, 'perp');
    this.publish(
      createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
        type: 'orderbook-delta',
        topic,
        sequence: this.nextSequence(topic),
        exchangeTimestamp: Number(envelope.time ?? result.ts ?? Date.now()),
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
    // REST update IDs correspond to the 1000-level feed, not this 50-level stream.
    // The snapshot is authoritative state; accept the next live delta as the new baseline.
    this.#depthSequences.delete(id);
    this.#frozenSymbols.delete(id);
  }
}

export function freshBybitLiquidationTimestamp(
  timestamp: number,
  now = Date.now(),
  maximumAgeMs = 10_000
): boolean {
  return Number.isFinite(timestamp) && timestamp >= now - maximumAgeMs && timestamp <= now + 5_000;
}
