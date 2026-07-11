import { describe, expect, test } from 'bun:test';
import { faultInjectionAllowed, parseFaultDuration, parseProviderFaultPath } from './control';

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

  test('shards the always-on ingest runtime by provider within a hard instance cap', async () => {
    const directory = (import.meta as ImportMeta & { dir: string }).dir;
    const [worker, config] = await Promise.all([
      Bun.file(`${directory}/worker.ts`).text(),
      Bun.file(`${directory}/../wrangler.jsonc`).text(),
    ]);
    expect(worker.includes('return `market-ingest-${provider}`')).toBe(true);
    expect(worker.includes('Promise.all(configuredProviders(env)')).toBe(true);
    expect((config.match(/"max_instances": 5/g) ?? []).length).toBe(3);
  });
});
