import { describe, expect, test } from 'bun:test';
import { percentile95, sloBreached } from './operationalObservabilityService';

declare const Bun: {
  file(path: string): { text(): Promise<string> };
};

describe('operational observability', () => {
  test('uses strict SLO threshold comparisons', () => {
    expect(sloBreached(801, 'max', 800)).toBe(true);
    expect(sloBreached(800, 'max', 800)).toBe(false);
    expect(sloBreached(0.998, 'min', 0.999)).toBe(true);
    expect(sloBreached(0.999, 'min', 0.999)).toBe(false);
  });

  test('calculates a deterministic p95 without mutating caller order', () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(percentile95(values)).toBe(95);
    expect(values[0]).toBe(100);
    expect(percentile95([])).toBe(null);
  });

  test('migration keeps release evidence append-only', async () => {
    const directory = (import.meta as ImportMeta & { dir: string }).dir;
    const migration = await Bun.file(
      `${directory}/../../migrations/0012_operational_observability.sql`
    ).text();
    expect(migration.includes('release_evidence_references_immutable_update')).toBe(true);
    expect(migration.includes('release_evidence_references_immutable_delete')).toBe(true);
    expect(migration.includes('operational_incidents')).toBe(true);
    expect(migration.includes('synthetic_probe_results')).toBe(true);
  });
});
