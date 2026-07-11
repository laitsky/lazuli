import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import {
  alertDeliveryIdempotencyKey,
  alertDeliveryRetryDelaySeconds,
  decryptNotificationValue,
  encryptNotificationValue,
  isSafePublicHttpsUrl,
  reencryptNotificationChannels,
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
});
