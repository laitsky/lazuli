import { describe, expect, test } from 'bun:test';
import { createSecretRing, signWithCurrentSecret, verifyRotatingHmac } from './rotatingSecrets';

const ring = createSecretRing({
  currentKeyId: 'key-2026-01',
  currentSecret: 'current-secret-with-sufficient-randomness',
  nextKeyId: 'key-2026-02',
  nextSecret: 'next-secret-with-sufficient-randomness',
  label: 'test',
});

describe('rotating secrets', () => {
  test('signs with current key id and verifies it', async () => {
    const signed = await signWithCurrentSecret(ring, 'payload');
    expect(signed.keyId).toBe('key-2026-01');
    expect(await verifyRotatingHmac({ ring, payload: 'payload', ...signed })).toEqual({
      ok: true,
      keyId: 'key-2026-01',
    });
  });

  test('accepts the staged next key with and without a key id', async () => {
    if (!ring.next) throw new Error('Test ring is missing its next key');
    const signed = await signWithCurrentSecret({ current: ring.next }, 'rotation-payload');
    expect(await verifyRotatingHmac({ ring, payload: 'rotation-payload', ...signed })).toEqual({
      ok: true,
      keyId: 'key-2026-02',
    });
    expect(
      await verifyRotatingHmac({
        ring,
        payload: 'rotation-payload',
        signature: signed.signature,
      })
    ).toEqual({ ok: true, keyId: 'key-2026-02' });
  });

  test('rejects unknown key ids, tampering, and incomplete rotation config', async () => {
    const signed = await signWithCurrentSecret(ring, 'payload');
    expect(await verifyRotatingHmac({ ring, payload: 'tampered', ...signed })).toEqual({
      ok: false,
      keyId: null,
    });
    expect(
      await verifyRotatingHmac({ ring, payload: 'payload', ...signed, keyId: 'unknown' })
    ).toEqual({ ok: false, keyId: null });
    let configError: unknown;
    try {
      createSecretRing({
        currentKeyId: 'current',
        currentSecret: 'secret',
        nextKeyId: 'next',
        label: 'test',
      });
    } catch (error) {
      configError = error;
    }
    expect(configError instanceof Error ? configError.message : '').toBe(
      'test next key id and secret must be configured together'
    );
  });
});
