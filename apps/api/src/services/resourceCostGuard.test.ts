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
    const backfillCoordinator = await Bun.file(
      `${servicesDirectory}/BackfillCoordinatorDO.ts`
    ).text();

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
    expect(backfillCoordinator.includes('nextAllowedAt')).toBe(true);
    expect(backfillCoordinator.includes('CIRCUIT_COOLDOWN_MS')).toBe(true);
  });

  test('Wrangler uses only the fresh SQLite-backed classes', async () => {
    const config = await Bun.file(`${apiDirectory}/wrangler.jsonc`).text();
    expect(config.includes('"tag": "resource-safe-v1"')).toBe(true);
    expect(config.includes('"tag": "realtime-batched-fanout-v2"')).toBe(true);
    expect(config.includes('"new_sqlite_classes"')).toBe(true);
    expect(/"new_classes"\s*:/.test(config)).toBe(false);
    expect(config.includes('"class_name": "RateLimiterDO"')).toBe(false);
    expect(config.includes('"class_name": "MarketDataCacheDO"')).toBe(false);
    expect(config.includes('"class_name": "BackfillCoordinatorDO"')).toBe(true);
    expect(config.includes('"tag": "realtime-batched-fanout-v2"')).toBe(true);
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

  test('daily historical refresh is enabled only in staging and bounded everywhere', async () => {
    const config = await Bun.file(`${apiDirectory}/wrangler.jsonc`).text();
    const service = await Bun.file(`${servicesDirectory}/historicalDataService.ts`).text();
    expect(config.match(/"HISTORY_DAILY_REFRESH_ENABLED": "false"/g)?.length).toBe(2);
    expect(config.match(/"HISTORY_DAILY_REFRESH_ENABLED": "true"/g)?.length).toBe(1);
    expect(config.match(/"HISTORY_DAILY_TASK_BUDGET": "10"/g)?.length).toBe(3);
    expect(config.match(/"HISTORY_DAILY_ATTEMPT_BUDGET": "30"/g)?.length).toBe(3);
    expect(service.includes('attempts_used<attempt_budget')).toBe(true);
    expect(service.includes('plan.estimatedTasks, taskBudget')).toBe(true);
  });
});
