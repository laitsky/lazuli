import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import { featureDisabledEnvelope, featureEnabled } from './features';

describe('public-first feature gates', () => {
  test('requires explicit enablement outside local development', () => {
    const production = { ENVIRONMENT: 'production' } as Env;
    const local = { ENVIRONMENT: 'local' } as Env;

    expect(featureEnabled(production, 'ACCOUNT_FEATURES_ENABLED')).toBe(false);
    expect(featureEnabled(local, 'ACCOUNT_FEATURES_ENABLED')).toBe(true);
    production.ACCOUNT_FEATURES_ENABLED = 'true';
    expect(featureEnabled(production, 'ACCOUNT_FEATURES_ENABLED')).toBe(true);
  });

  test('returns the standard 503 feature-disabled envelope payload', () => {
    const envelope = featureDisabledEnvelope('Account features are temporarily disabled');
    expect({
      success: envelope.success,
      data: envelope.data,
      error: envelope.error,
      code: envelope.code,
    }).toEqual({
      success: false,
      data: null,
      error: 'Account features are temporarily disabled',
      code: 'FEATURE_DISABLED',
    });
  });
});
