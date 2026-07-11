import type { RealtimeEvent } from '@lazuli/shared';

import type { EmitEvent } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import { canonicalSymbol, createEvent, numberOrNull, record, requiredNumber } from './event.ts';

function coin(symbol: string): string {
  return symbol.split('/')[0] ?? symbol;
}

export class HyperliquidAdapter extends ExchangeAdapter {
  constructor(symbols: string[], emit: EmitEvent) {
    super('hyperliquid', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://api.hyperliquid.xyz/ws';
  }

  protected subscribe(socket: WebSocket): void {
    socket.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
    for (const symbol of this.symbols) {
      for (const type of ['trades', 'l2Book', 'activeAssetCtx']) {
        socket.send(
          JSON.stringify({ method: 'subscribe', subscription: { type, coin: coin(symbol) } })
        );
      }
    }
  }

  protected heartbeat(socket: WebSocket): void {
    socket.send(JSON.stringify({ method: 'ping' }));
  }

  protected handleMessage(message: string): void {
    const envelope = record(JSON.parse(message));
    const channel = String(envelope.channel ?? '');
    const data = envelope.data;
    if (channel === 'pong' || channel === 'subscriptionResponse') return;

    if (channel === 'allMids') {
      const mids = record(record(data).mids ?? data);
      for (const configured of this.symbols) {
        const asset = coin(configured);
        if (mids[asset] === undefined) continue;
        const symbol = canonicalSymbol(configured);
        const topic = `ticker:hyperliquid:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'ticker' }>>({
            type: 'ticker',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: Date.now(),
            provider: 'hyperliquid',
            payload: {
              exchange: 'hyperliquid',
              symbol,
              marketType: 'perp',
              bid: null,
              ask: null,
              last: requiredNumber(mids[asset], 'mid price'),
              volume24h: null,
              change24hPercent: null,
            },
          })
        );
      }
    } else if (channel === 'trades') {
      for (const rawTrade of Array.isArray(data) ? data : []) {
        const trade = record(rawTrade);
        const asset = String(trade.coin ?? '');
        const configured = this.symbols.find((value) => coin(value) === asset);
        if (!configured) continue;
        const symbol = canonicalSymbol(configured);
        const topic = `trades:hyperliquid:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'trade' }>>({
            type: 'trade',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: Number(trade.time ?? Date.now()),
            provider: 'hyperliquid',
            upstreamSequence: String(trade.tid ?? trade.hash ?? ''),
            payload: {
              exchange: 'hyperliquid',
              symbol,
              tradeId: String(trade.tid ?? trade.hash ?? trade.time),
              price: requiredNumber(trade.px, 'trade price'),
              quantity: requiredNumber(trade.sz, 'trade quantity'),
              side: trade.side === 'A' ? 'sell' : 'buy',
            },
          })
        );
      }
    } else if (channel === 'l2Book') {
      this.publishBook(record(data), false);
    } else if (channel === 'activeAssetCtx') {
      const wrapper = record(data);
      const asset = String(wrapper.coin ?? '');
      const context = record(wrapper.ctx ?? wrapper);
      const configured = this.symbols.find((value) => coin(value) === asset);
      if (!configured) return;
      const symbol = canonicalSymbol(configured);
      const timestamp = Date.now();
      if (numberOrNull(context.funding) !== null) {
        const topic = `funding:hyperliquid:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'funding' }>>({
            type: 'funding',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: timestamp,
            provider: 'hyperliquid',
            payload: {
              exchange: 'hyperliquid',
              symbol,
              fundingRate: requiredNumber(context.funding, 'funding rate'),
              nextFundingAt: null,
            },
          })
        );
      }
      if (numberOrNull(context.openInterest) !== null) {
        const value = requiredNumber(context.openInterest, 'open interest');
        const mark = numberOrNull(context.markPx);
        const topic = `open-interest:hyperliquid:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'open-interest' }>>({
            type: 'open-interest',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: timestamp,
            provider: 'hyperliquid',
            payload: {
              exchange: 'hyperliquid',
              symbol,
              openInterest: value,
              openInterestUsd: mark === null ? null : value * mark,
              change5mPercent: null,
              change1hPercent: null,
              change24hPercent: null,
            },
          })
        );
      }
    }
  }

  protected async reconcileAll(): Promise<void> {
    await Promise.all(
      this.symbols.map(async (symbol) => {
        const response = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'l2Book', coin: coin(symbol) }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Hyperliquid depth snapshot failed: ${response.status}`);
        this.publishBook(record(await response.json()), true);
      })
    );
  }

  private publishBook(book: Record<string, unknown>, snapshot: boolean): void {
    const asset = String(book.coin ?? '');
    const configured = this.symbols.find((value) => coin(value) === asset);
    if (!configured) return;
    const symbol = canonicalSymbol(configured);
    const levels = Array.isArray(book.levels) ? book.levels : [];
    const convert = (value: unknown): [number, number][] =>
      (Array.isArray(value) ? value : []).map((raw) => {
        const level = record(raw);
        return [requiredNumber(level.px, 'book price'), requiredNumber(level.sz, 'book quantity')];
      });
    const topic = `orderbook:hyperliquid:${symbol}` as const;
    this.publish(
      createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
        type: 'orderbook-delta',
        topic,
        sequence: this.nextSequence(topic),
        exchangeTimestamp: Number(book.time ?? Date.now()),
        provider: 'hyperliquid',
        quality: snapshot ? 'snapshot' : 'live',
        payload: {
          exchange: 'hyperliquid',
          symbol,
          firstSequence: null,
          lastSequence: null,
          bids: convert(levels[0]),
          asks: convert(levels[1]),
          reset: true,
        },
      })
    );
  }
}
