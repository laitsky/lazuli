import type { StrategyDefinition } from '@lazuli/shared';

export type ScannerStrategyMode = 'momentum' | 'contrarian' | 'breakout';

/** Convert scanner language into the stable server strategy contract. */
export function createDefaultStrategy(
  asset: string,
  scannerMode: ScannerStrategyMode
): StrategyDefinition {
  const mode: StrategyDefinition['mode'] =
    scannerMode === 'contrarian' ? 'mean-reversion' : scannerMode;
  return {
    name: `${asset} ${scannerMode}`,
    mode,
    fastPeriod: 12,
    slowPeriod: 26,
    rsiPeriod: 14,
    rsiOversold: mode === 'mean-reversion' ? 35 : 30,
    rsiOverbought: mode === 'momentum' ? 65 : 70,
    feeBps: 10,
  };
}

/** Parse inclusive UTC date inputs into the millisecond archive range. */
export function parseUtcDateRange(
  startDate: string,
  endDate: string
): { startTime: number; endTime: number } {
  const startTime = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTime = Date.parse(`${endDate}T23:59:59.999Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new Error('End date must be later than start date.');
  }
  return { startTime, endTime };
}

/** A retry of the same immutable version and range resolves to the same server job. */
export function buildBacktestIdempotencyKey(
  strategyId: string,
  startTime: number,
  endTime: number
): string {
  return `signal-lab:${strategyId}:${startTime}:${endTime}`;
}

export function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}
