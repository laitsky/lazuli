import { describe, expect, test } from 'bun:test';
import {
  createPasskeyRegistrationOptions,
  deliverAlertNotification,
  evaluateAlertTrigger,
  listDuePriceAlerts,
  verifyApiKey,
} from './growthRetentionService';
import type { Env } from '../types';
import type { PriceAlertRecord } from '@lazuli/shared';

describe('growth retention service', () => {
  test('claims a one-shot alert atomically before creating a delivery event', async () => {
    const statements: string[] = [];
    let claimAvailable = true;
    let successfulClaims = 0;
    const env = {
      DB: {
        prepare(statement: string) {
          statements.push(statement);
          return {
            bind() {
              return {
                async run() {
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
        async batch() {
          const claimed = claimAvailable;
          claimAvailable = false;
          if (claimed) successfulClaims += 1;
          return [{ meta: { changes: claimed ? 1 : 0 } }, { meta: { changes: claimed ? 1 : 0 } }];
        },
      },
    } as unknown as Env;
    const alert = alertRecord({ active: true, triggeredAt: null });

    const first = await evaluateAlertTrigger(env, { alert, currentPrice: 101 });
    const second = await evaluateAlertTrigger(env, { alert, currentPrice: 102 });

    expect(first.triggered).toBe(true);
    expect(second).toEqual({ triggered: false, eventId: null });
    expect(successfulClaims).toBe(1);
    expect(
      statements.some((statement) => statement.includes('INSERT OR IGNORE INTO alert_events'))
    ).toBe(true);
  });

  test('creates WebAuthn registration options and stores a short-lived challenge', async () => {
    const statements: string[] = [];
    const boundValues: unknown[][] = [];
    const env = {
      APP_BASE_URL: 'https://app.lazuli.test',
      DB: {
        prepare(statement: string) {
          statements.push(statement);
          const statementIndex = statements.length;
          return {
            bind(...values: unknown[]) {
              boundValues.push(values);
              return {
                async all() {
                  if (statementIndex !== 1) return { results: [] };
                  return {
                    results: [
                      {
                        id: 'pk_1',
                        user_id: 'usr_1',
                        credential_id: 'credential-id',
                        public_key: 'public-key',
                        counter: 0,
                        transports_json: '["internal"]',
                        device_type: 'multiDevice',
                        backed_up: 1,
                        name: 'Laptop',
                        created_at: 1_700_000_000,
                        last_used_at: null,
                      },
                    ],
                  };
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

    const response = await createPasskeyRegistrationOptions(env, {
      id: 'usr_1',
      email: 'user@example.com',
      displayName: null,
      createdAt: 1_700_000_000_000,
      lastLoginAt: null,
    });

    expect(response.challengeId.startsWith('wch_')).toBe(true);
    expect(typeof response.options.challenge).toBe('string');
    expect(response.options.rp).toEqual({ name: 'Lazuli', id: 'app.lazuli.test' });
    expect(statements[0]?.includes('SELECT * FROM passkeys WHERE user_id = ?')).toBe(true);
    expect(statements[1]?.includes('INSERT INTO webauthn_challenges')).toBe(true);
    expect(boundValues[0]).toEqual(['usr_1']);
    expect(boundValues[1]?.[1]).toBe('usr_1');
    expect(boundValues[1]?.[3]).toBe('registration');
  });

  test('loads active due alerts in a bounded batch ordered by evaluation age', async () => {
    let query = '';
    let boundLimit: unknown;
    const env = {
      DB: {
        prepare(statement: string) {
          query = statement;
          return {
            bind(limit: number) {
              boundLimit = limit;
              return {
                async all() {
                  return {
                    results: [
                      {
                        id: 42,
                        user_id: 'usr_1',
                        symbol: 'BTC-USDT',
                        exchange: 'bybit',
                        market_type: 'spot',
                        price_target: 100_000,
                        condition: 'above',
                        active: 1,
                        triggered_at: null,
                        topic: 'alerts:price:usr_1',
                        delivery_json: '{"type":"webhook"}',
                        metadata_json: '{"note":"breakout"}',
                        last_price: 99_000,
                        last_evaluated_at: 1_700_000_000,
                        created_at: 1_699_000_000,
                        updated_at: 1_700_000_001,
                      },
                    ],
                  };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    const alerts = await listDuePriceAlerts(env, 5000);

    expect(query.includes('WHERE active = 1 AND user_id IS NOT NULL')).toBe(true);
    expect(query.includes('ORDER BY COALESCE(last_evaluated_at, 0) ASC, updated_at ASC')).toBe(
      true
    );
    expect(boundLimit).toBe(1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe(42);
    expect(alerts[0]?.userId).toBe('usr_1');
    expect(alerts[0]?.symbol).toBe('BTC-USDT');
    expect(alerts[0]?.active).toBe(true);
    expect(alerts[0]?.priceTarget).toBe(100_000);
    expect(alerts[0]?.lastEvaluatedAt).toBe(1_700_000_000_000);
    expect(alerts[0]?.delivery).toEqual({ type: 'webhook' });
  });

  test('verifies API keys by full hash and records last use', async () => {
    const secret = `lz_live_${'a'.repeat(64)}`;
    const statements: string[] = [];
    const boundValues: unknown[][] = [];
    const env = {
      DB: {
        prepare(statement: string) {
          statements.push(statement);
          const statementIndex = statements.length;
          return {
            bind(...values: unknown[]) {
              boundValues.push(values);
              return {
                async first() {
                  if (statementIndex !== 1) return null;
                  return {
                    id: 'key_1',
                    user_id: 'usr_1',
                    name: 'Builder',
                    key_prefix: secret.slice(0, 18),
                    key_hash: await sha256Hex(secret),
                    scopes_json: '["read:market-data"]',
                    created_at: 1_700_000_000,
                    last_used_at: null,
                    revoked_at: null,
                  };
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

    const record = await verifyApiKey(env, secret);

    expect(record?.id).toBe('key_1');
    expect(record?.keyPrefix).toBe(secret.slice(0, 18));
    expect(record?.scopes).toEqual(['read:market-data']);
    expect(statements.length).toBe(2);
    expect(statements[0]?.includes('WHERE key_prefix = ? AND revoked_at IS NULL')).toBe(true);
    expect(statements[1]?.includes('UPDATE api_keys')).toBe(true);
    expect(statements[1]?.includes('last_used_at <= unixepoch() - 900')).toBe(true);
    expect(boundValues[0]).toEqual([secret.slice(0, 18)]);
    expect(boundValues[1]).toEqual(['key_1']);
  });

  test('rejects malformed API keys before querying D1', async () => {
    let queries = 0;
    const env = {
      DB: {
        prepare() {
          queries += 1;
          throw new Error('should not query');
        },
      },
    } as unknown as Env;

    const record = await verifyApiKey(env, 'not-a-key');

    expect(record).toBe(null);
    expect(queries).toBe(0);
  });

  test('posts triggered alerts to the configured delivery relay without secret fields', async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response('{}', { status: 202 });
    }) as typeof fetch;

    try {
      const delivered = await deliverAlertNotification(
        {
          ALERT_DELIVERY_WEBHOOK_URL: 'https://delivery.example/alerts',
          ALERT_DELIVERY_WEBHOOK_SECRET: 'relay-secret',
        } as Env,
        alertRecord({
          delivery: {
            channels: ['email', 'discord'],
            email: 'user@example.com',
            discord: { channelId: 'alerts', token: 'do-not-forward' },
            ignored: 'value',
          },
        }),
        { eventId: 'ae_1', currentPrice: 101 }
      );

      expect(delivered).toBe(true);
      expect(requestUrl).toBe('https://delivery.example/alerts');
      expect((requestInit?.headers as Record<string, string>).Authorization).toBe(
        'Bearer relay-secret'
      );
      const body = JSON.parse(String(requestInit?.body)) as {
        kind?: unknown;
        delivery?: { discord?: { token?: unknown }; ignored?: unknown };
        payload?: unknown;
      };
      expect(body.kind).toBe('price-alert-triggered');
      expect(body.delivery?.discord?.token).toBe(undefined);
      expect(body.delivery?.ignored).toBe(undefined);
      expect(body.payload).toEqual({ eventId: 'ae_1', currentPrice: 101 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('skips alert delivery relay when no relay URL is configured', async () => {
    const delivered = await deliverAlertNotification(
      {} as Env,
      alertRecord({ delivery: { channels: ['email'] } }),
      { eventId: 'ae_1' }
    );

    expect(delivered).toBe(false);
  });

  test('delivers configured native alert channels without storing provider secrets in alerts', async () => {
    const originalFetch = globalThis.fetch;
    const requestUrls: string[] = [];
    const requestInits: RequestInit[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestUrls.push(String(url));
      requestInits.push(init ?? {});
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const delivered = await deliverAlertNotification(
        {
          ALERT_EMAIL_DELIVERY_WEBHOOK_URL: 'https://email.example/send',
          ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET: 'email-secret',
          ALERT_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/token',
          ALERT_TELEGRAM_BOT_TOKEN: 'telegram-secret',
          ALERT_USER_WEBHOOKS_ENABLED: 'true',
          ALERT_WEBHOOK_SIGNING_SECRET: 'webhook-secret',
        } as Env,
        alertRecord({
          delivery: {
            channels: ['email', 'discord', 'telegram', 'webhook'],
            email: 'user@example.com',
            discord: { channelId: 'alerts', token: 'do-not-store' },
            telegram: { chatId: '123456' },
            webhook: { url: 'https://hooks.example/alerts' },
          },
        }),
        { eventId: 'ae_1', currentPrice: 101 }
      );

      expect(delivered).toBe(true);
      expect(requestUrls).toEqual([
        'https://email.example/send',
        'https://discord.com/api/webhooks/1/token',
        'https://api.telegram.org/bottelegram-secret/sendMessage',
        'https://hooks.example/alerts',
      ]);
      expect((requestInits[0]?.headers as Record<string, string>).Authorization).toBe(
        'Bearer email-secret'
      );
      expect(
        (
          (requestInits[3]?.headers as Record<string, string>)['X-Lazuli-Signature'] ?? ''
        ).startsWith('sha256=')
      ).toBe(true);
      expect((requestInits[3]?.headers as Record<string, string>)['X-Lazuli-Key-Id']).toBe(
        'current'
      );

      const emailBody = JSON.parse(String(requestInits[0]?.body)) as {
        to?: unknown;
        kind?: unknown;
      };
      const telegramBody = JSON.parse(String(requestInits[2]?.body)) as {
        chat_id?: unknown;
      };
      const webhookBody = JSON.parse(String(requestInits[3]?.body)) as {
        delivery?: { discord?: { token?: unknown } };
      };
      expect(emailBody.kind).toBe('price-alert-email');
      expect(emailBody.to).toBe('user@example.com');
      expect(telegramBody.chat_id).toBe('123456');
      expect(webhookBody.delivery?.discord?.token).toBe(undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not deliver unsafe user webhook URLs', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const delivered = await deliverAlertNotification(
        { ALERT_USER_WEBHOOKS_ENABLED: 'true' } as Env,
        alertRecord({
          delivery: { channels: ['webhook'], webhook: { url: 'http://localhost/alerts' } },
        }),
        { eventId: 'ae_1' }
      );

      expect(delivered).toBe(false);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function alertRecord(overrides: Partial<PriceAlertRecord> = {}): PriceAlertRecord {
  return {
    id: 1,
    userId: 'usr_1',
    symbol: 'BTC-USDT',
    exchange: 'bybit',
    marketType: 'spot',
    priceTarget: 100,
    condition: 'above',
    active: true,
    triggeredAt: null,
    topic: 'alerts:price:usr_1',
    delivery: null,
    metadata: null,
    lastPrice: null,
    lastEvaluatedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}
