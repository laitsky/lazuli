import { describe, expect, test } from 'bun:test';

declare const Bun: {
  file(path: string): { text(): Promise<string>; exists(): Promise<boolean> };
};

const servicesDirectory = (import.meta as ImportMeta & { dir: string }).dir;
const apiDirectory = `${servicesDirectory}/../..`;

describe('Cloudflare cost regression guards', () => {
  test('Durable Objects avoid scheduled callbacks and bound realtime persistence', async () => {
    const marketCache = await Bun.file(`${servicesDirectory}/MarketDataCacheDO.ts`).text();
    const realtimeHub = await Bun.file(`${servicesDirectory}/RealtimeHubDO.ts`).text();

    expect(/\.storage\b/.test(marketCache)).toBe(false);
    expect(realtimeHub.includes('MAX_DEDUPE_EVENTS')).toBe(true);
    expect(realtimeHub.includes('MAX_SNAPSHOT_EVENTS')).toBe(true);
    expect(realtimeHub.includes('MAX_COMPLETED_BATCHES')).toBe(true);
    expect(realtimeHub.includes("url.pathname === '/publish-batch'")).toBe(true);
    expect(realtimeHub.includes('await this.persistBatchCheckpoint(batchId)')).toBe(true);
    expect(realtimeHub.includes('recent: this.recent')).toBe(false);
    expect(realtimeHub.includes('eventSequences: this.eventSequences')).toBe(false);
    for (const source of [marketCache, realtimeHub]) {
      expect(/\b(?:alarm|getAlarm|setAlarm|deleteAlarm)\s*\(/.test(source)).toBe(false);
    }
    expect(await Bun.file(`${servicesDirectory}/RateLimiterDO.ts`).exists()).toBe(false);
  });

  test('Wrangler uses only the fresh SQLite-backed classes', async () => {
    const config = await Bun.file(`${apiDirectory}/wrangler.jsonc`).text();
    expect(config.includes('"tag": "resource-safe-v1"')).toBe(true);
    expect(config.includes('"new_sqlite_classes"')).toBe(true);
    expect(/"new_classes"\s*:/.test(config)).toBe(false);
    expect(config.includes('"class_name": "RateLimiterDO"')).toBe(false);
    expect(config.includes('"class_name": "MarketDataCacheDO"')).toBe(false);
  });

  test('resource-safe migration includes replay and hot-path indexes', async () => {
    const migration = await Bun.file(
      `${apiDirectory}/migrations/0006_resource_safe_relaunch.sql`
    ).text();
    expect(migration.includes('CREATE TABLE IF NOT EXISTS admin_nonces')).toBe(true);
    expect(migration.includes('CREATE TABLE IF NOT EXISTS institutional_provider_status')).toBe(
      true
    );
    expect(migration.includes('idx_price_alerts_due')).toBe(true);
    expect(migration.includes('idx_api_keys_prefix_active')).toBe(true);
  });

  test('scheduled reconciliation uses an explicit internal rollout identity', async () => {
    const index = await Bun.file(`${apiDirectory}/src/index.ts`).text();
    expect(index.includes("subject: { kind: 'internal', id: 'scheduled-worker' }")).toBe(true);
  });

  test('realtime rollback skips replay D1 writes before claiming a batch', async () => {
    const index = await Bun.file(`${apiDirectory}/src/index.ts`).text();
    const emergencyStop = index.indexOf("c.env.REALTIME_INGEST_ENABLED === 'false'");
    const jsonParse = index.indexOf('const parsed = JSON.parse(rawBody)');
    const globalOff = index.indexOf("if (await releaseControlOff(c.env, 'realtime'))");
    const normalization = index.indexOf('const normalizedEvents = parsed.events.map');
    const disabledReturn = index.indexOf('if (enabledEvents.length === 0)');
    const replayClaim = index.indexOf('const claim = await claimRealtimeIngestBatch');
    expect(emergencyStop > -1).toBe(true);
    expect(jsonParse > emergencyStop).toBe(true);
    expect(globalOff > -1).toBe(true);
    expect(normalization > globalOff).toBe(true);
    expect(disabledReturn > -1).toBe(true);
    expect(replayClaim > disabledReturn).toBe(true);
  });
});
