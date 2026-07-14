import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

type Mode = 'load' | 'reconnect' | 'soak';

type Options = {
  mode: Mode;
  url: string;
  connections: number;
  durationSeconds: number;
  rampSeconds: number;
  cycles: number;
  cyclePauseSeconds: number;
  heartbeatSeconds: number;
  maxOpenFailures: number;
  maxUnexpectedCloses: number;
  maxSequenceGaps: number;
  maxMemoryGrowthMiB: number;
  maxLatencyP95Ms: number;
  minEvents: number;
  minLatencySamples: number;
  allowRemote: boolean;
  allowProduction: boolean;
  report: string;
};

type Counters = {
  attempted: number;
  opened: number;
  peakOpen: number;
  openFailures: number;
  expectedCloses: number;
  unexpectedCloses: number;
  errors: number;
  messages: number;
  events: number;
  sequenceGaps: number;
  latencySamples: number;
  latencyMissing: number;
  reconnectCyclesCompleted: number;
};

const args = Bun.argv.slice(2);

function arg(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = arg(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function options(): Options {
  const mode = (arg('mode') ?? 'load') as Mode;
  if (!['load', 'reconnect', 'soak'].includes(mode)) {
    throw new Error('--mode must be load, reconnect, or soak');
  }
  return {
    mode,
    url: arg('url') ?? 'ws://127.0.0.1:8787/api/v1/ws?topic=ticker:bybit:btcusdt',
    connections: integer('connections', 10, 1, 5000),
    durationSeconds: integer('duration-seconds', 60, 1, 604800),
    rampSeconds: integer('ramp-seconds', 10, 0, 3600),
    cycles: integer('cycles', 3, 1, 100),
    cyclePauseSeconds: integer('cycle-pause-seconds', 5, 0, 300),
    heartbeatSeconds: integer('heartbeat-seconds', 20, 1, 300),
    maxOpenFailures: integer('max-open-failures', 0, 0, 5000),
    maxUnexpectedCloses: integer('max-unexpected-closes', 0, 0, 5000),
    maxSequenceGaps: integer('max-sequence-gaps', 0, 0, 1000000),
    maxMemoryGrowthMiB: integer('max-memory-growth-mib', 256, 1, 16384),
    maxLatencyP95Ms: integer('max-latency-p95-ms', 60000, 1, 300000),
    minEvents: integer('min-events', mode === 'reconnect' ? 0 : 1, 0, 1000000000),
    minLatencySamples: integer('min-latency-samples', mode === 'reconnect' ? 0 : 1, 0, 1000000000),
    allowRemote: flag('allow-remote'),
    allowProduction: flag('allow-production'),
    report: arg('report') ?? `.artifacts/ops/realtime-${mode}-${Date.now()}.json`,
  };
}

function validateTarget(value: string, config: Options): URL {
  const target = new URL(value);
  if (!['ws:', 'wss:'].includes(target.protocol)) throw new Error('Target must use ws or wss');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  if (!local && !config.allowRemote) {
    throw new Error('Remote targets require --allow-remote');
  }
  const production =
    target.hostname === 'api.lazuli.now' ||
    (target.hostname.endsWith('.workers.dev') && !target.hostname.includes('staging'));
  if (production) {
    if (!config.allowProduction || !Bun.env.LAZULI_LOAD_TEST_CHANGE_ID) {
      throw new Error(
        'Production requires --allow-production and LAZULI_LOAD_TEST_CHANGE_ID from an approved change'
      );
    }
  }
  if (!target.searchParams.get('topic')) throw new Error('Target URL must include one topic');
  return target;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  const config = options();
  const target = validateTarget(config.url, config);
  const counters: Counters = {
    attempted: 0,
    opened: 0,
    peakOpen: 0,
    openFailures: 0,
    expectedCloses: 0,
    unexpectedCloses: 0,
    errors: 0,
    messages: 0,
    events: 0,
    sequenceGaps: 0,
    latencySamples: 0,
    latencyMissing: 0,
    reconnectCyclesCompleted: 0,
  };
  const sockets = new Set<WebSocket>();
  const expectedClose = new WeakSet<WebSocket>();
  const socketSequences = new WeakMap<WebSocket, Map<string, number>>();
  const latencyReservoir: number[] = [];
  const diagnostics: {
    errors: Array<{ phase: 'opening' | 'open'; message: string }>;
    unexpectedCloses: Array<{ code: number; reason: string; wasClean: boolean }>;
  } = { errors: [], unexpectedCloses: [] };
  const samples: Array<{
    timestamp: string;
    openSockets: number;
    rssMiB: number;
    events: number;
    sequenceGaps: number;
  }> = [];
  const startedAt = new Date();
  const startMemory = process.memoryUsage().rss;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let sampler: ReturnType<typeof setInterval> | undefined;

  const sample = () => {
    samples.push({
      timestamp: new Date().toISOString(),
      openSockets: sockets.size,
      rssMiB: process.memoryUsage().rss / 1024 / 1024,
      events: counters.events,
      sequenceGaps: counters.sequenceGaps,
    });
  };

  const observeLatency = (milliseconds: number) => {
    counters.latencySamples += 1;
    if (latencyReservoir.length < 20_000) {
      latencyReservoir.push(milliseconds);
      return;
    }
    const replacement = Math.floor(Math.random() * counters.latencySamples);
    if (replacement < latencyReservoir.length) latencyReservoir[replacement] = milliseconds;
  };

  const connect = (): Promise<void> =>
    new Promise((resolve) => {
      counters.attempted += 1;
      const socket = new WebSocket(target.toString());
      let settled = false;
      const settle = (opened: boolean) => {
        if (settled) return;
        settled = true;
        if (!opened) counters.openFailures += 1;
        resolve();
      };
      const timeout = setTimeout(() => {
        expectedClose.add(socket);
        socket.close(4000, 'open timeout');
        settle(false);
      }, 15_000);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        sockets.add(socket);
        socketSequences.set(socket, new Map());
        counters.opened += 1;
        counters.peakOpen = Math.max(counters.peakOpen, sockets.size);
        settle(true);
      });
      socket.addEventListener('message', (message) => {
        counters.messages += 1;
        if (typeof message.data !== 'string') return;
        try {
          const value = JSON.parse(message.data) as Record<string, unknown>;
          if (value.type !== 'event') return;
          counters.events += 1;
          const topic = String(value.topic ?? target.searchParams.get('topic'));
          const sequence = Number(value.sequence);
          const sequences = socketSequences.get(socket) ?? new Map<string, number>();
          socketSequences.set(socket, sequences);
          const previous = sequences.get(topic);
          if (Number.isSafeInteger(sequence)) {
            if (previous !== undefined && sequence > previous + 1) {
              counters.sequenceGaps += sequence - previous - 1;
            }
            if (previous === undefined || sequence > previous) sequences.set(topic, sequence);
          }
          const event =
            value.event !== null && typeof value.event === 'object'
              ? (value.event as Record<string, unknown>)
              : value;
          const exchangeTimestamp = Number(event.exchangeTimestamp);
          if (Number.isFinite(exchangeTimestamp) && exchangeTimestamp > 0) {
            observeLatency(Math.max(0, Date.now() - exchangeTimestamp));
          } else {
            counters.latencyMissing += 1;
          }
        } catch {
          // Non-JSON heartbeat/provider messages are counted but do not affect sequence assertions.
        }
      });
      socket.addEventListener('error', (event) => {
        counters.errors += 1;
        if (diagnostics.errors.length < 32) {
          const detail = event as ErrorEvent & { error?: unknown };
          diagnostics.errors.push({
            phase: settled ? 'open' : 'opening',
            message:
              detail.message ||
              (detail.error instanceof Error ? detail.error.message : String(detail.error ?? '')) ||
              'WebSocket error without runtime detail',
          });
        }
        settle(false);
      });
      socket.addEventListener('close', (event) => {
        clearTimeout(timeout);
        sockets.delete(socket);
        if (expectedClose.has(socket)) counters.expectedCloses += 1;
        else {
          counters.unexpectedCloses += 1;
          if (diagnostics.unexpectedCloses.length < 32) {
            const detail = event as CloseEvent;
            diagnostics.unexpectedCloses.push({
              code: detail.code,
              reason: detail.reason.slice(0, 200),
              wasClean: detail.wasClean,
            });
          }
        }
        settle(false);
      });
    });

  const openWave = async () => {
    const interval =
      config.rampSeconds === 0 ? 0 : (config.rampSeconds * 1000) / config.connections;
    const pending: Promise<void>[] = [];
    for (let index = 0; index < config.connections; index += 1) {
      pending.push(connect());
      if (interval > 0) await sleep(interval);
    }
    await Promise.all(pending);
  };

  const closeWave = async () => {
    const current = [...sockets];
    for (const socket of current) {
      expectedClose.add(socket);
      socket.close(1000, 'acceptance cycle');
    }
    const deadline = Date.now() + 15_000;
    while (sockets.size > 0 && Date.now() < deadline) await sleep(50);
  };

  try {
    heartbeat = setInterval(() => {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }
    }, config.heartbeatSeconds * 1000);
    sample();
    sampler = setInterval(sample, Math.max(10, config.heartbeatSeconds) * 1000);

    if (config.mode === 'reconnect') {
      for (let cycle = 0; cycle < config.cycles; cycle += 1) {
        await openWave();
        await sleep(config.cyclePauseSeconds * 1000);
        await closeWave();
        counters.reconnectCyclesCompleted += 1;
        if (cycle + 1 < config.cycles) await sleep(config.cyclePauseSeconds * 1000);
      }
    } else {
      await openWave();
      await sleep(config.durationSeconds * 1000);
      await closeWave();
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (sampler) clearInterval(sampler);
    await closeWave();
  }

  const endedAt = new Date();
  Bun.gc(true);
  const endMemory = process.memoryUsage().rss;
  const memoryGrowthMiB = (endMemory - startMemory) / 1024 / 1024;
  sample();
  const sortedLatencies = latencyReservoir.toSorted((left, right) => left - right);
  const percentile = (ratio: number): number | null => {
    if (sortedLatencies.length === 0) return null;
    const index = Math.min(
      sortedLatencies.length - 1,
      Math.ceil(sortedLatencies.length * ratio) - 1
    );
    return sortedLatencies[index] ?? null;
  };
  const latency = {
    boundedReservoirSize: sortedLatencies.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
  const checks = {
    peakConnections: counters.peakOpen >= config.connections,
    openFailures: counters.openFailures <= config.maxOpenFailures,
    unexpectedCloses: counters.unexpectedCloses <= config.maxUnexpectedCloses,
    sequenceGaps: counters.sequenceGaps <= config.maxSequenceGaps,
    memoryGrowth: memoryGrowthMiB <= config.maxMemoryGrowthMiB,
    eventCoverage: counters.events >= config.minEvents,
    latencyCoverage: counters.latencySamples >= config.minLatencySamples,
    latencyP95:
      latency.p95Ms === null
        ? config.minLatencySamples === 0
        : latency.p95Ms <= config.maxLatencyP95Ms,
    reconnectCycles:
      config.mode !== 'reconnect' || counters.reconnectCyclesCompleted === config.cycles,
  };
  const passed = Object.values(checks).every(Boolean);
  const report = {
    schemaVersion: 1,
    generatedAt: endedAt.toISOString(),
    changeId: Bun.env.LAZULI_LOAD_TEST_CHANGE_ID ?? null,
    environment: target.hostname,
    target: `${target.origin}${target.pathname}?topic=${target.searchParams.get('topic')}`,
    config: { ...config, url: undefined },
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: (endedAt.getTime() - startedAt.getTime()) / 1000,
    startMemoryMiB: startMemory / 1024 / 1024,
    endMemoryMiB: endMemory / 1024 / 1024,
    memoryGrowthMiB,
    latency,
    diagnostics,
    counters,
    samples,
    checks,
    passed,
    note: 'This client-side report requires correlated platform dashboards and operator review before it becomes release evidence.',
  };
  await mkdir(dirname(config.report), { recursive: true });
  await Bun.write(config.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: config.report, passed, counters, checks }, null, 2));
  if (!passed) process.exitCode = 1;
}

await main();
