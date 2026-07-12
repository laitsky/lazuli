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

function instrument(symbol: string): string {
  const [base, quote] = symbol.split('/');
  return `${base}-${quote}-SWAP`;
}

function symbolFromInstrument(value: unknown): string {
  return canonicalSymbol(String(value).replace(/-SWAP$/, ''));
}

export class OkxAdapter extends ExchangeAdapter {
  readonly #depthSequences = new Map<string, number>();

  constructor(symbols: string[], emit: EmitEvent) {
    super('okx', symbols, emit);
  }

  protected get websocketUrl(): string {
    return 'wss://ws.okx.com:8443/ws/v5/public';
  }

  protected subscribe(socket: WebSocket): void {
    const args: Array<Record<string, string>> = this.symbols.flatMap((symbol) => {
      const instId = instrument(symbol);
      return ['trades', 'tickers', 'books5', 'funding-rate'].map((channel) => ({
        channel,
        instId,
      }));
    });
    args.push({ channel: 'liquidation-orders', instType: 'SWAP' });
    socket.send(JSON.stringify({ op: 'subscribe', args }));
  }

  protected heartbeat(socket: WebSocket): void {
    socket.send('ping');
  }

  protected handleMessage(message: string): void {
    if (message === 'pong') return;
    const envelope = record(JSON.parse(message));
    const arg = record(envelope.arg);
    const channel = String(arg.channel ?? '');
    const data = Array.isArray(envelope.data) ? envelope.data : [];

    for (const rawItem of data) {
      const item = record(rawItem);
      const symbol = symbolFromInstrument(item.instId ?? arg.instId);
      const timestamp = Number(item.ts ?? Date.now());
      if (!symbol) continue;

      if (channel === 'trades') {
        const topic = `trades:okx:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'trade' }>>({
            type: 'trade',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: timestamp,
            provider: 'okx',
            upstreamSequence: String(item.tradeId ?? ''),
            payload: {
              exchange: 'okx',
              symbol,
              tradeId: String(item.tradeId ?? `${timestamp}`),
              price: requiredNumber(item.px, 'trade price'),
              quantity: requiredNumber(item.sz, 'trade quantity'),
              side: item.side === 'sell' ? 'sell' : 'buy',
            },
          })
        );
      } else if (channel === 'tickers') {
        const topic = `ticker:okx:${symbol}` as const;
        const open = numberOrNull(item.open24h);
        const last = numberOrNull(item.last);
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'ticker' }>>({
            type: 'ticker',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: timestamp,
            provider: 'okx',
            payload: {
              exchange: 'okx',
              symbol,
              marketType: 'perp',
              bid: numberOrNull(item.bidPx),
              ask: numberOrNull(item.askPx),
              last,
              volume24h: numberOrNull(item.volCcy24h),
              change24hPercent: open && last ? ((last - open) / open) * 100 : null,
            },
          })
        );
      } else if (channel === 'books5') {
        const sequence = Number(item.seqId);
        const previous = this.#depthSequences.get(symbol) ?? null;
        const upstreamPrevious = numberOrNull(item.prevSeqId);
        if (upstreamPrevious !== null && previous !== null && upstreamPrevious !== previous) {
          this.detectGap(`okx:${symbol}:depth`, previous, sequence);
        }
        this.#depthSequences.set(symbol, sequence);
        const topic = `orderbook:okx:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
            type: 'orderbook-delta',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: timestamp,
            provider: 'okx',
            upstreamSequence: sequence,
            payload: {
              exchange: 'okx',
              symbol,
              firstSequence: upstreamPrevious,
              lastSequence: sequence,
              bids: rows(item.bids).map((row) => [
                requiredNumber(row[0], 'bid price'),
                requiredNumber(row[1], 'bid quantity'),
              ]),
              asks: rows(item.asks).map((row) => [
                requiredNumber(row[0], 'ask price'),
                requiredNumber(row[1], 'ask quantity'),
              ]),
              reset: true,
            },
          })
        );
      } else if (channel === 'funding-rate') {
        const topic = `funding:okx:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'funding' }>>({
            type: 'funding',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: timestamp,
            provider: 'okx',
            payload: {
              exchange: 'okx',
              symbol,
              fundingRate: requiredNumber(item.fundingRate, 'funding rate'),
              nextFundingAt: numberOrNull(item.nextFundingTime),
            },
          })
        );
      } else if (channel === 'liquidation-orders') {
        for (const rawDetail of Array.isArray(item.details) ? item.details : []) {
          const detail = record(rawDetail);
          const price = requiredNumber(detail.bkPx, 'bankruptcy price');
          const quantity = requiredNumber(detail.sz, 'liquidation quantity');
          const topic = `liquidations:okx:${symbol}` as const;
          this.publish(
            createEvent<Extract<RealtimeEvent, { type: 'liquidation-print' }>>({
              type: 'liquidation-print',
              topic,
              sequence: this.nextSequence(topic),
              exchangeTimestamp: Number(detail.ts ?? timestamp),
              provider: 'okx',
              payload: {
                exchange: 'okx',
                symbol,
                side: detail.side === 'sell' ? 'long' : 'short',
                price,
                quantity,
                notionalUsd: price * quantity,
              },
            })
          );
        }
      }
    }
  }

  protected async reconcileAll(): Promise<void> {
    await Promise.all(
      this.symbols.map(async (configuredSymbol) => {
        const response = await fetch(
          `https://www.okx.com/api/v5/market/books?instId=${instrument(configuredSymbol)}&sz=50`,
          { signal: AbortSignal.timeout(5_000) }
        );
        if (!response.ok) throw new Error(`OKX depth snapshot failed: ${response.status}`);
        const envelope = record(await response.json());
        const item = record((Array.isArray(envelope.data) ? envelope.data : [])[0]);
        const symbol = canonicalSymbol(configuredSymbol);
        const sequence = Number(item.seqId);
        this.#depthSequences.set(symbol, sequence);
        const topic = `orderbook:okx:${symbol}` as const;
        this.publish(
          createEvent<Extract<RealtimeEvent, { type: 'orderbook-delta' }>>({
            type: 'orderbook-delta',
            topic,
            sequence: this.nextSequence(topic),
            exchangeTimestamp: Number(item.ts ?? Date.now()),
            provider: 'okx',
            upstreamSequence: sequence,
            quality: 'snapshot',
            payload: {
              exchange: 'okx',
              symbol,
              firstSequence: sequence,
              lastSequence: sequence,
              bids: rows(item.bids).map((row) => [
                requiredNumber(row[0], 'bid price'),
                requiredNumber(row[1], 'bid quantity'),
              ]),
              asks: rows(item.asks).map((row) => [
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
