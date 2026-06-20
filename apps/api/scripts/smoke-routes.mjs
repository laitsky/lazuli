const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
const adminApiKey = process.env.ADMIN_API_KEY;

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: adminApiKey && path.includes('/admin/') ? { 'X-Admin-API-Key': adminApiKey } : {},
  });
  const body = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `${path} did not return a success envelope`);
  return body;
}

async function post(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(adminApiKey && path.includes('/admin/') ? { 'X-Admin-API-Key': adminApiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `${path} did not return a success envelope`);
  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const health = await get('/health');
assert(health.data.cloudflare?.d1 === true, '/health did not report D1');
assert(health.data.cloudflare?.r2 === true, '/health did not report R2');

const exchanges = await get('/api/v1/exchanges');
assert(exchanges.data.length >= 5, '/api/v1/exchanges returned too few exchanges');

const oldRange = await get(
  '/api/v1/ohlcv/binance/BTC-USDT?timeframe=1d&type=spot&since=1577836800000&until=1577923200000&limit=10'
);
assert(Array.isArray(oldRange.data.candles), '/ohlcv did not return candles array');
assert(oldRange.meta?.missingArchive === true, '/ohlcv did not expose missing archive coverage');

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

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    checks: ['health', 'exchanges', 'ohlcv-coverage', 'admin-backfill'],
  })
);
