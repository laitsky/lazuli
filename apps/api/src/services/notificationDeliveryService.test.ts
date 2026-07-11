import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import {
  alertDeliveryIdempotencyKey,
  alertDeliveryRetryDelaySeconds,
  canAutomaticallyRetryDelivery,
  decryptNotificationValue,
  encryptNotificationValue,
  isSafePublicHttpsUrl,
  processAlertDeliveryMessage,
  reencryptNotificationChannels,
  replayIndeterminateNotificationDelivery,
} from './notificationDeliveryService';

const encryptionEnv = {
  NOTIFICATION_ENCRYPTION_KEY: 'test-only-notification-encryption-key-that-is-long-enough',
} as Pick<Env, 'NOTIFICATION_ENCRYPTION_KEY'>;

describe('notification delivery service', () => {
  test('AES-GCM ciphertext never contains plaintext and is bound to channel ownership', async () => {
    const plaintext = 'https://hooks.example.test/account-secret-token';
    const aad = 'lazuli:notification:v1:usr_1:nch_1:endpoint';
    const ciphertext = await encryptNotificationValue(encryptionEnv, plaintext, aad);

    expect(ciphertext.includes(plaintext)).toBe(false);
    expect(await decryptNotificationValue(encryptionEnv, ciphertext, aad)).toBe(plaintext);
    const legacy = JSON.parse(ciphertext) as Record<string, unknown>;
    legacy.v = 1;
    delete legacy.kid;
    expect(await decryptNotificationValue(encryptionEnv, JSON.stringify(legacy), aad)).toBe(
      plaintext
    );
    await expect(
      decryptNotificationValue(
        encryptionEnv,
        ciphertext,
        'lazuli:notification:v1:usr_other:nch_1:endpoint'
      )
    ).rejects.toThrow();
  });

  test('dual-reads current and staged-next encryption keys by key id', async () => {
    const rotatingEnv = {
      NOTIFICATION_ENCRYPTION_KEY: 'current-test-notification-key-that-is-long-enough',
      NOTIFICATION_ENCRYPTION_KEY_ID: 'notification-2026-01',
      NOTIFICATION_ENCRYPTION_KEY_NEXT: 'next-test-notification-key-that-is-long-enough-xx',
      NOTIFICATION_ENCRYPTION_KEY_NEXT_ID: 'notification-2026-02',
    };
    const ciphertext = await encryptNotificationValue(
      rotatingEnv,
      'secret endpoint',
      'aad',
      'next'
    );
    const metadata = JSON.parse(ciphertext) as { v?: unknown; kid?: unknown };
    expect(metadata.v).toBe(2);
    expect(metadata.kid).toBe('notification-2026-02');
    expect(await decryptNotificationValue(rotatingEnv, ciphertext, 'aad')).toBe('secret endpoint');
    expect(
      await decryptNotificationValue(
        {
          NOTIFICATION_ENCRYPTION_KEY: rotatingEnv.NOTIFICATION_ENCRYPTION_KEY_NEXT,
          NOTIFICATION_ENCRYPTION_KEY_ID: rotatingEnv.NOTIFICATION_ENCRYPTION_KEY_NEXT_ID,
        },
        ciphertext,
        'aad'
      )
    ).toBe('secret endpoint');
  });

  test('re-encrypts only a bounded cursor batch with the staged key', async () => {
    const userId = 'usr_1';
    const channelId = 'nch_1';
    const current = 'current-test-notification-key-that-is-long-enough';
    const next = 'next-test-notification-key-that-is-long-enough-xx';
    const endpoint = await encryptNotificationValue(
      { NOTIFICATION_ENCRYPTION_KEY: current, NOTIFICATION_ENCRYPTION_KEY_ID: 'key-1' },
      'user@example.com',
      `lazuli:notification:v1:${userId}:${channelId}:endpoint`
    );
    let updateBindings: unknown[] = [];
    const env = {
      NOTIFICATION_ENCRYPTION_KEY: current,
      NOTIFICATION_ENCRYPTION_KEY_ID: 'key-1',
      NOTIFICATION_ENCRYPTION_KEY_NEXT: next,
      NOTIFICATION_ENCRYPTION_KEY_NEXT_ID: 'key-2',
      DB: {
        prepare(sql: string) {
          return {
            bind(...values: unknown[]) {
              if (sql.startsWith('SELECT')) {
                return {
                  async all() {
                    return {
                      results: [
                        {
                          id: channelId,
                          user_id: userId,
                          endpoint_ciphertext: endpoint,
                          secret_ciphertext: null,
                        },
                      ],
                    };
                  },
                };
              }
              updateBindings = values;
              return {
                async run() {
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
        async batch() {
          return [];
        },
      },
    } as unknown as Env;

    const result = await reencryptNotificationChannels(env, { limit: 10, cursor: null });
    expect(result).toEqual({
      processed: 1,
      updated: 1,
      nextCursor: channelId,
      done: true,
      targetKeyId: 'key-2',
    });
    const metadata = JSON.parse(String(updateBindings[0])) as { v?: unknown; kid?: unknown };
    expect(metadata.v).toBe(2);
    expect(metadata.kid).toBe('key-2');
  });

  test('rejects private, local, credentialed, non-TLS, and unusual-port webhook targets', () => {
    const rejected = [
      'http://hooks.example.com/alert',
      'https://localhost/alert',
      'https://127.0.0.1/alert',
      'https://10.0.0.2/alert',
      'https://169.254.169.254/latest/meta-data',
      'https://172.20.1.1/alert',
      'https://192.168.1.1/alert',
      'https://[::1]/alert',
      'https://user:password@hooks.example.com/alert',
      'https://hooks.example.com:8443/alert',
      'https://metadata.google.internal/computeMetadata/v1',
    ];
    for (const url of rejected) expect(isSafePublicHttpsUrl(url)).toBe(false);
    expect(isSafePublicHttpsUrl('https://hooks.example.com/lazuli/alert')).toBe(true);
  });

  test('uses stable event/channel idempotency keys', () => {
    expect(alertDeliveryIdempotencyKey('ae_123', 'nch_456')).toBe(
      'alert:ae_123:channel:nch_456:v1'
    );
    expect(alertDeliveryIdempotencyKey('ae_123', 'nch_456')).toBe(
      alertDeliveryIdempotencyKey('ae_123', 'nch_456')
    );
  });

  test('backs retries off exponentially and caps them at fifteen minutes', () => {
    const delays = [1, 2, 3, 4, 5, 6, 20].map(alertDeliveryRetryDelaySeconds);
    expect(Number(delays[1]) > Number(delays[0])).toBe(true);
    expect(Number(delays[2]) > Number(delays[1])).toBe(true);
    expect(Number(delays[3]) > Number(delays[2])).toBe(true);
    expect(delays[6]).toBe(900);
  });

  test('retries only receiver-idempotent webhooks after provider responses', () => {
    expect(canAutomaticallyRetryDelivery('webhook', 500)).toBe(true);
    expect(canAutomaticallyRetryDelivery('webhook', 429)).toBe(true);
    expect(canAutomaticallyRetryDelivery('webhook', 400)).toBe(false);
    expect(canAutomaticallyRetryDelivery('email', 500)).toBe(false);
    expect(canAutomaticallyRetryDelivery('discord', 500)).toBe(false);
    expect(canAutomaticallyRetryDelivery('telegram', 500)).toBe(false);
  });

  test('does not resend an indeterminate non-idempotent provider attempt', async () => {
    const userId = 'usr_1';
    const channelId = 'nch_1';
    const key = 'test-only-notification-encryption-key-that-is-long-enough';
    const endpoint = await encryptNotificationValue(
      { NOTIFICATION_ENCRYPTION_KEY: key },
      'user@example.com',
      `lazuli:notification:v1:${userId}:${channelId}:endpoint`
    );
    let status = 'queued';
    let sends = 0;
    const env = {
      NOTIFICATION_ENCRYPTION_KEY: key,
      ALERT_EMAIL: {
        async send() {
          sends += 1;
          throw new Error('connection closed after provider acceptance');
        },
      },
      DB: {
        prepare(sql: string) {
          return {
            sql,
            bind() {
              return {
                sql,
                async first() {
                  if (!sql.includes('SELECT a.*')) return null;
                  return {
                    id: 'nda_1',
                    alert_event_id: 'ae_1',
                    channel_id: channelId,
                    idempotency_key: 'alert:ae_1:channel:nch_1:v1',
                    status,
                    attempt_number: 0,
                    provider: null,
                    response_status: null,
                    last_error: null,
                    queued_at: 1,
                    attempted_at: null,
                    delivered_at: null,
                    next_attempt_at: null,
                    channel_kind: 'email',
                    channel_label: 'Account email',
                    endpoint_ciphertext: endpoint,
                    secret_ciphertext: null,
                    config_json: '{}',
                    payload_json: '{}',
                    symbol: 'BTC-USDT',
                    exchange: 'bybit',
                    trigger_price: 100,
                    target_price: 100,
                    condition: 'above',
                    user_id: userId,
                  };
                },
                async run() {
                  return { meta: { changes: status === 'queued' ? 1 : 0 } };
                },
              };
            },
          };
        },
        async batch(statements: Array<{ sql?: string }>) {
          if (statements.some((statement) => statement.sql?.includes("status = 'dead_letter'"))) {
            status = 'dead_letter';
          }
          return statements.map(() => ({ meta: { changes: 1 } }));
        },
      },
    } as unknown as Env;

    await processAlertDeliveryMessage(env, { kind: 'alert-delivery', attemptId: 'nda_1' });
    await processAlertDeliveryMessage(env, { kind: 'alert-delivery', attemptId: 'nda_1' });
    expect(status).toBe('dead_letter');
    expect(sends).toBe(1);
  });

  test('safely retries a definite provider-configuration failure before dispatch', async () => {
    const userId = 'usr_1';
    const channelId = 'nch_1';
    const key = 'test-only-notification-encryption-key-that-is-long-enough';
    const endpoint = await encryptNotificationValue(
      { NOTIFICATION_ENCRYPTION_KEY: key },
      'user@example.com',
      `lazuli:notification:v1:${userId}:${channelId}:endpoint`
    );
    let recordedState: string | null = null;
    const env = {
      NOTIFICATION_ENCRYPTION_KEY: key,
      DB: {
        prepare(sql: string) {
          return {
            sql,
            bind(...values: unknown[]) {
              return {
                sql,
                values,
                async first() {
                  if (!sql.includes('SELECT a.*')) return null;
                  return {
                    id: 'nda_2',
                    alert_event_id: 'ae_2',
                    channel_id: channelId,
                    idempotency_key: 'alert:ae_2:channel:nch_1:v1',
                    status: 'queued',
                    attempt_number: 0,
                    provider: null,
                    response_status: null,
                    last_error: null,
                    queued_at: 1,
                    attempted_at: null,
                    delivered_at: null,
                    next_attempt_at: null,
                    channel_kind: 'email',
                    channel_label: 'Account email',
                    endpoint_ciphertext: endpoint,
                    secret_ciphertext: null,
                    config_json: '{}',
                    payload_json: '{}',
                    symbol: 'BTC-USDT',
                    exchange: 'bybit',
                    trigger_price: 100,
                    target_price: 100,
                    condition: 'above',
                    user_id: userId,
                  };
                },
                async run() {
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
        async batch(statements: Array<{ values?: unknown[] }>) {
          recordedState = String(statements[0]?.values?.[0]);
          return statements.map(() => ({ meta: { changes: 1 } }));
        },
      },
    } as unknown as Env;
    await expect(
      processAlertDeliveryMessage(env, { kind: 'alert-delivery', attemptId: 'nda_2' })
    ).rejects.toThrow('Email delivery provider is unavailable');
    expect(recordedState).toBe('retry');
  });

  test('requires explicit risk confirmation and audits operator replay', async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    let queued = 0;
    const env = {
      ALERT_DELIVERY_QUEUE: {
        async send() {
          queued += 1;
        },
      },
      DB: {
        prepare(sql: string) {
          return {
            bind(...values: unknown[]) {
              const statement = { sql, values };
              statements.push(statement);
              return {
                ...statement,
                async first() {
                  return sql.startsWith('SELECT id') ? { id: 'nda_1' } : null;
                },
              };
            },
          };
        },
        async batch(batchStatements: unknown[]) {
          return batchStatements.map(() => ({ meta: { changes: 1 } }));
        },
      },
    } as unknown as Env;
    await expect(
      replayIndeterminateNotificationDelivery(env, {
        attemptId: 'nda_1',
        actor: 'release-operator',
        reason: 'provider confirmed no acceptance',
        changeId: 'CHG-123',
        confirmDuplicateRisk: false,
      })
    ).rejects.toThrow('confirmation');
    expect(
      await replayIndeterminateNotificationDelivery(env, {
        attemptId: 'nda_1',
        actor: 'release-operator',
        reason: 'provider confirmed no acceptance',
        changeId: 'CHG-123',
        confirmDuplicateRisk: true,
      })
    ).toEqual({ replayed: true });
    expect(queued).toBe(1);
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO audit_events'))).toBe(true);
  });
});
