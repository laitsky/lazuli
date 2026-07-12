import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildRealtimeTopic, type SupportedExchange } from '@lazuli/shared';

const args = Bun.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);
const endpoint = new URL(option('url', 'http://127.0.0.1:8787/internal/realtime/batch')!);
const remote = !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
const production = endpoint.hostname === 'api.lazuli.now';
if (remote && !flag('allow-remote')) throw new Error('Remote targets require --allow-remote');
if (production && (!flag('allow-production') || !Bun.env.LAZULI_LOAD_TEST_CHANGE_ID)) {
  throw new Error('Production requires --allow-production and LAZULI_LOAD_TEST_CHANGE_ID');
}

const secret = Bun.env.INGEST_SIGNING_SECRET;
if (!secret) throw new Error('INGEST_SIGNING_SECRET is required');
const keyId = Bun.env.INGEST_SIGNING_SECRET_ID?.trim() || 'ingest-current';
const exchange = option('exchange', 'bybit') as SupportedExchange;
if (!['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'].includes(exchange)) {
  throw new Error('Unsupported exchange');
}
const marketType = option('market-type', exchange === 'upbit' ? 'spot' : 'perp') as 'spot' | 'perp';
const symbol = option('symbol', marketType === 'perp' ? 'BTCUSDT.P' : 'BTC-USDT')!;
const count = boundedInteger(option('count', '60'), 1, 10_000, 'count');
const intervalMs = boundedInteger(option('interval-ms', '500'), 10, 60_000, 'interval-ms');
const reportPath = option('report', `.artifacts/ops/synthetic-${Date.now()}.json`)!;
const startedAt = Date.now();
let accepted = 0;
let failed = 0;

for (let index = 0; index < count; index += 1) {
  const timestamp = Date.now();
  const batchId = crypto.randomUUID();
  const topic = buildRealtimeTopic('ticker', exchange, symbol, marketType);
  const body = JSON.stringify({
    schemaVersion: 1,
    batchId,
    sentAt: timestamp,
    providers: [{ provider: exchange, state: 'connected', synthetic: true }],
    events: [
      {
        schemaVersion: 1,
        type: 'ticker',
        eventId: crypto.randomUUID(),
        sequence: index + 1,
        topic,
        exchangeTimestamp: timestamp,
        ingestedAt: timestamp,
        publishedAt: timestamp,
        provenance: { kind: 'system', provider: 'lazuli-acceptance', quality: 'live' },
        payload: {
          exchange,
          symbol,
          marketType,
          bid: 99_999 + index,
          ask: 100_001 + index,
          last: 100_000 + index,
          volume24h: 1_000_000,
          change24hPercent: 1,
        },
      },
    ],
  });
  const signature = await hmac(secret, `${timestamp}.${body}`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lazuli-timestamp': String(timestamp),
      'x-lazuli-ingest-batch-id': batchId,
      'x-lazuli-key-id': keyId,
      'x-lazuli-signature': `sha256=${signature}`,
    },
    body,
  });
  if (response.ok) accepted += 1;
  else failed += 1;
  if (index + 1 < count) await Bun.sleep(intervalMs);
}

const report = {
  schemaVersion: 1,
  environment: endpoint.hostname,
  target: `${endpoint.origin}${endpoint.pathname}`,
  changeId: Bun.env.LAZULI_LOAD_TEST_CHANGE_ID ?? null,
  startedAt: new Date(startedAt).toISOString(),
  endedAt: new Date().toISOString(),
  count,
  accepted,
  failed,
  passed: accepted === count && failed === 0,
};
await mkdir(dirname(reportPath), { recursive: true });
await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;

function boundedInteger(value: string | undefined, min: number, max: number, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

async function hmac(secretValue: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}
