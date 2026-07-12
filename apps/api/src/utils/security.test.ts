import { describe, expect, test } from 'bun:test';
import {
  buildAdminCanonicalRequest,
  classifyRouteLimit,
  rememberAdminNonce,
  selectRateLimitBindingName,
  shouldFailClosedWhenLimiterUnavailable,
  shouldResolvePublicApiKey,
  signAdminRequest,
  verifyAdminSignature,
  verifyAdminSignatureWithRotation,
} from './security';
import type { Env } from '../types';

const nowMs = 1_700_000_000_000;
const timestamp = String(nowMs);
const nonce = 'nonce-1234567890abcdef';
const signingSecret = 'test-signing-secret';
const keyId = 'ops-key-1';

describe('admin request signing', () => {
  test('canonicalizes paths with sorted query parameters', async () => {
    const left = await buildAdminCanonicalRequest({
      method: 'get',
      url: 'https://api.lazuli.now/api/v1/admin/health?b=2&a=1',
      timestamp,
      nonce,
      body: '',
    });
    const right = await buildAdminCanonicalRequest({
      method: 'GET',
      url: 'https://api.lazuli.now/api/v1/admin/health?a=1&b=2',
      timestamp,
      nonce,
      body: '',
    });

    expect(left).toBe(right);
    expect(left.split('\n')[1]).toBe('/api/v1/admin/health?a=1&b=2');
  });

  test('accepts a valid signature and rejects query/body tampering', async () => {
    const request = {
      method: 'POST',
      url: 'https://api.lazuli.now/api/v1/admin/backfills?dryRun=false',
      timestamp,
      nonce,
      body: JSON.stringify({ exchanges: ['bybit'] }),
    };
    const signature = await signAdminRequest(signingSecret, request);

    expect(
      await verifyAdminSignature({
        expectedKeyId: keyId,
        signingSecret,
        keyId,
        signature,
        nowMs,
        request,
      })
    ).toEqual({ ok: true });

    const queryTamper = await verifyAdminSignature({
      expectedKeyId: keyId,
      signingSecret,
      keyId,
      signature,
      nowMs,
      request: { ...request, url: `${request.url}&limit=100` },
    });
    expect(queryTamper.ok).toBe(false);
    if (!queryTamper.ok) expect(queryTamper.reason).toBe('signature_mismatch');

    const bodyTamper = await verifyAdminSignature({
      expectedKeyId: keyId,
      signingSecret,
      keyId,
      signature,
      nowMs,
      request: { ...request, body: JSON.stringify({ exchanges: ['okx'] }) },
    });
    expect(bodyTamper.ok).toBe(false);
    if (!bodyTamper.ok) expect(bodyTamper.reason).toBe('signature_mismatch');
  });

  test('rejects expired timestamps, invalid nonces, and wrong key ids', async () => {
    const request = {
      method: 'GET',
      url: 'https://api.lazuli.now/api/v1/admin/health',
      timestamp,
      nonce,
      body: '',
    };
    const signature = await signAdminRequest(signingSecret, request);

    const expired = await verifyAdminSignature({
      expectedKeyId: keyId,
      signingSecret,
      keyId,
      signature,
      nowMs: nowMs + 301_000,
      request,
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe('timestamp_outside_window');

    const invalidNonce = await verifyAdminSignature({
      expectedKeyId: keyId,
      signingSecret,
      keyId,
      signature,
      nowMs,
      request: { ...request, nonce: 'short' },
    });
    expect(invalidNonce.ok).toBe(false);
    if (!invalidNonce.ok) expect(invalidNonce.reason).toBe('invalid_nonce');

    const wrongKeyId = await verifyAdminSignature({
      expectedKeyId: keyId,
      signingSecret,
      keyId: 'other-key',
      signature,
      nowMs,
      request,
    });
    expect(wrongKeyId.ok).toBe(false);
    if (!wrongKeyId.ok) expect(wrongKeyId.reason).toBe('key_id_mismatch');
  });

  test('accepts a staged next admin signing key during rotation', async () => {
    const request = {
      method: 'GET',
      url: 'https://api.lazuli.now/api/v1/admin/health',
      timestamp,
      nonce,
      body: '',
    };
    const signature = await signAdminRequest('next-signing-secret', request);
    expect(
      await verifyAdminSignatureWithRotation({
        ring: {
          current: { keyId, secret: signingSecret },
          next: { keyId: 'ops-key-2', secret: 'next-signing-secret' },
        },
        keyId: 'ops-key-2',
        signature,
        nowMs,
        request,
      })
    ).toEqual({ ok: true, keyId: 'ops-key-2' });
  });
});

describe('rate limiter hardening helpers', () => {
  test('fails closed only for admin and expensive route classes', () => {
    expect(classifyRouteLimit('/api/v1/admin/health').routeClass).toBe('admin');
    expect(classifyRouteLimit('/api/v1/orderbook/bybit/BTC-USDT').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/ohlcv/bybit/BTC-USDT').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/screener/bybit').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/custom-pair/bybit/BTC-USDT/ETH-USDT').routeClass).toBe(
      'expensive'
    );
    expect(classifyRouteLimit('/api/v1/institutional/overview').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/alpha-feed').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/liquidations/bybit/BTCUSDT.P').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/orderflow/bybit/BTC-USDT').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/backtest/bybit/BTC-USDT').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/trending/bybit').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/funding/arbitrage').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/arbitrage/prices').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/exchanges').routeClass).toBe('public');

    expect(shouldFailClosedWhenLimiterUnavailable('admin')).toBe(true);
    expect(shouldFailClosedWhenLimiterUnavailable('expensive')).toBe(true);
    expect(shouldFailClosedWhenLimiterUnavailable('public')).toBe(false);
  });

  test('selects dedicated anonymous, builder, and admin bindings', () => {
    expect(selectRateLimitBindingName('/api/v1/exchanges', false)).toBe('PUBLIC_RATE_LIMITER');
    expect(selectRateLimitBindingName('/api/v1/exchanges', true)).toBe(
      'BUILDER_PUBLIC_RATE_LIMITER'
    );
    expect(selectRateLimitBindingName('/api/v1/backtest/bybit/BTC-USDT', false)).toBe(
      'EXPENSIVE_RATE_LIMITER'
    );
    expect(selectRateLimitBindingName('/api/v1/backtest/bybit/BTC-USDT', true)).toBe(
      'BUILDER_EXPENSIVE_RATE_LIMITER'
    );
    expect(selectRateLimitBindingName('/api/v1/admin/health', true)).toBe('ADMIN_RATE_LIMITER');
  });

  test('never performs API-key D1 lookup before account or admin route gates', () => {
    expect(shouldResolvePublicApiKey('/api/v1/auth/magic-link', 'public')).toBe(false);
    expect(shouldResolvePublicApiKey('/api/v1/me', 'public')).toBe(false);
    expect(shouldResolvePublicApiKey('/api/v1/me/api-keys', 'public')).toBe(false);
    expect(shouldResolvePublicApiKey('/api/v1/admin/health', 'admin')).toBe(false);
    expect(shouldResolvePublicApiKey('/api/v1/tickers/bybit', 'public')).toBe(true);
  });

  test('stores only hashed admin nonces and rejects a global replay', async () => {
    let activeExpiry = 0;
    let nonceHash = '';
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => ({
            run: async () => {
              expect(sql.includes('admin_nonces')).toBe(true);
              nonceHash = String(values[1]);
              const requestedExpiry = Number(values[2]);
              const requestTime = Number(values[4]);
              const changes = activeExpiry <= requestTime ? 1 : 0;
              if (changes === 1) activeExpiry = requestedExpiry;
              return { meta: { changes } };
            },
          }),
        }),
      },
    } as unknown as Env;

    await expect(rememberAdminNonce(env, keyId, nonce, nowMs)).resolves.toBe(true);
    expect(nonceHash.includes(nonce)).toBe(false);
    expect(/^[a-f0-9]{64}$/.test(nonceHash)).toBe(true);
    await expect(rememberAdminNonce(env, keyId, nonce, nowMs + 1)).resolves.toBe(false);
    await expect(rememberAdminNonce(env, keyId, nonce, nowMs + 10 * 60 * 1000 + 1)).resolves.toBe(
      true
    );
  });
});
