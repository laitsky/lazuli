import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ReadinessSample {
  observedAt: string;
  customDomainStatus: number;
  isolationStatus: number;
  health: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

export function readinessViolations(sample: ReadinessSample): string[] {
  const failures: string[] = [];
  const health = sample.health;
  const batching = record(health.batching);
  const providers = Array.isArray(health.providers) ? health.providers.map(record) : [];
  if (health.status !== 'ready') failures.push('ingest is not ready');
  if (sample.customDomainStatus !== 200) failures.push('custom-domain health is not HTTP 200');
  if (sample.isolationStatus !== 200) failures.push('workers.dev health is not HTTP 200');
  if (batching.publishingEnabled !== false) failures.push('realtime publishing is not disabled');
  if (number(batching.queued) !== 0) failures.push('ingest queue is not empty');
  if (number(batching.dropped) !== 0) failures.push('ingest has dropped events');
  if (Array.isArray(health.failures) && health.failures.length > 0) {
    failures.push('ingest reports provider failures');
  }
  if (providers.length !== 5) failures.push('five providers are not reported');
  for (const provider of providers) {
    const name = typeof provider.provider === 'string' ? provider.provider : 'unknown';
    if (provider.state !== 'connected') failures.push(`${name} is not connected`);
    if (number(provider.freshnessMs) >= 45_000) failures.push(`${name} is stale`);
    if (!Number.isFinite(number(provider.staleEventsDiscarded))) {
      failures.push(`${name} stale-event telemetry is missing`);
    }
    for (const field of ['reconnects', 'sequenceGaps', 'unresolvedGaps', 'pendingSnapshots']) {
      if (number(provider[field]) !== 0) failures.push(`${name} ${field} is not zero`);
    }
    if (name === 'binance') {
      const channels = record(provider.channels);
      for (const channelName of ['public', 'market']) {
        const channel = record(channels[channelName]);
        if (channel.state !== 'connected') failures.push(`binance ${channelName} is not connected`);
        if (number(channel.reconnects) !== 0) {
          failures.push(`binance ${channelName} reconnects is not zero`);
        }
      }
    }
  }
  return failures;
}

async function fetchStatus(url: string, headers?: HeadersInit): Promise<Response> {
  return fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
}

async function main(): Promise<void> {
  const durationSeconds = Number(Bun.env.READINESS_DURATION_SECONDS ?? 900);
  const intervalSeconds = Number(Bun.env.READINESS_INTERVAL_SECONDS ?? 60);
  const reportPath = Bun.env.READINESS_REPORT ?? '.artifacts/ops/staging-readiness.json';
  const secret = Bun.env.STAGING_OPS_READ_SECRET;
  if (!secret) throw new Error('STAGING_OPS_READ_SECRET is required');
  if (!Number.isInteger(durationSeconds) || durationSeconds < 900) {
    throw new Error('READINESS_DURATION_SECONDS must be at least 900');
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 15 || intervalSeconds > 60) {
    throw new Error('READINESS_INTERVAL_SECONDS must be between 15 and 60');
  }

  const startedAt = Date.now();
  const samples: Array<ReadinessSample & { violations: string[] }> = [];
  let passed = true;
  while (Date.now() - startedAt < durationSeconds * 1_000 || samples.length === 0) {
    let sample: ReadinessSample;
    try {
      const [ingest, custom, isolation] = await Promise.all([
        fetchStatus('https://ingest-staging.lazuli.now/control/health', {
          authorization: `Bearer ${secret}`,
        }),
        fetchStatus('https://api-staging.lazuli.now/health'),
        fetchStatus('https://lazuli-api-staging.vincent-diamond15.workers.dev/health'),
      ]);
      sample = {
        observedAt: new Date().toISOString(),
        customDomainStatus: custom.status,
        isolationStatus: isolation.status,
        health: record(await ingest.json()),
      };
    } catch (error) {
      sample = {
        observedAt: new Date().toISOString(),
        customDomainStatus: 0,
        isolationStatus: 0,
        health: { probeError: error instanceof Error ? error.name : 'probe_error' },
      };
    }
    const violations = readinessViolations(sample);
    samples.push({ ...sample, violations });
    console.log(JSON.stringify({ sample: samples.length - 1, ...sample, violations }));
    if (violations.length > 0) {
      passed = false;
      break;
    }
    const remainingMs = durationSeconds * 1_000 - (Date.now() - startedAt);
    if (remainingMs > 0) await Bun.sleep(Math.min(intervalSeconds * 1_000, remainingMs));
  }

  const endedAt = Date.now();
  const report = {
    schemaVersion: 1,
    gate: 'staging-provider-readiness',
    releaseSha: Bun.env.GITHUB_SHA ?? null,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSeconds: Math.floor((endedAt - startedAt) / 1_000),
    requiredDurationSeconds: durationSeconds,
    passed: passed && endedAt - startedAt >= durationSeconds * 1_000,
    samples,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.main) await main();
