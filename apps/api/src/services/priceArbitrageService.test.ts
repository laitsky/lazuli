import { describe, expect, test } from 'bun:test';
import type { SupportedExchange, Ticker } from '@lazuli/shared';
import {
  buildPriceArbitrageResponse,
  MAX_CREDIBLE_SPREAD_BPS,
  normalizeArbitrageAsset,
} from './priceArbitrageService';

function ticker(
  exchange: SupportedExchange,
  symbol: string,
  type: 'spot' | 'perp',
  values: Partial<Ticker>
): Ticker {
  return {
    exchange,
    symbol,
    type,
    bid: null,
    ask: null,
    last: null,
    high24h: null,
    low24h: null,
    volume24h: null,
    quoteVolume24h: null,
    change24h: null,
    percentage24h: null,
    timestamp: 1_700_000_000_000,
    ...values,
  };
}

describe('price arbitrage service', () => {
  test('normalizes spot and perpetual symbols by quote currency', () => {
    expect(normalizeArbitrageAsset('BTC-USDT', 'spot', 'USDT')).toBe('BTC');
    expect(normalizeArbitrageAsset('BTCUSDT.P', 'perp', 'USDT')).toBe('BTC');
    expect(normalizeArbitrageAsset('ETHUSDC.P', 'perp', 'USDT')).toBe(null);
    expect(normalizeArbitrageAsset('SOL-BTC', 'spot', 'USDT')).toBe(null);
  });

  test('calculates executable spread from ask to bid and sorts descending', () => {
    const response = buildPriceArbitrageResponse(
      [
        {
          exchange: 'bybit',
          tickers: [
            ticker('bybit', 'BTC-USDT', 'spot', { bid: 100, ask: 101, last: 100.5 }),
            ticker('bybit', 'ETH-USDT', 'spot', { bid: 20, ask: 20.2, last: 20.1 }),
          ],
        },
        {
          exchange: 'okx',
          tickers: [
            ticker('okx', 'BTC-USDT', 'spot', { bid: 104, ask: 105, last: 104.5 }),
            ticker('okx', 'ETH-USDT', 'spot', { bid: 20.35, ask: 20.5, last: 20.4 }),
          ],
        },
        {
          exchange: 'upbit',
          tickers: [ticker('upbit', 'BTC-USDT', 'spot', { bid: 106, ask: 107, last: 106.5 })],
        },
      ],
      { type: 'spot', quote: 'USDT', minSpreadBps: 10, limit: 10 }
    );

    expect(response.count).toBe(2);
    expect(response.opportunities[0]?.asset).toBe('BTC');
    expect(response.opportunities[0]?.bestBuyExchange).toBe('bybit');
    expect(response.opportunities[0]?.bestSellExchange).toBe('upbit');
    expect(Math.round((response.opportunities[0]?.spreadBps ?? 0) * 10_000) / 10_000).toBe(
      495.0495
    );
    expect(response.opportunities[1]?.asset).toBe('ETH');
  });

  test('filters by market type, quote, minimum spread, and limit', () => {
    const response = buildPriceArbitrageResponse(
      [
        {
          exchange: 'bybit',
          tickers: [
            ticker('bybit', 'BTCUSDT.P', 'perp', { bid: 100, ask: 101, last: 100.5 }),
            ticker('bybit', 'BTC-USDT', 'spot', { bid: 1, ask: 1, last: 1 }),
            ticker('bybit', 'SOLUSDC.P', 'perp', { bid: 50, ask: 51, last: 50.5 }),
          ],
        },
        {
          exchange: 'okx',
          tickers: [
            ticker('okx', 'BTCUSDT.P', 'perp', { bid: 101.1, ask: 102, last: 101.5 }),
            ticker('okx', 'SOLUSDC.P', 'perp', { bid: 70, ask: 71, last: 70.5 }),
          ],
        },
      ],
      { type: 'perp', quote: 'USDT', minSpreadBps: 6, limit: 1 }
    );

    expect(response.count).toBe(1);
    expect(response.opportunities[0]?.asset).toBe('BTC');
    expect(response.opportunities[0]?.quoteCurrency).toBe('USDT');
    expect(response.opportunities[0]?.marketType).toBe('perp');
  });

  test('returns empty when symbols cannot be compared across exchanges', () => {
    const response = buildPriceArbitrageResponse(
      [
        {
          exchange: 'bybit',
          tickers: [ticker('bybit', 'BTC-USDT', 'spot', { bid: 100, ask: 101, last: 100.5 })],
        },
        {
          exchange: 'hyperliquid',
          tickers: [ticker('hyperliquid', 'ETHUSDT.P', 'perp', { bid: 20, ask: 21, last: 20.5 })],
        },
      ],
      { type: 'spot', quote: 'USDT', minSpreadBps: 1, limit: 20 }
    );

    expect(response.count).toBe(0);
    expect(response.opportunities).toEqual([]);
  });

  test('rejects implausible same-ticker identity collisions across venues', () => {
    const response = buildPriceArbitrageResponse(
      [
        {
          exchange: 'bybit',
          tickers: [ticker('bybit', 'U-USDT', 'spot', { bid: 0.004, ask: 0.005, last: 0.0045 })],
        },
        {
          exchange: 'binance',
          tickers: [ticker('binance', 'U-USDT', 'spot', { bid: 12, ask: 13, last: 12.5 })],
        },
      ],
      { type: 'spot', quote: 'USDT', minSpreadBps: 1, limit: 20 }
    );

    expect(response.opportunities).toEqual([]);
  });

  test('applies the conservative identity boundary before ranking', () => {
    const response = buildPriceArbitrageResponse(
      [
        {
          exchange: 'bybit',
          tickers: [ticker('bybit', 'NEW-USDT', 'spot', { bid: 1, ask: 1, last: 1 })],
        },
        {
          exchange: 'okx',
          tickers: [
            ticker('okx', 'NEW-USDT', 'spot', {
              bid: 1 + (MAX_CREDIBLE_SPREAD_BPS + 1) / 10_000,
              ask: 1.2,
              last: 1.1,
            }),
          ],
        },
      ],
      { type: 'spot', quote: 'USDT', minSpreadBps: 1, limit: 20 }
    );

    expect(response.opportunities).toEqual([]);
  });
});
