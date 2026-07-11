import { Container, getContainer } from '@cloudflare/containers';
import { faultInjectionAllowed, parseFaultDuration, parseProviderFaultPath } from './control';

const CONTAINER_NAME = 'market-ingest-primary';
const CONTAINER_PORT = 8080;

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

function startOptions(env: Env) {
  return {
    ports: [CONTAINER_PORT],
    startOptions: {
      enableInternet: true,
      envVars: {
        ENVIRONMENT: env.ENVIRONMENT,
        API_BASE_URL: env.API_BASE_URL,
        INGEST_PROVIDERS: env.INGEST_PROVIDERS,
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

async function ensureStarted(env: Env): Promise<DurableObjectStub<IngestContainer>> {
  const container = getContainer(env.INGEST_CONTAINER, CONTAINER_NAME);
  await container.startAndWaitForPorts(startOptions(env));
  return container;
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
        const container = await ensureStarted(env);
        return await container.fetch(new Request('http://container/health'));
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
        const container = await ensureStarted(env);
        const health = await container.fetch(new Request('http://container/health'));
        return new Response(health.body, {
          status: health.status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
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
        const container = await ensureStarted(env);
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
      const container = getContainer(env.INGEST_CONTAINER, CONTAINER_NAME);
      await container.stop('SIGTERM');
      await container.startAndWaitForPorts(startOptions(env));
      return json({ status: 'restarted', timestamp: Date.now() });
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (!env.INGEST_SIGNING_SECRET) {
      console.error('skipping ingest keepalive: signing secret is not configured');
      return;
    }
    await ensureStarted(env);
  },
} satisfies ExportedHandler<Env>;
