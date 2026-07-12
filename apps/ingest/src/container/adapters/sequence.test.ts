import { describe, expect, test } from 'bun:test';
import {
  binanceDepthIsContinuous,
  bybitDepthDecision,
  bybitDepthIsRegression,
  findBinanceSnapshotBridge,
} from './sequence';

describe('exchange depth sequence semantics', () => {
  test('uses Binance pu as the previous final update id', () => {
    expect(binanceDepthIsContinuous(160, { first: 170, last: 180, previousFinal: 160 })).toBe(true);
    expect(binanceDepthIsContinuous(160, { first: 170, last: 180, previousFinal: 159 })).toBe(
      false
    );
  });

  test('finds the Binance event that bridges a REST snapshot', () => {
    expect(
      findBinanceSnapshotBridge(160, [
        { first: 150, last: 159, previousFinal: 149 },
        { first: 160, last: 165, previousFinal: 159 },
        { first: 166, last: 170, previousFinal: 165 },
      ])
    ).toBe(1);
  });

  test('does not treat legitimate Bybit update-id jumps as gaps', () => {
    expect(bybitDepthIsRegression(20_300_275, 158_402_616, 'delta')).toBe(false);
    expect(bybitDepthIsRegression(158_402_616, 158_402_615, 'delta')).toBe(true);
    expect(bybitDepthIsRegression(158_402_616, 1, 'snapshot')).toBe(false);
  });

  test('freezes Bybit deltas until an authoritative snapshot resets state', () => {
    expect(
      bybitDepthDecision({
        previous: 200,
        current: 199,
        messageType: 'delta',
        awaitingSnapshot: false,
        frozen: false,
      })
    ).toBe('freeze');
    expect(
      bybitDepthDecision({
        previous: 200,
        current: 250,
        messageType: 'delta',
        awaitingSnapshot: false,
        frozen: true,
      })
    ).toBe('ignore-until-reset');
    expect(
      bybitDepthDecision({
        previous: null,
        current: 250,
        messageType: 'delta',
        awaitingSnapshot: true,
        frozen: false,
      })
    ).toBe('ignore-until-reset');
    expect(
      bybitDepthDecision({
        previous: 200,
        current: 1,
        messageType: 'delta',
        awaitingSnapshot: true,
        frozen: true,
      })
    ).toBe('reset');
  });
});
