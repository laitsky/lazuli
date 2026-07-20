import { describe, expect, test } from 'bun:test';
import type { Opportunity, SignalRecipe } from '@lazuli/shared';
import { buildConvictionOpportunities } from './convictionEngineService';
import {
  createSignalRecipe,
  matchesSignalRecipe,
  validateSignalRecipeInput,
} from './signalRecipeService';
import type { Env } from '../types';

function captureError(action: () => unknown): string {
  try {
    action();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function opportunity(): Opportunity {
  return buildConvictionOpportunities({
    exchange: 'bybit',
    marketType: 'perp',
    now: 1_800_000_000_000,
    horizon: '6h',
    tickers: [
      {
        exchange: 'bybit',
        symbol: 'BTCUSDT.P',
        type: 'perp',
        bid: 99,
        ask: 101,
        last: 100,
        high24h: 105,
        low24h: 90,
        volume24h: 1_000_000,
        quoteVolume24h: 1_000_000_000,
        change24h: 6,
        percentage24h: 6,
        timestamp: 1_800_000_000_000,
      },
    ],
  }).items[0]!;
}

function recipe(overrides: Partial<SignalRecipe> = {}): SignalRecipe {
  return {
    id: 'recipe_1',
    rootId: 'recipe_1',
    userId: 'user_1',
    name: 'BTC momentum',
    version: 1,
    universe: { kind: 'watchlist', exchange: 'bybit', symbols: ['BTCUSDT.P'], marketType: 'perp' },
    horizon: '6h',
    conditions: [
      { id: 'return', metric: 'price_return', operator: 'gte', value: 5, window: '6h' },
      { id: 'volume', metric: 'volume_percentile', operator: 'gte', value: 50, window: '6h' },
    ],
    minScore: 40,
    cooldownSeconds: 3600,
    deliveryChannelIds: [],
    active: true,
    preview: {
      status: 'insufficient-data',
      sampleSize: 0,
      coveragePercent: 0,
      estimatedMatchesPerWeek: null,
      estimatedCostBps: null,
      calibration: opportunity().calibration,
      warnings: [],
    },
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe('signal recipe service', () => {
  test('matches every condition with AND semantics', () => {
    expect(matchesSignalRecipe(recipe(), opportunity()).matched).toBe(true);
    expect(
      matchesSignalRecipe(
        recipe({
          conditions: [
            ...recipe().conditions,
            { id: 'impossible', metric: 'funding_rate', operator: 'gt', value: 0, window: '6h' },
          ],
        }),
        opportunity()
      ).matched
    ).toBe(false);
  });

  test('enforces universe, horizon, activation, and minimum score', () => {
    expect(matchesSignalRecipe(recipe({ active: false }), opportunity()).matched).toBe(false);
    expect(matchesSignalRecipe(recipe({ horizon: '1h' }), opportunity()).matched).toBe(false);
    expect(matchesSignalRecipe(recipe({ minScore: 99 }), opportunity()).matched).toBe(false);
    expect(
      matchesSignalRecipe(
        recipe({
          universe: { kind: 'watchlist', exchange: 'okx', symbols: [], marketType: 'perp' },
        }),
        opportunity()
      ).matched
    ).toBe(false);
  });

  test('requires top-liquid opportunities to be in the top volume percentile', () => {
    const topLiquid = recipe({
      universe: { kind: 'top-liquid', exchange: 'all', symbols: [], marketType: 'perp' },
    });
    const baseOpportunity = opportunity();
    const liquidOpportunity = {
      ...baseOpportunity,
      evidence: baseOpportunity.evidence.map((item) =>
        item.metric === 'volume_percentile' ? { ...item, normalizedValue: 90 } : item
      ),
    };
    const illiquidOpportunity = {
      ...liquidOpportunity,
      evidence: liquidOpportunity.evidence.map((item) =>
        item.metric === 'volume_percentile' ? { ...item, normalizedValue: 79 } : item
      ),
    };

    expect(matchesSignalRecipe(topLiquid, liquidOpportunity).matched).toBe(true);
    expect(matchesSignalRecipe(topLiquid, illiquidOpportunity).matched).toBe(false);
  });

  test('rejects more than five rules and mismatched condition windows', () => {
    const base = {
      name: 'Validated recipe',
      universe: {
        kind: 'exchange' as const,
        exchange: 'bybit' as const,
        symbols: [],
        marketType: 'perp' as const,
      },
      horizon: '6h' as const,
      conditions: [
        {
          id: 'one',
          metric: 'price_return' as const,
          operator: 'gte' as const,
          value: 3,
          window: '6h' as const,
        },
      ],
    };
    expect(
      captureError(() =>
        validateSignalRecipeInput({
          ...base,
          conditions: Array.from({ length: 6 }, (_, index) => ({
            ...base.conditions[0]!,
            id: String(index),
          })),
        })
      )
    ).toBe('conditions must contain between 1 and 5 AND rules');
    expect(
      captureError(() =>
        validateSignalRecipeInput({
          ...base,
          conditions: [{ ...base.conditions[0]!, window: '1h' }],
        })
      )
    ).toBe('conditions[0].window must match the recipe horizon');
    expect(
      captureError(() =>
        validateSignalRecipeInput({
          ...base,
          conditions: [
            {
              id: 'regime',
              metric: 'institutional_regime',
              operator: 'gte',
              value: 'risk-on',
              window: '6h',
            },
          ],
        })
      )
    ).toBe('conditions[0].operator must be eq for text values');
  });

  test('blocks activation when the required historical preview is unavailable', async () => {
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return this;
            },
            async all() {
              throw new Error('D1 unavailable');
            },
          };
        },
      },
    } as unknown as Env;
    await expect(
      createSignalRecipe(env, 'user_1', {
        name: 'Active recipe',
        universe: {
          kind: 'exchange',
          exchange: 'bybit',
          symbols: [],
          marketType: 'perp',
        },
        horizon: '6h',
        conditions: [
          { id: 'return', metric: 'price_return', operator: 'gte', value: 3, window: '6h' },
        ],
        active: true,
      })
    ).rejects.toThrow('activation requires an available historical preview');
  });
});
