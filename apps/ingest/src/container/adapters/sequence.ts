export interface BinanceDepthSequence {
  first: number;
  last: number;
  previousFinal: number | null;
}

export function validSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function binanceDepthIsContinuous(
  previous: number | null,
  event: BinanceDepthSequence
): boolean {
  if (previous === null) return true;
  if (event.previousFinal !== null) return event.previousFinal === previous;
  return event.first <= previous + 1 && event.last >= previous + 1;
}

export function findBinanceSnapshotBridge(
  snapshotSequence: number,
  events: BinanceDepthSequence[]
): number {
  return events.findIndex(
    (event) => event.first <= snapshotSequence && event.last >= snapshotSequence
  );
}

export type BinanceDepthDecision = 'continuous' | 'stale' | 'gap';

export function binanceDepthDecision(
  previous: number | null,
  event: BinanceDepthSequence
): BinanceDepthDecision {
  if (previous !== null && event.last <= previous) return 'stale';
  return binanceDepthIsContinuous(previous, event) ? 'continuous' : 'gap';
}

export function bybitDepthIsRegression(
  previous: number | null,
  current: number,
  messageType: string
): boolean {
  if (messageType === 'snapshot' || current === 1 || previous === null) return false;
  return current <= previous;
}

export type BybitDepthDecision = 'reset' | 'delta' | 'freeze' | 'ignore-until-reset';

export function bybitDepthDecision(input: {
  previous: number | null;
  current: number;
  messageType: string;
  awaitingSnapshot: boolean;
  frozen: boolean;
}): BybitDepthDecision {
  if (input.messageType === 'snapshot' || input.current === 1) return 'reset';
  if (input.awaitingSnapshot || input.frozen) return 'ignore-until-reset';
  return bybitDepthIsRegression(input.previous, input.current, input.messageType)
    ? 'freeze'
    : 'delta';
}
