import { describe, expect, test } from 'bun:test';
import { verifyOpsReadSecret } from './opsAuth';

describe('read-only operations authentication', () => {
  test('accepts current and staged-next secrets', async () => {
    const env = {
      ENVIRONMENT: 'staging' as const,
      OPS_READ_SECRET: 'current-secret',
      OPS_READ_SECRET_NEXT: 'next-secret',
    };
    expect(await verifyOpsReadSecret(env, 'current-secret')).toBe(true);
    expect(await verifyOpsReadSecret(env, 'next-secret')).toBe(true);
    expect(await verifyOpsReadSecret(env, 'wrong-secret')).toBe(false);
  });

  test('fails closed outside explicitly local development', async () => {
    expect(await verifyOpsReadSecret({ ENVIRONMENT: 'production' }, 'local-ops')).toBe(false);
    expect(await verifyOpsReadSecret({ ENVIRONMENT: 'local' }, 'local-ops')).toBe(true);
    expect(await verifyOpsReadSecret({ ENVIRONMENT: 'local' }, undefined)).toBe(false);
  });
});
