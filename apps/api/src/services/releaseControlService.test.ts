import { describe, expect, test } from 'bun:test';
import {
  canonicalReleaseSubject,
  cohortBucket,
  evaluateReleaseControl,
  type ReleaseControlRecord,
  updateReleaseControl,
} from './releaseControlService';
import type { Env } from '../types';

function control(
  state: ReleaseControlRecord['state'],
  overrides: Partial<ReleaseControlRecord> = {}
): ReleaseControlRecord {
  return {
    flag: 'accounts',
    state,
    subjectAllowlist: [],
    providerAllowlist: [],
    topicAllowlist: [],
    revision: 1,
    updatedBy: 'test',
    updateReason: 'fixture',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('release control evaluation', () => {
  test('keeps stable subject cohorts across evaluations', async () => {
    const identity = canonicalReleaseSubject({ kind: 'user', id: 'USER_123' });
    expect(identity).toBe('user:user_123');
    expect(await cohortBucket(identity)).toBe(await cohortBucket(identity));

    const candidate = { kind: 'user', id: 'user_123' } as const;
    const five = await evaluateReleaseControl(control('5'), { subject: candidate });
    const twentyFive = await evaluateReleaseControl(control('25'), { subject: candidate });
    if (five) expect(twentyFive).toBe(true);
  });

  test('honors off, internal allowlists, and full rollout', async () => {
    const internal = control('internal', {
      subjectAllowlist: ['user:operator'],
      providerAllowlist: ['bybit'],
      topicAllowlist: ['liquidations:bybit:btc-usdt.p:perp'],
    });
    expect(
      await evaluateReleaseControl(internal, { subject: { kind: 'user', id: 'operator' } })
    ).toBe(true);
    expect(await evaluateReleaseControl(internal, { resource: { provider: 'BYBIT' } })).toBe(true);
    expect(
      await evaluateReleaseControl(internal, { resource: { topic: 'trades:okx:btc-usdt.p:perp' } })
    ).toBe(false);
    expect(
      await evaluateReleaseControl(control('off'), { subject: { kind: 'internal', id: 'ingest' } })
    ).toBe(false);
    expect(await evaluateReleaseControl(control('100'))).toBe(true);
  });

  test('uses a resource identity for deterministic ingestion percentages', async () => {
    const rollout = control('25', { flag: 'realtime' });
    const resource = { provider: 'okx', topic: 'ticker:okx:btc-usdt.p:perp' };
    expect(await evaluateReleaseControl(rollout, { resource })).toBe(
      await evaluateReleaseControl(rollout, { resource })
    );
  });

  test('rejects stale admin mutations before writing', async () => {
    let writes = 0;
    const row = {
      flag: 'accounts',
      state: 'internal',
      subject_allowlist_json: '[]',
      provider_allowlist_json: '[]',
      topic_allowlist_json: '[]',
      revision: 3,
      updated_by: 'operator',
      update_reason: 'staging',
      created_at: 1,
      updated_at: 1,
    };
    const env = {
      DB: {
        prepare(_sql: string) {
          return {
            bind() {
              return {
                first: async () => row,
                run: async () => {
                  writes += 1;
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(
      updateReleaseControl(env, {
        flag: 'accounts',
        state: '5',
        expectedRevision: 2,
        actor: 'admin',
        reason: 'advance',
      })
    ).rejects.toThrow(/revision conflict/);
    expect(writes).toBe(0);
  });
});
