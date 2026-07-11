import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ReleaseStateEnvironment = 'staging' | 'production';

interface CommandResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

const SLO_QUERIES = {
  realtimeLatency:
    "SELECT exchange, quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms FROM lazuli_api WHERE index1 = 'realtime_latency' AND timestamp >= NOW() - INTERVAL '1' HOUR GROUP BY exchange",
  providerFreshness:
    "SELECT exchange, max(timestamp) AS last_event_at FROM lazuli_api WHERE index1 = 'provider_event' GROUP BY exchange",
  queueLag:
    "SELECT blob1 AS queue, max(double1) AS oldest_age_seconds FROM lazuli_api WHERE index1 = 'queue_lag' AND timestamp >= NOW() - INTERVAL '15' MINUTE GROUP BY queue",
  deliverySuccess:
    "SELECT blob1 AS channel, sum(double1) AS delivered, sum(double2) AS failed FROM lazuli_api WHERE index1 = 'alert_delivery' AND timestamp >= NOW() - INTERVAL '1' HOUR GROUP BY channel",
  storageFailures:
    "SELECT blob1 AS storage, sum(double1) AS failures FROM lazuli_api WHERE index1 = 'storage_failure' AND timestamp >= NOW() - INTERVAL '1' HOUR GROUP BY storage",
} as const;

export async function exportReleaseState(input: {
  environment: ReleaseStateEnvironment;
  outputPath: string;
}): Promise<Record<string, unknown>> {
  const env = input.environment;
  const suffix = env === 'staging' ? 'staging' : 'production';
  const database = env === 'staging' ? 'lazuli-db-staging' : 'lazuli-db-prod';
  const [commit, api, web, ingest, migrations, queues, controls] = await Promise.all([
    run(['git', 'rev-parse', 'HEAD']),
    run([
      'bunx',
      'wrangler',
      'deployments',
      'list',
      '--config',
      'apps/api/wrangler.jsonc',
      '--env',
      suffix,
      '--json',
    ]),
    run([
      'bunx',
      'wrangler',
      'deployments',
      'list',
      '--config',
      'apps/web/wrangler.jsonc',
      '--env',
      suffix,
      '--json',
    ]),
    run([
      'bunx',
      'wrangler',
      'deployments',
      'list',
      '--config',
      'apps/ingest/wrangler.jsonc',
      '--env',
      suffix,
      '--json',
    ]),
    run([
      'bunx',
      'wrangler',
      'd1',
      'migrations',
      'list',
      database,
      '--config',
      'apps/api/wrangler.jsonc',
      '--env',
      suffix,
      '--remote',
    ]),
    run(['bunx', 'wrangler', 'queues', 'list', '--config', 'apps/api/wrangler.jsonc']),
    fetchReleaseControls(env),
  ]);

  const report = {
    schemaVersion: 1,
    environment: env,
    generatedAt: new Date().toISOString(),
    commitSha: commit.ok ? commit.stdout.trim() : null,
    deployments: {
      api: sanitizeDeployments(api),
      web: sanitizeDeployments(web),
      ingest: sanitizeDeployments(ingest),
    },
    migrations: sanitizeTextResult(migrations),
    queues: sanitizeQueueResult(queues),
    releaseControls: controls,
    sloQueries: SLO_QUERIES,
  };
  await mkdir(dirname(input.outputPath), { recursive: true });
  await Bun.write(input.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function sanitizeReleaseControls(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.controls)) return null;
  return value.data.controls.map((item) => {
    if (!isRecord(item)) return null;
    return {
      flag: typeof item.flag === 'string' ? item.flag : null,
      state: typeof item.state === 'string' ? item.state : null,
      revision: typeof item.revision === 'number' ? item.revision : null,
      subjectAllowlistCount: Array.isArray(item.subjectAllowlist)
        ? item.subjectAllowlist.length
        : 0,
      providerAllowlistCount: Array.isArray(item.providerAllowlist)
        ? item.providerAllowlist.length
        : 0,
      topicAllowlistCount: Array.isArray(item.topicAllowlist) ? item.topicAllowlist.length : 0,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
    };
  });
}

async function fetchReleaseControls(environment: ReleaseStateEnvironment): Promise<unknown> {
  const baseUrl =
    environment === 'staging' ? 'https://api-staging.lazuli.now' : 'https://api.lazuli.now';
  const keyId = Bun.env.ADMIN_API_KEY_ID;
  const secret = Bun.env.ADMIN_SIGNING_SECRET;
  if (!keyId || !secret) return { status: 'credentials-not-supplied' };
  const url = new URL('/api/v1/admin/release-controls', baseUrl);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const canonical = ['GET', `${url.pathname}${url.search}`, timestamp, nonce, sha256('')].join(
    '\n'
  );
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  try {
    const response = await fetch(url, {
      headers: {
        'X-Admin-Key-Id': keyId,
        'X-Admin-Timestamp': timestamp,
        'X-Admin-Nonce': nonce,
        'X-Admin-Signature': signature,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: `http-${response.status}` };
    return sanitizeReleaseControls(await response.json());
  } catch (error) {
    return { status: 'unavailable', error: safeError(error) };
  }
}

async function run(command: string[]): Promise<CommandResult> {
  const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {
    ok: exitCode === 0,
    stdout,
    error: exitCode === 0 ? null : sanitizeCliError(stderr),
  };
}

function sanitizeDeployments(result: CommandResult): unknown {
  if (!result.ok) return { status: 'unavailable', error: result.error };
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10).map((item) => {
      if (!isRecord(item)) return null;
      return {
        id: stringValue(item.id ?? item.uuid),
        createdAt: stringValue(item.created_on ?? item.createdAt),
        source: stringValue(item.source),
      };
    });
  } catch {
    return { status: 'unparseable' };
  }
}

function sanitizeTextResult(result: CommandResult): unknown {
  return result.ok
    ? { status: 'ok', summary: result.stdout.trim().slice(0, 8_000) }
    : { status: 'unavailable', error: result.error };
}

function sanitizeQueueResult(result: CommandResult): unknown {
  if (!result.ok) return { status: 'unavailable', error: result.error };
  const queues = result.stdout
    .split('\n')
    .map((line) => line.match(/lazuli-[a-z0-9-]+/i)?.[0])
    .filter((value): value is string => Boolean(value));
  return { status: 'ok', names: [...new Set(queues)].sort() };
}

function sanitizeCliError(value: string): string {
  return value
    .replace(/(token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .trim()
    .slice(0, 1_000);
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const environment = args.includes('--production') ? 'production' : 'staging';
  const outputIndex = args.indexOf('--output');
  const outputPath =
    outputIndex >= 0 && args[outputIndex + 1]
      ? args[outputIndex + 1]!
      : `.artifacts/ops/release-state-${environment}-${Date.now()}.json`;
  const report = await exportReleaseState({ environment, outputPath });
  console.log(
    JSON.stringify(
      { environment, output: outputPath, generatedAt: report.generatedAt, secretsIncluded: false },
      null,
      2
    )
  );
}
