import { describe, expect, test } from 'bun:test';
import { validateReleaseEvidence } from './release-evidence';

const result = { passed: true, report: 'docs/operations/evidence/release/report.json' };
const complete = {
  schemaVersion: 1,
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
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    passed: true,
  })),
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
});
