import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  EXPECTED_IDS,
  REQUIRED_CONDITIONS,
  readLedger,
  validateLedger,
} from './validate-strategy-ledger';

const repositoryRoot = resolve(import.meta.dir, '..');
const ledgerPath = resolve(repositoryRoot, 'docs/strategy/completion-ledger.json');

function checkedInLedger(): Record<string, any> {
  return structuredClone(readLedger(ledgerPath)) as Record<string, any>;
}

describe('strategy completion ledger', () => {
  test('accepts the checked-in ledger while items remain partial', () => {
    const result = validateLedger(checkedInLedger(), repositoryRoot);

    expect(result.errors).toEqual([]);
    expect(result.summary.partial).toBe(EXPECTED_IDS.length);
    expect(result.summary.complete).toBe(0);
  });

  test('rejects a complete item without all six verified evidence sets', () => {
    const ledger = checkedInLedger();
    ledger.items[0].status = 'complete';
    ledger.items[0].completedAt = '2026-07-11T00:00:00.000Z';

    const result = validateLedger(ledger, repositoryRoot);

    expect(result.errors).toContain('A0 is complete but endToEndFlow is not verified');
    expect(result.errors).toContain('A0 is complete but strategyEvidence has no evidence');
    expect(result.errors).toContain('A0 is complete but has no production evidence');
  });

  test('accepts a complete item with every condition and evidence kind', () => {
    const ledger = checkedInLedger();
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'lazuli-ledger-'));
    mkdirSync(join(fixtureRoot, 'docs/operations/evidence'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'package.json'), '{}');
    writeFileSync(
      join(fixtureRoot, 'docs/operations/evidence/release.json'),
      JSON.stringify(completeReleaseEvidence())
    );
    const item = ledger.items[0];
    item.status = 'complete';
    item.completedAt = '2026-07-11T00:00:00.000Z';

    for (const [index, conditionName] of REQUIRED_CONDITIONS.entries()) {
      const kind = index === 0 ? 'implementation' : index === 1 ? 'test' : 'production';
      item.conditions[conditionName] = {
        state: 'verified',
        evidence: [
          {
            kind,
            ref: kind === 'production' ? 'docs/operations/evidence/release.json' : 'package.json',
            description: `${conditionName} verification`,
          },
        ],
      };
    }

    expect(validateLedger(ledger, fixtureRoot).errors).toEqual([]);
  });

  test('rejects missing and unknown strategy IDs', () => {
    const ledger = checkedInLedger();
    ledger.items[0].id = 'Z9';

    const result = validateLedger(ledger, repositoryRoot);

    expect(result.errors).toContain('missing strategy item A0');
    expect(result.errors).toContain('unknown strategy item Z9');
  });
});

function completeReleaseEvidence() {
  const result = { passed: true, report: 'report.json' };
  return {
    schemaVersion: 1,
    releaseId: 'test-release',
    environment: 'production',
    commitSha: 'a'.repeat(40),
    generatedAt: '2026-07-11T00:00:00.000Z',
    owner: 'ops@example.com',
    changeId: 'CHG-1',
    deployments: { api: 'api-v1', web: 'web-v1', ingest: 'ingest-v1' },
    migrations: ['0007_test', '0008_test', '0009_test', '0010_test', '0011_test', '0012_test'],
    dashboards: ['realtime', 'alerts', 'storage-jobs', 'product', 'release'].map((name) => ({
      name,
      url: `https://dash.example/${name}`,
      owner: 'ops',
      alerts: ['alert-1'],
    })),
    acceptance: {
      browser: result,
      load: result,
      reconnect: result,
      soak: result,
      security: result,
    },
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
      startedAt: '2026-07-11T00:00:00.000Z',
      endedAt: '2026-07-11T01:00:00.000Z',
      passed: true,
    })),
  };
}
