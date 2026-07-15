import { describe, expect, test } from 'bun:test';

const root = new URL('../../', import.meta.url).pathname;

describe('staging realtime acceptance workflow', () => {
  test('loads the native Bybit liquidation SLO topic with strict gates', async () => {
    const workflow = await Bun.file(
      `${root}.github/workflows/staging-realtime-acceptance.yml`
    ).text();
    expect(workflow.match(/liquidations:bybit:btcusdt\.p/g)?.length).toBe(3);
    expect(workflow.includes('topic=ticker:bybit:btcusdt.p')).toBe(false);
    expect(workflow.includes('--max-unexpected-closes 0')).toBe(true);
    expect(workflow.includes('--max-sequence-gaps 0')).toBe(true);
    expect(workflow.includes('--max-latency-p95-ms 800')).toBe(true);
  });

  test('keeps v2 reconnect recovery and event deduplication in the harness', async () => {
    const harness = await Bun.file(`${root}scripts/ops/realtime-acceptance.ts`).text();
    expect(harness.includes("new WebSocket(target.toString(), 'lazuli.realtime.v2')")).toBe(true);
    expect(harness.includes("new URL('/api/v1/realtime/snapshot',")).toBe(true);
    expect(harness.includes('rememberRealtimeClientEvent(client, eventId)')).toBe(true);
    expect(harness.includes('scheduleReconnect(client)')).toBe(true);
    expect(harness.includes('observeEnvelope(client, event, false)')).toBe(true);
    expect(harness.includes('replayEventsExcludedFromLatency')).toBe(true);
  });
});
