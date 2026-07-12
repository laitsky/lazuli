import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Bun.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = new URL(option('api-url', 'http://127.0.0.1:8787')!);
const local = ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname);
if (!local && !args.includes('--allow-remote'))
  throw new Error('Remote targets require --allow-remote');
if (baseUrl.hostname === 'api.lazuli.now' || baseUrl.hostname.includes('production')) {
  throw new Error('Chaos drill tooling refuses production targets');
}
const target = option('target', 'd1')!;
const allowed = ['provider', 'd1', 'r2', 'queue', 'delivery'];
if (!allowed.includes(target)) throw new Error(`--target must be ${allowed.join(', ')}`);
const durationSeconds = Number(option('duration-seconds', '30'));
if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 900) {
  throw new Error('--duration-seconds must be 5-900');
}
const changeId = option('change-id', Bun.env.LAZULI_LOAD_TEST_CHANGE_ID);
if (!changeId) throw new Error('--change-id or LAZULI_LOAD_TEST_CHANGE_ID is required');
const reportPath = option('report', `.artifacts/ops/chaos-${target}-${Date.now()}.json`)!;
const startedAt = new Date();
let response: Response;

if (target === 'provider') {
  const ingestUrl = new URL(option('ingest-url', 'http://127.0.0.1:8790')!);
  if (ingestUrl.hostname === 'lazuli-ingest' || ingestUrl.hostname.includes('production')) {
    throw new Error('Provider drill refuses production ingest targets');
  }
  const token = Bun.env.CONTROL_API_TOKEN;
  if (!token) throw new Error('CONTROL_API_TOKEN is required for provider drills');
  const provider = option('provider', 'bybit')!;
  response = await fetch(
    new URL(
      `/control/providers/${provider}/disconnect?durationSeconds=${Math.min(durationSeconds, 300)}`,
      ingestUrl
    ),
    { method: 'POST', headers: { authorization: `Bearer ${token}` } }
  );
} else {
  const path = '/api/v1/admin/fault-injections';
  const body = JSON.stringify({ target, enabled: true, durationSeconds, changeId });
  response = await fetch(new URL(path, baseUrl), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(await adminHeaders('PUT', new URL(path, baseUrl), body)),
    },
    body,
  });
}

const responseText = await response.text();
const report = {
  schemaVersion: 1,
  environment: baseUrl.hostname,
  target,
  changeId,
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationSeconds,
  responseStatus: response.status,
  accepted: response.ok,
  response: redactResponse(responseText),
  passed: response.ok,
  note: 'Recovery and SLO observations must be appended by the evidence collector.',
};
await mkdir(dirname(reportPath), { recursive: true });
await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
if (!response.ok) process.exitCode = 1;

async function adminHeaders(
  method: string,
  url: URL,
  body: string
): Promise<Record<string, string>> {
  const keyId = Bun.env.ADMIN_API_KEY_ID;
  const secret = Bun.env.ADMIN_SIGNING_SECRET;
  if (!keyId || !secret) throw new Error('ADMIN_API_KEY_ID and ADMIN_SIGNING_SECRET are required');
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const params = new URLSearchParams([...url.searchParams.entries()].sort());
  const normalizedPath = params.size > 0 ? `${url.pathname}?${params}` : url.pathname;
  const canonical = [
    method,
    normalizedPath,
    timestamp,
    nonce,
    createHash('sha256').update(body).digest('hex'),
  ].join('\n');
  return {
    'X-Admin-Key-Id': keyId,
    'X-Admin-Timestamp': timestamp,
    'X-Admin-Nonce': nonce,
    'X-Admin-Signature': createHmac('sha256', secret).update(canonical).digest('hex'),
  };
}

function redactResponse(value: string): string {
  return value
    .replace(/(token|secret|authorization)"?\s*:\s*"[^"]+"/gi, '$1":"[redacted]"')
    .slice(0, 2_000);
}
