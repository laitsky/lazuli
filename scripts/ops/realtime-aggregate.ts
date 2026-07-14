import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface ChildReport {
  schemaVersion: number;
  environment: string;
  target: string;
  startedAt: string;
  endedAt: string;
  passed: boolean;
  config: {
    mode: string;
    connections: number;
    durationSeconds: number;
    rampSeconds: number;
  };
  counters: {
    attempted: number;
    opened: number;
    peakOpen: number;
    openFailures: number;
    unexpectedCloses: number;
    sequenceGaps: number;
    events: number;
    latencySamples: number;
  };
  latency: { p95Ms: number | null };
  memoryGrowthMiB: number;
}

export interface AggregateOptions {
  expectedConnections: number;
  expectedShards: number;
  expectedDurationSeconds: number;
  maxStartSkewSeconds: number;
}

export function aggregateRealtimeReports(reports: ChildReport[], options: AggregateOptions) {
  const sum = (field: keyof ChildReport['counters']) =>
    reports.reduce((total, report) => total + report.counters[field], 0);
  const startTimes = reports.map((report) => Date.parse(report.startedAt));
  const startSkewSeconds =
    startTimes.length === 0 ? null : (Math.max(...startTimes) - Math.min(...startTimes)) / 1000;
  const environments = new Set(reports.map((report) => report.environment));
  const targets = new Set(reports.map((report) => report.target));
  const modes = new Set(reports.map((report) => report.config.mode));
  const latencyP95Values = reports
    .map((report) => report.latency.p95Ms)
    .filter((value): value is number => value !== null);
  const checks = {
    shardCount: reports.length === options.expectedShards,
    schemaVersions: reports.every((report) => report.schemaVersion === 1),
    consistentTarget: environments.size === 1 && targets.size === 1 && modes.size === 1,
    synchronizedStart: startSkewSeconds !== null && startSkewSeconds <= options.maxStartSkewSeconds,
    attemptedConnections: sum('attempted') === options.expectedConnections,
    peakConnections: sum('peakOpen') >= options.expectedConnections,
    openFailures: sum('openFailures') === 0,
    unexpectedCloses: sum('unexpectedCloses') === 0,
    sequenceGaps: sum('sequenceGaps') === 0,
    duration: reports.every(
      (report) => report.config.durationSeconds >= options.expectedDurationSeconds
    ),
    childReports: reports.every((report) => report.passed),
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseCommit: process.env.GITHUB_SHA ?? null,
    environment: reports[0]?.environment ?? null,
    target: reports[0]?.target ?? null,
    options,
    startSkewSeconds,
    counters: {
      attempted: sum('attempted'),
      opened: sum('opened'),
      peakOpen: sum('peakOpen'),
      openFailures: sum('openFailures'),
      unexpectedCloses: sum('unexpectedCloses'),
      sequenceGaps: sum('sequenceGaps'),
      events: sum('events'),
      latencySamples: sum('latencySamples'),
    },
    worstChildLatencyP95Ms: latencyP95Values.length === 0 ? null : Math.max(...latencyP95Values),
    maxChildMemoryGrowthMiB:
      reports.length === 0 ? null : Math.max(...reports.map((report) => report.memoryGrowthMiB)),
    checks,
    childReports: reports.map((report) => ({
      startedAt: report.startedAt,
      endedAt: report.endedAt,
      passed: report.passed,
      counters: report.counters,
      latency: report.latency,
      memoryGrowthMiB: report.memoryGrowthMiB,
    })),
    passed: Object.values(checks).every(Boolean),
  };
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const option = (name: string, fallback?: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const integer = (name: string, fallback: number, minimum: number) => {
    const value = Number(option(name, String(fallback)));
    if (!Number.isInteger(value) || value < minimum) throw new Error(`Invalid --${name}`);
    return value;
  };
  const inputDir = option('input-dir');
  if (!inputDir) throw new Error('--input-dir is required');
  const output = option('report', '.artifacts/ops/realtime-load-aggregate.json')!;
  const files = (await readdir(inputDir)).filter((file) => file.endsWith('.json')).sort();
  const reports = await Promise.all(
    files.map(
      async (file) => JSON.parse(await Bun.file(join(inputDir, file)).text()) as ChildReport
    )
  );
  const aggregate = aggregateRealtimeReports(reports, {
    expectedConnections: integer('expected-connections', 2000, 1),
    expectedShards: integer('expected-shards', 4, 1),
    expectedDurationSeconds: integer('expected-duration-seconds', 3600, 1),
    maxStartSkewSeconds: integer('max-start-skew-seconds', 30, 0),
  });
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, `${JSON.stringify(aggregate, null, 2)}\n`);
  console.log(JSON.stringify({ report: output, ...aggregate }, null, 2));
  if (!aggregate.passed) process.exitCode = 1;
}
