import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import {
  hasMagicLinkDeliveryProvider,
  sendAlertEmail,
  sendMagicLinkEmail,
} from './emailDeliveryService';

describe('Cloudflare email delivery', () => {
  test('prefers native magic-link email and uses the locked sender', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const env = {
      MAGIC_LINK_EMAIL: {
        async send(message: Record<string, unknown>) {
          messages.push(message);
        },
      },
    } as unknown as Env;

    expect(hasMagicLinkDeliveryProvider(env)).toBe(true);
    expect(
      await sendMagicLinkEmail(env, {
        to: 'user@example.com',
        magicLink: 'https://lazuli.now/account?token=secret',
        expiresAt: Date.now() + 15 * 60_000,
      })
    ).toEqual({ ok: true, status: 202, provider: 'cloudflare-email' });
    expect(messages[0]?.from).toBe('signin@lazuli.now');
    expect(messages[0]?.to).toBe('user@example.com');
  });

  test('sends alerts natively with a non-secret idempotency header', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const env = {
      ALERT_EMAIL: {
        async send(message: Record<string, unknown>) {
          messages.push(message);
        },
      },
    } as unknown as Env;
    expect(
      await sendAlertEmail(env, {
        to: 'user@example.com',
        subject: 'Lazuli alert',
        text: 'BTC crossed target',
        payload: { eventId: 'ae_1' },
        idempotencyKey: 'alert:ae_1:channel:nch_1:v1',
      })
    ).toEqual({ ok: true, status: 202, provider: 'cloudflare-email' });
    expect(messages[0]?.from).toBe('alerts@lazuli.now');
    expect(messages[0]?.headers).toEqual({
      'X-Lazuli-Idempotency-Key': 'alert:ae_1:channel:nch_1:v1',
    });
  });

  test('falls back to the existing webhook if native delivery fails', async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('', { status: 202 });
    }) as typeof fetch;
    try {
      const env = {
        ALERT_EMAIL: {
          async send() {
            throw new Error('temporary failure');
          },
        },
        ALERT_EMAIL_DELIVERY_WEBHOOK_URL: 'https://email.example/send',
      } as unknown as Env;
      const result = await sendAlertEmail(env, {
        to: 'user@example.com',
        subject: 'Alert',
        text: 'Text',
        payload: {},
      });
      expect(called).toBe(true);
      expect(result?.provider).toBe('email-webhook');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
