import { describe, expect, test } from 'bun:test';
import {
  lastClosedUtcMonthEnd,
  partitionCampaignMonths,
  planBackfillCampaign,
} from './backfillCampaignService';
import { MAX_BACKFILL_TASKS } from './backfillService';

describe('backfill campaign planning', () => {
  test('preserves an explicitly requested symbol universe', async () => {
    const plan = await planBackfillCampaign({
      exchanges: ['hyperliquid'],
      symbols: ['BTCUSDT.P'],
      types: ['perp'],
      timeframes: ['1d'],
      startTime: Date.UTC(2026, 5, 1),
      cutoffTime: Date.UTC(2026, 5, 30, 23, 59, 59, 999),
      maxSymbolsPerExchange: 1,
    });

    expect(plan.frozenUniverse['hyperliquid:perp']).toEqual(['BTCUSDT.P']);
    expect(plan.components[0]?.request.symbols).toEqual(['BTCUSDT.P']);
  });

  test('freezes the cutoff at the final millisecond of the previous UTC month', () => {
    expect(lastClosedUtcMonthEnd(Date.parse('2026-07-17T12:00:00Z'))).toBe(
      Date.parse('2026-06-30T23:59:59.999Z')
    );
  });

  test('partitions large histories without exceeding the task cap', () => {
    const windows = partitionCampaignMonths(
      Date.parse('2010-01-01T00:00:00Z'),
      Date.parse('2026-06-30T23:59:59.999Z'),
      50
    );
    expect(windows.length > 1).toBe(true);
    expect(windows.every((window) => window.monthCount * 50 <= MAX_BACKFILL_TASKS)).toBe(true);
  });
});
