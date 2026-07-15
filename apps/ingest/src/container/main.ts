import { BatchSink } from './batch-sink.ts';
import { BinanceAdapter } from './adapters/binance.ts';
import { BybitAdapter } from './adapters/bybit.ts';
import { HyperliquidAdapter } from './adapters/hyperliquid.ts';
import { OkxAdapter } from './adapters/okx.ts';
import { UpbitAdapter } from './adapters/upbit.ts';
import { loadConfig, providerFreshnessMs, type ProviderHealth } from './types.ts';
import type { ExchangeAdapter } from './adapters/base.ts';

const startedAt = Date.now();
const config = loadConfig(Bun.env);
const adapters: ExchangeAdapter[] = [];
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

const providerHealth = (): ProviderHealth[] =>
  adapters.map((adapter) => ({
    ...adapter.health,
    freshnessMs: providerFreshnessMs(adapter.health),
  }));
const sink = new BatchSink(config, providerHealth);
const emit = sink.enqueue.bind(sink);

for (const provider of config.providers) {
  switch (provider) {
    case 'binance':
      adapters.push(new BinanceAdapter(config.symbols, emit, config.topicAllowlist));
      break;
    case 'bybit':
      adapters.push(new BybitAdapter(config.symbols, emit));
      break;
    case 'okx':
      adapters.push(new OkxAdapter(config.symbols, emit));
      break;
    case 'hyperliquid':
      adapters.push(new HyperliquidAdapter(config.symbols, emit));
      break;
    case 'upbit':
      adapters.push(new UpbitAdapter(config.symbols, emit, config.upbitQuote));
      break;
  }
}

sink.start();
for (const adapter of adapters) adapter.start();

function healthResponse(): Response {
  const providers = providerHealth();
  const ready =
    providers.length > 0 &&
    providers.every(
      (provider) =>
        provider.state === 'connected' &&
        provider.unresolvedGaps === 0 &&
        provider.pendingSnapshots === 0 &&
        provider.freshnessMs !== null &&
        provider.freshnessMs < 45_000
    );
  const live = providers.some((provider) => provider.state === 'connected');
  return Response.json(
    {
      status: ready ? 'ready' : live ? 'degraded' : 'starting',
      environment: config.environment,
      startedAt,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
      symbols: config.symbols,
      providers,
      batching: sink.getHealth(),
    },
    {
      status: ready ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    }
  );
}

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: config.port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ping' && request.method === 'GET') {
      return Response.json({ status: 'accepting-connections', startedAt });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return healthResponse();
    }
    const providerMatch = /^\/control\/providers\/([a-z]+)\/disconnect$/.exec(url.pathname);
    if (providerMatch && request.method === 'POST') {
      if (
        !config.controlApiToken ||
        request.headers.get('authorization') !== `Bearer ${config.controlApiToken}`
      ) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (config.environment === 'production') {
        return Response.json(
          { error: 'fault injection is disabled in production' },
          { status: 404 }
        );
      }
      const adapter = adapters.find((item) => item.health.provider === providerMatch[1]);
      if (!adapter) return Response.json({ error: 'provider not found' }, { status: 404 });
      const durationSeconds = Number(url.searchParams.get('durationSeconds') ?? '30');
      if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 300) {
        return Response.json({ error: 'durationSeconds must be 5-300' }, { status: 400 });
      }
      adapter.stop();
      const existing = reconnectTimers.get(adapter.health.provider);
      if (existing) clearTimeout(existing);
      reconnectTimers.set(
        adapter.health.provider,
        setTimeout(() => {
          adapter.start();
          reconnectTimers.delete(adapter.health.provider);
        }, durationSeconds * 1_000)
      );
      return Response.json({
        status: 'disconnected',
        provider: adapter.health.provider,
        recoveryAt: Date.now() + durationSeconds * 1_000,
      });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}; flushing ingest buffer`);
  for (const adapter of adapters) adapter.stop();
  for (const timer of reconnectTimers.values()) clearTimeout(timer);
  sink.stop();
  await sink.flush();
  await server.stop(true);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log(
  JSON.stringify({
    message: 'Lazuli market ingest started',
    environment: config.environment,
    port: config.port,
    providers: config.providers,
    symbols: config.symbols,
  })
);
