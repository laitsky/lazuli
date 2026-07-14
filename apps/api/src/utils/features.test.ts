import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import {
  featureDisabledEnvelope,
  featureEnabled,
  legacyReleaseControlFallback,
  releaseControlEnabled,
  releaseControlOff,
  resolveReleaseSubject,
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

  test('detects only an explicit global off control for the fast rollback path', async () => {
    const envFor = (state: 'off' | 'internal') =>
      ({
        DB: {
          prepare() {
            return {
              bind: () => ({
                first: async () => ({
                  flag: 'realtime',
                  state,
                  subject_allowlist_json: '[]',
                  provider_allowlist_json: '[]',
                  topic_allowlist_json: '[]',
                  revision: 1,
                  updated_by: 'operator',
                  update_reason: 'test',
                  created_at: 1,
                  updated_at: 1,
                }),
              }),
            };
          },
        },
      }) as unknown as Env;
    expect(await releaseControlOff(envFor('off'), 'realtime')).toBe(true);
    expect(await releaseControlOff(envFor('internal'), 'realtime')).toBe(false);
  });

  test('does not construct rollout identities from unverified API-key text', async () => {
    const statements: string[] = [];
    const env = {
      DB: {
        prepare(statement: string) {
          statements.push(statement);
          return {
            bind() {
              return { first: async () => null, run: async () => ({ meta: { changes: 0 } }) };
            },
          };
        },
      },
    } as unknown as Env;
    const subject = await resolveReleaseSubject(env, {
      authorization: `Bearer lz_live_${'a'.repeat(64)}`,
    });
    expect(subject).toBe(null);
    expect(statements.some((statement) => statement.includes('FROM api_keys'))).toBe(true);
  });

  test('uses the persisted API-key id only after hash verification', async () => {
    const secret = `lz_live_${'b'.repeat(64)}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    const keyHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const env = {
      DB: {
        prepare(statement: string) {
          return {
            bind() {
              return {
                async first() {
                  return statement.includes('FROM api_keys')
                    ? {
                        id: 'key_verified',
                        user_id: 'usr_1',
                        name: 'Builder',
                        key_prefix: secret.slice(0, 18),
                        key_hash: keyHash,
                        scopes_json: '["read"]',
                        created_at: 1,
                        last_used_at: null,
                        revoked_at: null,
                      }
                    : null;
                },
                async run() {
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;
    expect(await resolveReleaseSubject(env, { authorization: `Bearer ${secret}` })).toEqual({
      kind: 'api_key',
      id: 'key_verified',
    });
  });
});
