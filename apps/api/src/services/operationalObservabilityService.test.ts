import { describe, expect, test } from 'bun:test';
import {
  getSyntheticProbeBaseUrl,
  percentile95,
  sloBreached,
} from './operationalObservabilityService';

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

  test('synthetic probes prefer service isolation and retain a public fallback', () => {
    expect(
      getSyntheticProbeBaseUrl({
        SERVICE_ISOLATION_API_BASE_URL: 'https://service-isolation.example',
        PUBLIC_API_BASE_URL: 'https://public.example',
      })
    ).toBe('https://service-isolation.example');
    expect(getSyntheticProbeBaseUrl({ PUBLIC_API_BASE_URL: 'https://public.example' })).toBe(
      'https://public.example'
    );
  });

  test('external probe reports remain signed and origin constrained', async () => {
    const directory = (import.meta as ImportMeta & { dir: string }).dir;
    const [worker, config] = await Promise.all([
      Bun.file(`${directory}/../index.ts`).text(),
      Bun.file(`${directory}/../../wrangler.jsonc`).text(),
    ]);
    expect(worker.includes("app.post('/internal/observability/probe'")).toBe(true);
    expect(worker.includes('await requireRealtimeIngestSignature')).toBe(true);
    expect(worker.includes("target.protocol !== 'https:'")).toBe(true);
    expect(worker.includes('allowedOrigins.includes(target.origin)')).toBe(true);
    expect(config.includes('"EXTERNAL_SYNTHETIC_PROBES": "true"')).toBe(true);
  });

  test('suppresses WebSocket paging while realtime rollout is off', async () => {
    const directory = (import.meta as ImportMeta & { dir: string }).dir;
    const service = await Bun.file(`${directory}/operationalObservabilityService.ts`).text();
    expect(service.includes("rolloutFlag: 'realtime'")).toBe(true);
    expect(service.includes("control?.state === 'off'")).toBe(true);
    expect(service.includes('SLO suppressed while release control is off')).toBe(true);
  });
});
