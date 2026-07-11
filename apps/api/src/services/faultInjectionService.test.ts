import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import { requireFaultTarget, setFaultInjection } from './faultInjectionService';

describe('staging fault injection', () => {
  test('rejects production before touching D1', async () => {
    await expect(
      setFaultInjection({ ENVIRONMENT: 'production' } as Env, {
        target: 'd1',
        enabled: true,
        durationSeconds: 30,
        changeId: 'CHG-1',
        actor: 'test',
      })
    ).rejects.toThrow('Route not found');
  });

  test('validates target names', () => {
    expect(requireFaultTarget('queue')).toBe('queue');
    let failure: unknown;
    try {
      requireFaultTarget('filesystem');
    } catch (error) {
      failure = error;
    }
    expect(failure instanceof Error ? failure.message : '').toBe('Invalid fault target');
  });
});
