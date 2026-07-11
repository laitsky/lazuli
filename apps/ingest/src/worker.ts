import { Container, getContainer } from '@cloudflare/containers';
import { faultInjectionAllowed, parseFaultDuration, parseProviderFaultPath } from './control';

const CONTAINER_PORT = 8080;
const SUPPORTED_PROVIDERS = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'] as const;

interface Env {
  INGEST_CONTAINER: DurableObjectNamespace<IngestContainer>;
  ENVIRONMENT: string;
  API_BASE_URL: string;
  INGEST_PROVIDERS: string;
  INGEST_SYMBOLS: string;
  UPBIT_QUOTE: string;
  INGEST_SIGNING_SECRET?: string;
  INGEST_SIGNING_SECRET_ID?: string;
  CONTROL_API_TOKEN?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.CONTROL_API_TOKEN) return env.ENVIRONMENT === 'local';
  return request.headers.get('authorization') === `Bearer ${env.CONTROL_API_TOKEN}`;
}

function configuredProviders(env: Env): string[] {
  return [
    ...new Set(env.INGEST_PROVIDERS.split(',').map((value) => value.trim().toLowerCase())),
  ].filter((provider) =>
    SUPPORTED_PROVIDERS.includes(provider as (typeof SUPPORTED_PROVIDERS)[number])
  );
}

function containerName(provider: string): string {
  return `market-ingest-${provider}`;
}

function startOptions(env: Env, provider: string) {
  return {
    ports: [CONTAINER_PORT],
    startOptions: {
      enableInternet: true,
      envVars: {
        ENVIRONMENT: env.ENVIRONMENT,
        API_BASE_URL: env.API_BASE_URL,
        INGEST_PROVIDERS: provider,
        INGEST_SYMBOLS: env.INGEST_SYMBOLS,
        UPBIT_QUOTE: env.UPBIT_QUOTE,
        ...(env.CONTROL_API_TOKEN ? { CONTROL_API_TOKEN: env.CONTROL_API_TOKEN } : {}),
        ...(env.INGEST_SIGNING_SECRET ? { INGEST_SIGNING_SECRET: env.INGEST_SIGNING_SECRET } : {}),
        ...(env.INGEST_SIGNING_SECRET_ID
          ? { INGEST_SIGNING_SECRET_ID: env.INGEST_SIGNING_SECRET_ID }
          : {}),
      },
    },
    cancellationOptions: {
      portReadyTimeoutMS: 30_000,
      instanceGetTimeoutMS: 8_000,
    },
  };
}

export class IngestContainer extends Container {
  defaultPort = CONTAINER_PORT;
  requiredPorts = [CONTAINER_PORT];
  sleepAfter = '10m';
  enableInternet = true;

  override onStart(): void {
    console.log('ingest container started');
  }

  override onStop(): void {
    console.log('ingest container stopped');
  }

  override onError(error: unknown): void {
    console.error('ingest container error', error);
  }
}

async function ensureStarted(
  env: Env,
  provider: string
): Promise<DurableObjectStub<IngestContainer>> {
  const container = getContainer(env.INGEST_CONTAINER, containerName(provider));
  await container.startAndWaitForPorts(startOptions(env, provider));
  return container;
}

async function aggregateHealth(env: Env): Promise<Response> {
  const providers = configuredProviders(env);
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const container = await ensureStarted(env, provider);
      const response = await container.fetch(new Request('http://container/health'));
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(`${provider} health returned ${response.status}`);
      return data;
    })
  );
  const healthy = results.filter(
    (result): result is PromiseFulfilledResult<Record<string, unknown>> =>
      result.status === 'fulfilled'
  );
  const batching = healthy.reduce(
    (total, result) => {
      const value = record(result.value.batching);
      total.queued += numberValue(value.queued);
      total.dropped += numberValue(value.dropped);
      total.batchesSent += numberValue(value.batchesSent);
      total.batchesFailed += numberValue(value.batchesFailed);
      total.lastSuccessAt =
        Math.max(total.lastSuccessAt ?? 0, numberValue(value.lastSuccessAt)) || null;
      if (typeof value.lastError === 'string') total.lastError = value.lastError;
      return total;
    },
    {
      queued: 0,
      dropped: 0,
      batchesSent: 0,
      batchesFailed: 0,
      lastSuccessAt: null as number | null,
      lastError: null as string | null,
    }
  );
  const providerHealth = healthy.flatMap((result) =>
    Array.isArray(result.value.providers) ? result.value.providers : []
  );
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [{ provider: providers[index], error: safeError(result.reason) }]
      : []
  );
  return json(
    {
      status: failures.length === 0 ? 'ready' : healthy.length > 0 ? 'degraded' : 'unavailable',
      environment: env.ENVIRONMENT,
      shards: providers.length,
      providers: providerHealth,
      batching,
      failures,
    },
    failures.length === 0 ? 200 : 503
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      // Passive public liveness: never wake the billable Container.
      return json({
        status: env.INGEST_SIGNING_SECRET ? 'configured' : 'unconfigured',
        environment: env.ENVIRONMENT,
        activeProbe: '/control/health',
      });
    }

    if (url.pathname === '/control/health' && request.method === 'GET') {
      if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      if (!env.INGEST_SIGNING_SECRET) {
        return json(
          { status: 'unavailable', error: 'INGEST_SIGNING_SECRET is not configured' },
          503
        );
      }
      try {
        return await aggregateHealth(env);
      } catch (error) {
        return json(
          { status: 'unavailable', error: error instanceof Error ? error.message : 'unavailable' },
          503
        );
      }
    }

    if (url.pathname === '/start' && request.method === 'POST') {
      if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      if (!env.INGEST_SIGNING_SECRET) {
        return json({ error: 'INGEST_SIGNING_SECRET is not configured' }, 503);
      }

      try {
        return await aggregateHealth(env);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : 'container failed to start' },
          503
        );
      }
    }

    const provider = parseProviderFaultPath(url.pathname);
    if (provider && request.method === 'POST') {
      if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      if (!faultInjectionAllowed(env.ENVIRONMENT)) {
        return json({ error: 'fault injection is disabled in production' }, 404);
      }
      try {
        const durationSeconds = parseFaultDuration(url.searchParams.get('durationSeconds'));
        const container = await ensureStarted(env, provider);
        return await container.fetch(
          new Request(
            `http://container/control/providers/${provider}/disconnect?durationSeconds=${durationSeconds}`,
            {
              method: 'POST',
              headers: { authorization: request.headers.get('authorization') ?? '' },
            }
          )
        );
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : 'provider fault failed' },
          400
        );
      }
    }

    if (url.pathname === '/control/restart' && request.method === 'POST') {
      if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
      if (!faultInjectionAllowed(env.ENVIRONMENT)) {
        return json({ error: 'fault injection is disabled in production' }, 404);
      }
      const providers = configuredProviders(env);
      await Promise.all(
        providers.map(async (provider) => {
          const container = getContainer(env.INGEST_CONTAINER, containerName(provider));
          await container.stop('SIGTERM');
          await container.startAndWaitForPorts(startOptions(env, provider));
        })
      );
      return json({ status: 'restarted', shards: providers.length, timestamp: Date.now() });
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (!env.INGEST_SIGNING_SECRET) {
      console.error('skipping ingest keepalive: signing secret is not configured');
      return;
    }
    await Promise.all(configuredProviders(env).map((provider) => ensureStarted(env, provider)));
  },
} satisfies ExportedHandler<Env>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
