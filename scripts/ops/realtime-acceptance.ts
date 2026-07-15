import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createRealtimeClientEventState,
  rememberRealtimeClientEvent,
  type RealtimeClientEventState,
} from './realtime-client-state';

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
  ingestLatencySamples: number;
  latencyMissing: number;
  reconnectCyclesCompleted: number;
  reconnectAttempts: number;
  reconnectRecoveries: number;
  snapshotRecoveries: number;
  snapshotResets: number;
  replayEventsExcludedFromLatency: number;
  deduplicatedEvents: number;
};

type ClientState = RealtimeClientEventState & {
  id: number;
  socket: WebSocket | null;
  connectedAt: number | null;
  sequences: Map<string, number>;
  seenEventIds: Set<string>;
  eventIdOrder: string[];
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  recovering: boolean;
  bufferedEnvelopes: Record<string, unknown>[];
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
    ingestLatencySamples: 0,
    latencyMissing: 0,
    reconnectCyclesCompleted: 0,
    reconnectAttempts: 0,
    reconnectRecoveries: 0,
    snapshotRecoveries: 0,
    snapshotResets: 0,
    replayEventsExcludedFromLatency: 0,
    deduplicatedEvents: 0,
  };
  const sockets = new Set<WebSocket>();
  const expectedClose = new WeakSet<WebSocket>();
  const clients = Array.from({ length: config.connections }, (_, id) => createClientState(id));
  const latencyReservoir: number[] = [];
  const ingestLatencyReservoir: number[] = [];
  const diagnostics: {
    errors: Array<{ phase: 'opening' | 'open'; message: string }>;
    unexpectedCloses: Array<{
      clientId: number;
      observedAt: string;
      connectedForMs: number | null;
      code: number;
      reason: string;
      wasClean: boolean;
    }>;
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
  let acceptingReconnects = false;

  const sample = () => {
    samples.push({
      timestamp: new Date().toISOString(),
      openSockets: sockets.size,
      rssMiB: process.memoryUsage().rss / 1024 / 1024,
      events: counters.events,
      sequenceGaps: counters.sequenceGaps,
    });
  };

  const observeLatency = (
    milliseconds: number,
    reservoir: number[],
    sampleKind: 'source' | 'ingest'
  ) => {
    if (sampleKind === 'source') counters.latencySamples += 1;
    else counters.ingestLatencySamples += 1;
    const totalSamples =
      sampleKind === 'source' ? counters.latencySamples : counters.ingestLatencySamples;
    if (reservoir.length < 20_000) {
      reservoir.push(milliseconds);
      return;
    }
    const replacement = Math.floor(Math.random() * totalSamples);
    if (replacement < reservoir.length) reservoir[replacement] = milliseconds;
  };

  const observeEnvelope = (
    client: ClientState,
    value: Record<string, unknown>,
    sampleLiveLatency = true
  ) => {
    if (value.type !== 'event') return;
    const event =
      value.event !== null && typeof value.event === 'object'
        ? (value.event as Record<string, unknown>)
        : value;
    const eventId = typeof event.eventId === 'string' ? event.eventId : null;
    if (eventId && !rememberRealtimeClientEvent(client, eventId)) {
      counters.deduplicatedEvents += 1;
      return;
    }
    counters.events += 1;
    const topic = String(value.topic ?? target.searchParams.get('topic'));
    const sequence = Number(value.sequence);
    const previous = client.sequences.get(topic);
    if (Number.isSafeInteger(sequence)) {
      if (previous !== undefined && sequence > previous + 1) {
        counters.sequenceGaps += sequence - previous - 1;
      }
      if (previous === undefined || sequence > previous) client.sequences.set(topic, sequence);
    }
    if (sampleLiveLatency) {
      const exchangeTimestamp = Number(event.exchangeTimestamp);
      if (Number.isFinite(exchangeTimestamp) && exchangeTimestamp > 0) {
        observeLatency(Math.max(0, Date.now() - exchangeTimestamp), latencyReservoir, 'source');
      } else {
        counters.latencyMissing += 1;
      }
      const ingestedAt = Number(event.ingestedAt);
      if (Number.isFinite(ingestedAt) && ingestedAt > 0) {
        observeLatency(Math.max(0, Date.now() - ingestedAt), ingestLatencyReservoir, 'ingest');
      }
    } else {
      counters.replayEventsExcludedFromLatency += 1;
    }
  };

  const recover = async (client: ClientState): Promise<void> => {
    const topic = target.searchParams.get('topic') as string;
    const after = client.sequences.get(topic) ?? 0;
    const snapshotUrl = new URL('/api/v1/realtime/snapshot', target.origin.replace(/^ws/, 'http'));
    snapshotUrl.searchParams.set('topic', topic);
    snapshotUrl.searchParams.set('after', String(after));
    const response = await fetch(snapshotUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Snapshot recovery returned HTTP ${response.status}`);
    const snapshot = (await response.json()) as {
      sequence?: unknown;
      resetRequired?: unknown;
      events?: unknown;
    };
    if (snapshot.resetRequired === true) {
      counters.snapshotResets += 1;
      const sequence = Number(snapshot.sequence);
      if (Number.isSafeInteger(sequence) && sequence >= 0) client.sequences.set(topic, sequence);
      return;
    }
    if (Array.isArray(snapshot.events)) {
      for (const event of snapshot.events) {
        if (isRecord(event)) observeEnvelope(client, event, false);
      }
    }
    counters.snapshotRecoveries += 1;
  };

  const scheduleReconnect = (client: ClientState) => {
    if (!acceptingReconnects || client.stopped || client.reconnectTimer !== null) return;
    const delay = Math.min(5_000, 250 * 2 ** Math.min(client.reconnectAttempt, 5));
    client.reconnectAttempt += 1;
    client.reconnectTimer = setTimeout(() => {
      client.reconnectTimer = null;
      void connect(client, true);
    }, delay);
  };

  const connect = (client: ClientState, reconnect = false): Promise<void> =>
    new Promise((resolve) => {
      if (reconnect) counters.reconnectAttempts += 1;
      else counters.attempted += 1;
      client.recovering = reconnect;
      const socket = new WebSocket(target.toString(), 'lazuli.realtime.v2');
      client.socket = socket;
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
        scheduleReconnect(client);
      }, 15_000);
      socket.addEventListener('open', async () => {
        clearTimeout(timeout);
        if (client.stopped) {
          expectedClose.add(socket);
          socket.close(1000, 'acceptance stopped');
          settle(false);
          return;
        }
        sockets.add(socket);
        client.connectedAt = Date.now();
        counters.opened += 1;
        counters.peakOpen = Math.max(counters.peakOpen, sockets.size);
        if (reconnect) {
          try {
            await recover(client);
            counters.reconnectRecoveries += 1;
            client.reconnectAttempt = 0;
          } catch (error) {
            counters.errors += 1;
            if (diagnostics.errors.length < 32) {
              diagnostics.errors.push({
                phase: 'open',
                message: error instanceof Error ? error.message : String(error),
              });
            }
          } finally {
            client.recovering = false;
            for (const envelope of client.bufferedEnvelopes.splice(0)) {
              observeEnvelope(client, envelope);
            }
          }
        }
        settle(true);
      });
      socket.addEventListener('message', (message) => {
        counters.messages += 1;
        if (typeof message.data !== 'string') return;
        try {
          const value = JSON.parse(message.data) as Record<string, unknown>;
          const envelopes =
            value.type === 'batch' && Array.isArray(value.events)
              ? value.events.filter(isRecord)
              : value.type === 'event'
                ? [value]
                : [];
          if (client.recovering) client.bufferedEnvelopes.push(...envelopes);
          else for (const envelope of envelopes) observeEnvelope(client, envelope);
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
        if (client.socket === socket) client.socket = null;
        if (expectedClose.has(socket)) counters.expectedCloses += 1;
        else {
          counters.unexpectedCloses += 1;
          if (diagnostics.unexpectedCloses.length < 32) {
            const detail = event as CloseEvent;
            diagnostics.unexpectedCloses.push({
              clientId: client.id,
              observedAt: new Date().toISOString(),
              connectedForMs:
                client.connectedAt === null ? null : Math.max(0, Date.now() - client.connectedAt),
              code: detail.code,
              reason: detail.reason.slice(0, 200),
              wasClean: detail.wasClean,
            });
          }
          scheduleReconnect(client);
        }
        settle(false);
      });
    });

  const openWave = async (reconnect = false) => {
    acceptingReconnects = true;
    const interval =
      config.rampSeconds === 0 ? 0 : (config.rampSeconds * 1000) / config.connections;
    const pending: Promise<void>[] = [];
    for (let index = 0; index < config.connections; index += 1) {
      const client = clients[index];
      if (client) {
        client.stopped = false;
        pending.push(connect(client, reconnect));
      }
      if (interval > 0) await sleep(interval);
    }
    await Promise.all(pending);
  };

  const closeWave = async () => {
    acceptingReconnects = false;
    for (const client of clients) {
      client.stopped = true;
      if (client.reconnectTimer !== null) clearTimeout(client.reconnectTimer);
      client.reconnectTimer = null;
    }
    const current = [
      ...new Set(
        clients.flatMap((client) => (client.socket ? [client.socket] : [])).concat([...sockets])
      ),
    ];
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
        await openWave(cycle > 0);
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
  const sortedIngestLatencies = ingestLatencyReservoir.toSorted((left, right) => left - right);
  const ingestPercentile = (ratio: number): number | null => {
    if (sortedIngestLatencies.length === 0) return null;
    const index = Math.min(
      sortedIngestLatencies.length - 1,
      Math.ceil(sortedIngestLatencies.length * ratio) - 1
    );
    return sortedIngestLatencies[index] ?? null;
  };
  const ingestLatency = {
    boundedReservoirSize: sortedIngestLatencies.length,
    p50Ms: ingestPercentile(0.5),
    p95Ms: ingestPercentile(0.95),
    p99Ms: ingestPercentile(0.99),
  };
  const checks = {
    peakConnections: counters.peakOpen >= config.connections,
    openFailures: counters.openFailures <= config.maxOpenFailures,
    unexpectedCloses: counters.unexpectedCloses <= config.maxUnexpectedCloses,
    sequenceGaps: counters.sequenceGaps <= config.maxSequenceGaps,
    snapshotResets: counters.snapshotResets === 0,
    memoryGrowth: memoryGrowthMiB <= config.maxMemoryGrowthMiB,
    eventCoverage: counters.events >= config.minEvents,
    latencyCoverage: counters.latencySamples >= config.minLatencySamples,
    latencyP95:
      latency.p95Ms === null
        ? config.minLatencySamples === 0
        : latency.p95Ms <= config.maxLatencyP95Ms,
    reconnectCycles:
      config.mode !== 'reconnect' ||
      (counters.reconnectCyclesCompleted === config.cycles &&
        counters.reconnectRecoveries === counters.reconnectAttempts),
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
    ingestLatency,
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

function createClientState(id: number): ClientState {
  return {
    ...createRealtimeClientEventState(),
    id,
    socket: null,
    connectedAt: null,
    sequences: new Map(),
    reconnectAttempt: 0,
    reconnectTimer: null,
    stopped: false,
    recovering: false,
    bufferedEnvelopes: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
