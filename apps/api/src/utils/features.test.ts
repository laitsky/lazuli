import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import {
  featureDisabledEnvelope,
  featureEnabled,
  legacyReleaseControlFallback,
  releaseControlEnabled,
} from './features';

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

  test('uses legacy booleans only when no D1 control exists', async () => {
    const missingControl = {
      ENVIRONMENT: 'production',
      ACCOUNT_FEATURES_ENABLED: 'true',
      DB: {
        prepare() {
          return { bind: () => ({ first: async () => null }) };
        },
      },
    } as unknown as Env;
    expect(await releaseControlEnabled(missingControl, 'accounts')).toBe(true);

    const disabledControl = {
      ...missingControl,
      DB: {
        prepare() {
          return {
            bind: () => ({
              first: async () => ({
                flag: 'accounts',
                state: 'off',
                subject_allowlist_json: '[]',
                provider_allowlist_json: '[]',
                topic_allowlist_json: '[]',
                revision: 1,
                updated_by: 'operator',
                update_reason: 'hold',
                created_at: 1,
                updated_at: 1,
              }),
            }),
          };
        },
      },
    } as unknown as Env;
    expect(await releaseControlEnabled(disabledControl, 'accounts')).toBe(false);
  });

  test('maps legacy controls without broadening prior behavior', () => {
    const production = {
      ENVIRONMENT: 'production',
      ACCOUNT_FEATURES_ENABLED: 'true',
      ALERT_EVALUATION_ENABLED: 'false',
      ADMIN_ROUTES_ENABLED: 'false',
    } as Env;
    expect(legacyReleaseControlFallback(production, 'realtime')).toBe(false);
    expect(legacyReleaseControlFallback({ ENVIRONMENT: 'local' } as Env, 'realtime')).toBe(true);
    expect(legacyReleaseControlFallback(production, 'async_backtests')).toBe(true);
    expect(legacyReleaseControlFallback(production, 'cron_reconciliation')).toBe(false);
    expect(legacyReleaseControlFallback(production, 'admin_operations')).toBe(false);
  });
});
