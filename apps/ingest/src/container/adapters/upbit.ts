import type { RealtimeEvent } from '@lazuli/shared';

import type { EmitEvent } from '../types.ts';
import { ExchangeAdapter } from './base.ts';
import {
  canonicalSymbol,
  createEvent,
  marketTopic,
  numberOrNull,
  record,
  requiredNumber,
} from './event.ts';

function market(symbol: string, quote: string): string {
  const base = symbol.split('/')[0] ?? symbol;
  return `${quote}-${base}`;
}

function canonicalMarket(value: unknown): string {
  const [quote, base] = String(value).split('-');
  return canonicalSymbol(`${base ?? ''}${quote ?? ''}`);
}

export class UpbitAdapter extends ExchangeAdapter {
  constructor(
    symbols: string[],
    emit: EmitEvent,
    private readonly quote: string
  ) {
    super('upbit', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://api.upbit.com/websocket/v1';
  }

  protected subscribe(socket: WebSocket): void {
    const codes = this.symbols.map((symbol) => market(symbol, this.quote));
    socket.send(
      JSON.stringify([
        { ticket: crypto.randomUUID() },
        { type: 'ticker', codes, is_only_realtime: true },
        { type: 'trade', codes, is_only_realtime: true },
        { type: 'orderbook', codes, is_only_realtime: true, level: 0 },
        { format: 'DEFAULT' },
      ])
    );
  }

  protected heartbeat(socket: WebSocket): void {
    socket.send('PING');
  }

  protected handleMessage(message: string): void {
    if (message === 'PONG') return;
    const item = record(JSON.parse(message));
    const type = String(item.type ?? '');
    const symbol = canonicalMarket(item.code);
    const timestamp = Number(item.timestamp ?? Date.now());

    if (type === 'ticker') {
      const topic = marketTopic('ticker', 'upbit', symbol, 'spot');
      const signedChange = numberOrNull(item.signed_change_rate);
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'ticker' }>>({
          type: 'ticker',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'upbit',
          upstreamSequence: numberOrNull(item.sequential_id) ?? undefined,
          payload: {
            exchange: 'upbit',
            symbol,
            marketType: 'spot',
            bid: null,
            ask: null,
            last: numberOrNull(item.trade_price),
            volume24h: numberOrNull(item.acc_trade_volume_24h),
            change24hPercent: signedChange === null ? null : signedChange * 100,
          },
        })
      );
    } else if (type === 'trade') {
      const topic = marketTopic('trades', 'upbit', symbol, 'spot');
      this.publish(
        createEvent<Extract<RealtimeEvent, { type: 'trade' }>>({
          type: 'trade',
          topic,
          sequence: this.nextSequence(topic),
          exchangeTimestamp: timestamp,
          provider: 'upbit',
          upstreamSequence: numberOrNull(item.sequential_id) ?? undefined,
          payload: {
            exchange: 'upbit',
            symbol,
            tradeId: String(item.sequential_id ?? `${timestamp}`),
            price: requiredNumber(item.trade_price, 'trade price'),
            quantity: requiredNumber(item.trade_volume, 'trade quantity'),
            side: item.ask_bid === 'ASK' ? 'sell' : 'buy',
          },
        })
      );
    } else if (type === 'orderbook') {
      this.publishBook(item, false);
    }
  }

  protected async reconcileAll(): Promise<void> {
    const markets = this.symbols.map((symbol) => market(symbol, this.quote)).join(',');
    const response = await fetch(
      `https://api.upbit.com/v1/orderbook?markets=${encodeURIComponent(markets)}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!response.ok) throw new Error(`Upbit depth snapshot failed: ${response.status}`);
    const body: unknown = await response.json();
    for (const item of Array.isArray(body) ? body : []) {
      this.publishBook(record(item), true);
    }
  }

  private publishBook(item: Record<string, unknown>, snapshot: boolean): void {
    const symbol = canonicalMarket(item.code ?? item.market);
    const units = Array.isArray(item.orderbook_units) ? item.orderbook_units : [];
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    for (const rawUnit of units) {
      const unit = record(rawUnit);
      bids.push([
        requiredNumber(unit.bid_price, 'bid price'),
        requiredNumber(unit.bid_size, 'bid quantity'),
      ]);
      asks.push([
        requiredNumber(unit.ask_price, 'ask price'),
        requiredNumber(unit.ask_size, 'ask quantity'),
      ]);
    }
    const sequence = numberOrNull(item.sequential_id);
    const topic = marketTopic('orderbook', 'upbit', symbol, 'spot');
    this.publish(
      createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
        type: 'orderbook-delta',
        topic,
        sequence: this.nextSequence(topic),
        exchangeTimestamp: Number(item.timestamp ?? Date.now()),
        provider: 'upbit',
        upstreamSequence: sequence ?? undefined,
        quality: snapshot ? 'snapshot' : 'live',
        payload: {
          exchange: 'upbit',
          symbol,
          firstSequence: sequence,
          lastSequence: sequence,
          bids,
          asks,
          reset: true,
        },
      })
    );
  }
}
