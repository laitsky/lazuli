import { describe, expect, test } from 'bun:test';
import { verifyCloudflareAccessJwt } from './access';

const encode = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

describe('Cloudflare Access JWT verification', () => {
  test('accepts only a valid owner token for the configured audience', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey & {
      kid: string;
    };
    publicJwk.kid = 'test-key';
    const now = 1_800_000_000;
    const header = encode(JSON.stringify({ alg: 'RS256', kid: 'test-key' }));
    const payload = encode(
      JSON.stringify({
        aud: ['ops-audience'],
        email: 'owner@example.com',
        exp: now + 300,
        nbf: now - 1,
        iss: 'https://team.cloudflareaccess.com',
      })
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        pair.privateKey,
        new TextEncoder().encode(`${header}.${payload}`)
      )
    );
    const token = `${header}.${payload}.${encode(signature)}`;
    const mockFetch = (async () => Response.json({ keys: [publicJwk] })) as unknown as typeof fetch;

    expect(
      await verifyCloudflareAccessJwt(
        token,
        {
          teamDomain: 'team.cloudflareaccess.com',
          audience: 'ops-audience',
          ownerEmail: 'owner@example.com',
        },
        mockFetch,
        now
      )
    ).toBe(true);
    expect(
      await verifyCloudflareAccessJwt(
        token,
        {
          teamDomain: 'team.cloudflareaccess.com',
          audience: 'wrong',
          ownerEmail: 'owner@example.com',
        },
        mockFetch,
        now
      )
    ).toBe(false);
  });

  test('rejects malformed, expired, and unsigned tokens', async () => {
    const mockFetch = (async () => Response.json({ keys: [] })) as unknown as typeof fetch;
    expect(
      await verifyCloudflareAccessJwt(
        'not-a-jwt',
        {
          teamDomain: 'team.cloudflareaccess.com',
          audience: 'ops',
          ownerEmail: 'owner@example.com',
        },
        mockFetch,
        100
      )
    ).toBe(false);
  });
});
