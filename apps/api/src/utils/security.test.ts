import { describe, expect, test } from 'bun:test';
import { isActiveNonceReplay } from './nonceReplay';
import {
  buildAdminCanonicalRequest,
  classifyRouteLimit,
  shouldFailClosedWhenLimiterUnavailable,
  signAdminRequest,
  verifyAdminSignature,
} from './security';

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
});

describe('rate limiter hardening helpers', () => {
  test('fails closed only for admin and expensive route classes', () => {
    expect(classifyRouteLimit('/api/v1/admin/health').routeClass).toBe('admin');
    expect(classifyRouteLimit('/api/v1/orderbook/bybit/BTC-USDT').routeClass).toBe('expensive');
    expect(classifyRouteLimit('/api/v1/exchanges').routeClass).toBe('public');

    expect(shouldFailClosedWhenLimiterUnavailable('admin')).toBe(true);
    expect(shouldFailClosedWhenLimiterUnavailable('expensive')).toBe(true);
    expect(shouldFailClosedWhenLimiterUnavailable('public')).toBe(false);
  });

  test('detects active admin nonce replay windows', () => {
    expect(isActiveNonceReplay(nowMs + 1, nowMs)).toBe(true);
    expect(isActiveNonceReplay(nowMs, nowMs)).toBe(false);
    expect(isActiveNonceReplay(undefined, nowMs)).toBe(false);
  });
});
