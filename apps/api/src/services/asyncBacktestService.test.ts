import { describe, expect, test } from 'bun:test';
import type { OHLCV } from '@lazuli/shared';
import { runBacktest } from './marketIntelligenceService';
import { runBacktestChunksForTest } from './asyncBacktestService';

const strategy = {
  name: 'chunk-stable momentum',
  mode: 'momentum' as const,
  fastPeriod: 3,
  slowPeriod: 7,
  rsiPeriod: 5,
  rsiOversold: 30,
  rsiOverbought: 70,
  feeBps: 6,
};

function candles(count: number): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 2) * 9 + index * 0.08;
    return {
      timestamp: 1_700_000_000_000 + index * 60_000,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + index,
    };
  });
}

describe('async backtest streaming engine', () => {
  test('produces the synchronous trades and equity curve across arbitrary chunk boundaries', () => {
    const history = candles(80);
    const synchronous = runBacktest({
      exchange: 'bybit',
      symbol: 'BTCUSDT.P',
      type: 'perp',
      timeframe: '1m',
      candles: history,
      strategy,
    });
    const streamed = runBacktestChunksForTest({ strategy }, [
      history.slice(0, 4),
      history.slice(4, 19),
      history.slice(19, 51),
      history.slice(51),
    ]);

    expect(streamed.output.trades).toEqual(synchronous.trades);
    expect(streamed.output.equityCurve).toEqual(synchronous.equityCurve);
    expect(streamed.checkpoint.candleCount).toBe(history.length);
    expect(streamed.checkpoint.tradeCount).toBe(synchronous.metrics.tradeCount);
  });

  test('keeps checkpoint state bounded independently of history length', () => {
    const streamed = runBacktestChunksForTest({ strategy }, [candles(2_000)]);
    expect(streamed.checkpoint.fast.seed.length).toBe(0);
    expect(streamed.checkpoint.slow.seed.length).toBe(0);
    expect(streamed.checkpoint.equityPointCount).toBe(streamed.output.equityCurve.length);
    expect(JSON.stringify(streamed.checkpoint).length < 2_000).toBe(true);
  });
});
