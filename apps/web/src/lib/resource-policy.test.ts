import { describe, expect, test } from 'bun:test';
import { RESOURCE_POLICY } from './resource-policy';

describe('frontend resource policy', () => {
  test('keeps background polling within the relaunch budget', () => {
    expect(RESOURCE_POLICY.topbarPollMs).toBe(30_000);
    expect(RESOURCE_POLICY.healthPollMs).toBe(300_000);
    expect(RESOURCE_POLICY.alphaFeedPollMs).toBe(120_000);
    expect(RESOURCE_POLICY.visibleOrderBookPollMs).toBe(5_000);
    expect(RESOURCE_POLICY.defaultWorkspaceLayers).toBe('');
  });
});
