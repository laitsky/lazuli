import { describe, expect, test } from 'bun:test';
import { sanitizeReleaseControls } from './export-release-state';

describe('sanitized release-state export', () => {
  test('exports rollout counts without identities', () => {
    const result = sanitizeReleaseControls({
      data: {
        controls: [
          {
            flag: 'accounts',
            state: 'internal',
            revision: 2,
            subjectAllowlist: ['user:private-id'],
            providerAllowlist: [],
            topicAllowlist: ['private-topic'],
            updatedAt: 1,
          },
        ],
      },
    });
    expect(result).toEqual([
      {
        flag: 'accounts',
        state: 'internal',
        revision: 2,
        subjectAllowlistCount: 1,
        providerAllowlistCount: 0,
        topicAllowlistCount: 1,
        updatedAt: 1,
      },
    ]);
    expect(JSON.stringify(result).includes('private-id')).toBe(false);
    expect(JSON.stringify(result).includes('private-topic')).toBe(false);
  });
});
