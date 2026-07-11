import { createHash, createHmac, randomUUID } from 'node:crypto';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
const adminApiKey = process.env.ADMIN_API_KEY;
const adminKeyId = process.env.ADMIN_API_KEY_ID;
const adminSigningSecret = process.env.ADMIN_SIGNING_SECRET;
const hasAdminAuth = Boolean(adminApiKey || (adminKeyId && adminSigningSecret));
const smokeProfile = process.env.SMOKE_PROFILE ?? 'full';

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

async function getWithSession(path, sessionToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: sessionHeaders(sessionToken),
  });
  const body = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `${path} did not return a success envelope`);
  return body;
}

async function postWithSession(path, sessionToken, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...sessionHeaders(sessionToken),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `${path} did not return a success envelope`);
  return body;
}

async function deleteWithSession(path, sessionToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: sessionHeaders(sessionToken),
  });
  const body = await response.json();
  assert(response.ok, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(body.success === true, `${path} did not return a success envelope`);
  return body;
}

async function expectStatus(path, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(
    response.status === expectedStatus,
    `${path} returned ${response.status}; expected ${expectedStatus}`
  );
}

async function expectFeatureDisabled(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  assert(response.status === 503, `${path} returned ${response.status}; expected 503`);
  assert(body.success === false, `${path} did not return an error envelope`);
  assert(body.code === 'FEATURE_DISABLED', `${path} did not return FEATURE_DISABLED`);
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

function sessionHeaders(sessionToken) {
  return { Authorization: `Bearer ${sessionToken}` };
}

function normalizedPathWithQuery(rawUrl) {
  const url = new URL(rawUrl);
  const entries = Array.from(url.searchParams.entries()).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
  );
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

if (smokeProfile === 'public-safe') {
  await expectFeatureDisabled('/api/v1/auth/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'disabled@example.com' }),
  });
  await expectFeatureDisabled('/api/v1/me');
  await expectFeatureDisabled('/api/v1/admin/health');
  checks.push('account-disabled', 'admin-disabled');
  console.log(JSON.stringify({ ok: true, baseUrl, smokeProfile, checks }));
  process.exit(0);
}

const alphaFeed = await get('/api/v1/alpha-feed?exchange=bybit&limit=3');
assert(Array.isArray(alphaFeed.data.items), '/alpha-feed did not return items array');
assert(alphaFeed.data.items.length > 0, '/alpha-feed did not return any persisted items');
const alphaFeedEvent = await get(
  `/api/v1/alpha-feed/${encodeURIComponent(alphaFeed.data.items[0].id)}`
);
assert(
  alphaFeedEvent.data.id === alphaFeed.data.items[0].id,
  '/alpha-feed/:id did not return event'
);
checks.push('alpha-feed', 'alpha-feed-detail');

const email = `smoke+${Date.now()}@example.com`;
const magicLink = await post('/api/v1/auth/magic-link', { email });
assert(magicLink.data.email === email, '/auth/magic-link did not echo normalized email');
checks.push('auth-magic-link');

if (magicLink.data.magicLink) {
  const token = new URL(magicLink.data.magicLink).searchParams.get('token');
  assert(token, '/auth/magic-link returned a link without a token');
  const verified = await post('/api/v1/auth/magic-link/verify', { token });
  const sessionToken = verified.data.sessionToken;
  assert(typeof sessionToken === 'string' && sessionToken.length > 0, 'missing session token');

  const me = await getWithSession('/api/v1/me', sessionToken);
  assert(me.data.email === email, '/me did not return the authenticated user');

  const passkeyRegistration = await postWithSession(
    '/api/v1/auth/passkeys/registration/options',
    sessionToken,
    {}
  );
  assert(
    typeof passkeyRegistration.data.challengeId === 'string' &&
      typeof passkeyRegistration.data.options?.challenge === 'string',
    '/auth/passkeys/registration/options did not return WebAuthn options'
  );
  const passkeyAuthentication = await post('/api/v1/auth/passkeys/authentication/options', {});
  assert(
    typeof passkeyAuthentication.data.challengeId === 'string' &&
      typeof passkeyAuthentication.data.options?.challenge === 'string',
    '/auth/passkeys/authentication/options did not return WebAuthn options'
  );
  const passkeys = await getWithSession('/api/v1/me/passkeys', sessionToken);
  assert(Array.isArray(passkeys.data), '/me/passkeys did not return an array');

  const workspace = await postWithSession('/api/v1/me/workspaces', sessionToken, {
    name: 'Smoke Workspace',
    state: { exchange: 'bybit', symbol: 'BTC-USDT' },
    isDefault: true,
  });
  assert(workspace.data.id, 'workspace creation did not return an id');
  const workspaces = await getWithSession('/api/v1/me/workspaces', sessionToken);
  assert(Array.isArray(workspaces.data), '/me/workspaces did not return an array');

  const watchlist = await postWithSession('/api/v1/me/watchlists', sessionToken, {
    name: 'Smoke Watchlist',
    items: ['BTC-USDT', 'ETH-USDT', 'BTC-USDT'],
  });
  assert(watchlist.data.id, 'watchlist creation did not return an id');
  const watchlists = await getWithSession('/api/v1/me/watchlists', sessionToken);
  assert(Array.isArray(watchlists.data), '/me/watchlists did not return an array');

  const savedBacktest = await postWithSession('/api/v1/me/backtests', sessionToken, {
    name: 'Smoke Backtest',
    exchange: 'bybit',
    symbol: 'BTC-USDT',
    timeframe: '1d',
    strategy: { type: 'superema', fast: 21, slow: 55 },
    result: { totalReturn: 0 },
  });
  assert(savedBacktest.data.id, 'saved backtest creation did not return an id');
  const backtests = await getWithSession('/api/v1/me/backtests', sessionToken);
  assert(Array.isArray(backtests.data), '/me/backtests did not return an array');

  const strategyPayload = {
    name: 'Smoke Signal',
    exchange: 'bybit',
    symbol: 'BTC-USDT',
    marketType: 'spot',
    timeframe: '1d',
    strategy: {
      name: 'Smoke Momentum',
      mode: 'momentum',
      fastPeriod: 12,
      slowPeriod: 26,
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      feeBps: 8,
    },
  };
  const signalStrategy = await postWithSession(
    '/api/v1/me/signal-strategies',
    sessionToken,
    strategyPayload
  );
  assert(signalStrategy.data.id, 'Signal Lab strategy creation did not return an id');
  assert(signalStrategy.data.version === 1, 'Signal Lab strategy did not start at version 1');
  const signalVersion = await postWithSession(
    `/api/v1/me/signal-strategies/${signalStrategy.data.id}/versions`,
    sessionToken,
    {
      ...strategyPayload,
      name: 'Smoke Signal v2',
      strategy: {
        ...strategyPayload.strategy,
        fastPeriod: 10,
      },
    }
  );
  assert(signalVersion.data.version === 2, 'Signal Lab strategy version did not increment');
  const signalStrategies = await getWithSession('/api/v1/me/signal-strategies', sessionToken);
  assert(Array.isArray(signalStrategies.data), '/me/signal-strategies did not return an array');

  const alert = await postWithSession('/api/v1/me/alerts', sessionToken, {
    exchange: 'bybit',
    symbol: 'BTC-USDT',
    marketType: 'spot',
    priceTarget: 100000,
    condition: 'above',
    delivery: { channels: ['email'], email },
  });
  assert(alert.data.id, 'alert creation did not return an id');
  const alerts = await getWithSession('/api/v1/me/alerts', sessionToken);
  assert(Array.isArray(alerts.data), '/me/alerts did not return an array');

  const apiKey = await postWithSession('/api/v1/me/api-keys', sessionToken, {
    name: 'Smoke Key',
    scopes: ['read:market-data'],
  });
  assert(apiKey.data.id, 'API key creation did not return an id');
  assert(
    typeof apiKey.data.secret === 'string' && apiKey.data.secret.startsWith('lz_live_'),
    'API key creation did not return the one-time secret'
  );
  const apiKeys = await getWithSession('/api/v1/me/api-keys', sessionToken);
  assert(Array.isArray(apiKeys.data), '/me/api-keys did not return an array');

  await deleteWithSession(`/api/v1/me/api-keys/${apiKey.data.id}`, sessionToken);
  await deleteWithSession(`/api/v1/me/alerts/${alert.data.id}`, sessionToken);
  await deleteWithSession(`/api/v1/me/signal-strategies/${signalStrategy.data.id}`, sessionToken);
  await deleteWithSession(`/api/v1/me/backtests/${savedBacktest.data.id}`, sessionToken);
  await deleteWithSession(`/api/v1/me/watchlists/${watchlist.data.id}`, sessionToken);
  await deleteWithSession(`/api/v1/me/workspaces/${workspace.data.id}`, sessionToken);
  await postWithSession('/api/v1/auth/logout', sessionToken, {});

  checks.push(
    'auth-session',
    'passkeys',
    'saved-workspaces',
    'saved-watchlists',
    'saved-backtests',
    'signal-strategies',
    'price-alerts',
    'api-keys'
  );
} else {
  assert(magicLink.data.delivered === true, 'magic link was neither exposed nor delivered');
  checks.push('auth-delivery-only');
}

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
