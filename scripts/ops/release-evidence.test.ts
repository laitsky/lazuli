import { describe, expect, test } from 'bun:test';
import { validateReleaseEvidence } from './release-evidence';

const startedAt = '2026-07-01T00:00:00.000Z';
const endedAt = '2026-07-04T00:00:00.000Z';
const result = {
  passed: true,
  report: 'docs/operations/evidence/release/report.json',
  startedAt,
  endedAt,
};
const itemIds = [
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'C1',
  'C2',
  'C3',
  'C4',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
];
const complete = {
  schemaVersion: 2,
  releaseId: '2026-07-11.1',
  environment: 'production',
  commitSha: 'a'.repeat(40),
  generatedAt: new Date().toISOString(),
  owner: 'ops@example.com',
  changeId: 'CHG-1',
  deployments: { api: 'api-v1', web: 'web-v1', ingest: 'ingest-v1' },
  migrations: [
    '0007_realtime',
    '0008_security',
    '0009_recovery',
    '0010_release_controls',
    '0011_fault_injections',
    '0012_operational_observability',
  ],
  dashboards: ['realtime', 'alerts', 'storage-jobs', 'product', 'release'].map((name) => ({
    name,
    url: `https://dash.example/${name}`,
    owner: 'ops',
    alerts: ['alert-1'],
  })),
  acceptance: { browser: result, load: result, reconnect: result, soak: result, security: result },
  drills: Object.fromEntries(
    [
      'provider-disconnect',
      'deployment-restart',
      'd1-outage',
      'r2-outage',
      'queue-dlq',
      'secret-rotation',
      'migration-rehearsal',
      'feature-rollback',
    ].map((name) => [name, result])
  ),
  rollout: ['internal', '5', '25', '100'].map((cohort) => ({
    cohort,
    startedAt,
    endedAt,
    passed: true,
  })),
  items: Object.fromEntries(
    itemIds.map((id) => [
      id,
      Object.fromEntries(
        [
          'implementation',
          'test',
          'deployment',
          'dashboard',
          'drill',
          'rollback',
          'production',
        ].map((kind) => [
          kind,
          [{ ref: `https://evidence.example/${id}/${kind}`, description: `${id} ${kind}` }],
        ])
      ),
    ])
  ),
  rejectedBaselines: [
    { passed: false, report: 'docs/operations/evidence/rejected-load-baseline.json' },
  ],
};

describe('release evidence gate', () => {
  test('accepts a complete production evidence pack', () => {
    expect(validateReleaseEvidence(complete, true)).toEqual([]);
  });

  test('rejects incomplete or staging-only evidence for completion', () => {
    const incomplete = { ...complete, environment: 'staging', dashboards: [] };
    const errors = validateReleaseEvidence(incomplete, true);
    expect(errors.some((error) => error.includes('production evidence'))).toBe(true);
    expect(errors.some((error) => error.includes('dashboard'))).toBe(true);
  });

  test('rejects missing item evidence and shortened observation windows', () => {
    const incomplete = {
      ...complete,
      items: {},
      acceptance: {
        ...complete.acceptance,
        soak: { ...result, endedAt: '2026-07-01T01:00:00.000Z' },
      },
      rollout: complete.rollout.map((item) => ({ ...item, endedAt: item.startedAt })),
    };
    const errors = validateReleaseEvidence(incomplete, true);
    expect(errors.some((error) => error.includes('A0 item evidence'))).toBe(true);
    expect(errors.some((error) => error.includes('72 continuous hours'))).toBe(true);
    expect(errors.some((error) => error.includes('rollout duration'))).toBe(true);
  });
});
