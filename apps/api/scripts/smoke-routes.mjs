import { createHash, createHmac, randomUUID } from 'node:crypto';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
const adminApiKey = process.env.ADMIN_API_KEY;
const adminKeyId = process.env.ADMIN_API_KEY_ID;
const adminSigningSecret = process.env.ADMIN_SIGNING_SECRET;
const hasAdminAuth = Boolean(adminApiKey || (adminKeyId && adminSigningSecret));

async function get(path) {
  const headers = await adminHeaders('GET', path, '');
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
  });
  const body = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `${path} did not return a success envelope`);
  return body;
}

async function post(path, payload) {
  const requestBody = JSON.stringify(payload);
  const headers = await adminHeaders('POST', path, requestBody);
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: requestBody,
  });
  const responseBody = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(responseBody)}`);
  assert(responseBody.success === true, `${path} did not return a success envelope`);
  return responseBody;
}

async function expectStatus(path, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(
    response.status === expectedStatus,
    `${path} returned ${response.status}; expected ${expectedStatus}`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function adminHeaders(method, path, body) {
  if (!path.includes('/admin/')) {
    return {};
  }

  if (adminKeyId && adminSigningSecret) {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const canonical = [
      method.toUpperCase(),
      normalizedPathWithQuery(`${baseUrl}${path}`),
      timestamp,
      nonce,
      createHash('sha256').update(body).digest('hex'),
    ].join('\n');
    const signature = createHmac('sha256', adminSigningSecret).update(canonical).digest('hex');
    return {
      'X-Admin-Key-Id': adminKeyId,
      'X-Admin-Timestamp': timestamp,
      'X-Admin-Nonce': nonce,
      'X-Admin-Signature': signature,
    };
  }

  return adminApiKey ? { 'X-Admin-API-Key': adminApiKey } : {};
}

function normalizedPathWithQuery(rawUrl) {
  const url = new URL(rawUrl);
  const entries = Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [
    rightKey,
    rightValue,
  ]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  if (entries.length === 0) {
    return url.pathname;
  }
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, value);
  }
  return `${url.pathname}?${params.toString()}`;
}

const health = await get('/api/v1/health');
assert(health.data.status === 'ok', '/api/v1/health did not report ok');
assert(health.data.database === 'hidden', '/api/v1/health exposed deep database status');

const exchanges = await get('/api/v1/exchanges');
assert(exchanges.data.length >= 5, '/api/v1/exchanges returned too few exchanges');

const oldRange = await get(
  '/api/v1/ohlcv/binance/BTC-USDT?timeframe=1d&type=spot&since=1577836800000&until=1577923200000&limit=10'
);
assert(Array.isArray(oldRange.data.candles), '/ohlcv did not return candles array');
assert(oldRange.meta?.missingArchive === true, '/ohlcv did not expose missing archive coverage');

const priceArbitrage = await get('/api/v1/arbitrage/prices?type=spot&quote=USDT&limit=5');
assert(
  Array.isArray(priceArbitrage.data.opportunities),
  '/arbitrage/prices did not return opportunities array'
);

const checks = ['health', 'exchanges', 'ohlcv-coverage', 'price-arbitrage'];

if (hasAdminAuth) {
  const adminHealth = await get('/api/v1/admin/health');
  assert(adminHealth.data.cloudflare, '/api/v1/admin/health did not return deep status');

  const backfill = await post('/api/v1/admin/backfills', {
    exchanges: ['binance'],
    types: ['spot'],
    symbols: ['BTC-USDT'],
    timeframes: ['1d'],
    startTime: 1577836800000,
    endTime: 1580515199000,
    maxSymbolsPerExchange: 1,
  });
  assert(backfill.data.taskCount === 1, 'bounded backfill should create one monthly task');

  const status = await get(`/api/v1/admin/backfills/${backfill.data.jobId}`);
  assert(status.data.progress?.total === 1, 'backfill status did not derive progress from tasks');
  checks.push('admin-health', 'admin-backfill');
} else {
  await expectStatus('/api/v1/admin/health', 401);
  checks.push('admin-rejection');
}

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    checks,
  })
);
