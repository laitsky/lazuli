import { describe, expect, test } from 'bun:test';
import {
  faultInjectionAllowed,
  healthRequestAuthorized,
  parseFaultDuration,
  parseProviderFaultPath,
} from './control';

describe('ingest control safety', () => {
  test('accepts only bounded known-provider disconnect paths', () => {
    expect(parseProviderFaultPath('/control/providers/bybit/disconnect')).toBe('bybit');
    expect(parseProviderFaultPath('/control/providers/unknown/disconnect')).toBe(null);
    expect(parseFaultDuration('30')).toBe(30);
    expect(() => parseFaultDuration('301')).toThrow('5 to 300');
  });

  test('rejects production fault injection', () => {
    expect(faultInjectionAllowed('staging')).toBe(true);
    expect(faultInjectionAllowed('production')).toBe(false);
  });

  test('limits active health to control or read-only operational credentials', () => {
    expect(healthRequestAuthorized('Bearer control', 'staging', 'control', 'ops')).toBe(true);
    expect(healthRequestAuthorized('Bearer ops', 'staging', 'control', 'ops')).toBe(true);
    expect(healthRequestAuthorized('Bearer wrong', 'staging', 'control', 'ops')).toBe(false);
    expect(healthRequestAuthorized(null, 'production')).toBe(false);
    expect(healthRequestAuthorized(null, 'local')).toBe(true);
  });

  test('shards the always-on ingest runtime by provider within a hard instance cap', async () => {
    const directory = (import.meta as ImportMeta & { dir: string }).dir;
    const [worker, config] = await Promise.all([
      Bun.file(`${directory}/worker.ts`).text(),
      Bun.file(`${directory}/../wrangler.jsonc`).text(),
    ]);
    expect(worker.includes('return `market-ingest-${provider}`')).toBe(true);
    expect(worker.includes('SHARD_START_STAGGER_MS = 2_000')).toBe(true);
    expect(worker.includes('await signedApiReady(env)')).toBe(true);
    expect(worker.includes('await waitForStopped(container, provider)')).toBe(true);
    expect(worker.includes('{ INGEST_MAX_BUFFERED_EVENTS: env.INGEST_MAX_BUFFERED_EVENTS }')).toBe(
      true
    );
    expect(worker.includes('{ REALTIME_PUBLISH_ENABLED: env.REALTIME_PUBLISH_ENABLED }')).toBe(
      true
    );
    expect(worker.includes('delayedProvider(index, () => ensureStarted(env, provider))')).toBe(
      true
    );
    expect((config.match(/"max_instances": 5/g) ?? []).length).toBe(3);
    expect((config.match(/"regions": \["APAC"\]/g) ?? []).length).toBe(3);
    expect(config.includes('"WEUR"')).toBe(false);
    expect(config.includes('"REALTIME_PUBLISH_ENABLED": "false"')).toBe(true);
  });
});
