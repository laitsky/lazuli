#!/usr/bin/env node
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const environment = option('--env') ?? 'staging';
const campaignId = option('--campaign');
const payload = JSON.parse(option('--payload') ?? '{}');
const environmentConfig = {
  staging: {
    baseUrl: 'https://api-staging.lazuli.now',
    keyId: 'lazuli-admin-staging',
    keychainService: 'lazuli-admin-signing-staging',
  },
  production: {
    baseUrl: 'https://api.lazuli.now',
    keyId: 'lazuli-admin-production',
    keychainService: 'lazuli-admin-signing-production',
  },
}[environment];

if (!environmentConfig) fail(`Unsupported environment '${environment}'`);

if (command === 'help') {
  console.log(
    'Usage: backfill-campaign.mjs <secret-set|health|plan|start|watch|pause|resume|cancel|retry-gaps|verify|job-retry|history-plan|history-start|history-watch|history-verify|history-pause|history-resume|history-cancel|history-retry-gaps|history-refresh-run|history-refresh-status|fault-set> --env staging|production [--campaign ID] [--job ID] [--payload JSON]'
  );
  process.exit(0);
}

if (command === 'secret-set') {
  setSecret();
  process.exit(0);
}

const secret = readSecret();
if (command === 'health') {
  print(await request('GET', '/api/v1/admin/health'));
} else if (command === 'plan') {
  print(await request('POST', '/api/v1/admin/backfill-campaigns', { ...payload, dryRun: true }));
} else if (command === 'start') {
  print(await request('POST', '/api/v1/admin/backfill-campaigns', payload));
} else if (command === 'job-retry') {
  const jobId = option('--job');
  if (!jobId) fail('--job is required');
  print(await request('POST', `/api/v1/admin/backfills/${jobId}/retry`, {}));
} else if (command === 'history-plan') {
  print(await request('POST', '/api/v1/admin/history-campaigns', { ...payload, dryRun: true }));
} else if (command === 'history-start') {
  print(await request('POST', '/api/v1/admin/history-campaigns', payload));
} else if (command === 'history-refresh-run') {
  print(await request('POST', '/api/v1/admin/history-refresh/run', {}));
} else if (command === 'history-refresh-status') {
  print(await request('GET', '/api/v1/admin/history-refresh'));
} else if (command === 'fault-set') {
  print(await request('PUT', '/api/v1/admin/fault-injections', payload));
} else if (command === 'watch') {
  requireCampaign();
  await watchCampaign(false);
} else if (command === 'verify') {
  requireCampaign();
  await verifyCampaign();
} else if (['pause', 'resume', 'cancel', 'retry-gaps'].includes(command)) {
  requireCampaign();
  print(await request('POST', `/api/v1/admin/backfill-campaigns/${campaignId}/${command}`, {}));
} else if (command === 'history-watch') {
  requireCampaign();
  await watchHistoryCampaign(false);
} else if (command === 'history-verify') {
  requireCampaign();
  await verifyHistoryCampaign();
} else if (command.startsWith('history-')) {
  requireCampaign();
  const action = command.slice('history-'.length);
  if (!['pause', 'resume', 'cancel', 'retry-gaps'].includes(action))
    fail(`Unknown command '${command}'`);
  print(await request('POST', `/api/v1/admin/history-campaigns/${campaignId}/${action}`, {}));
} else {
  fail(`Unknown command '${command}'`);
}

async function verifyCampaign() {
  await watchCampaign(true);
  let cursor;
  let checked = 0;
  let invalid = 0;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const value = await request(
      'GET',
      `/api/v1/admin/backfill-campaigns/${campaignId}/verification?${query}`
    );
    checked += value.data.checked.length;
    invalid += value.data.invalid.length;
    cursor = value.data.done ? undefined : value.data.nextCursor;
  } while (cursor);
  console.log(JSON.stringify({ campaignId, checked, invalid }));
  if (invalid > 0) process.exitCode = 2;
}

async function verifyHistoryCampaign() {
  await watchHistoryCampaign(true);
  let cursor;
  let checked = 0;
  let invalid = 0;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const value = await request(
      'GET',
      `/api/v1/admin/history-campaigns/${campaignId}/verification?${query}`
    );
    checked += value.data.checked.length;
    invalid += value.data.invalid.length;
    cursor = value.data.done ? undefined : value.data.nextCursor;
  } while (cursor);
  console.log(JSON.stringify({ campaignId, checked, invalid }));
  if (invalid > 0) process.exitCode = 2;
}

async function watchHistoryCampaign(requireTerminal) {
  for (;;) {
    const value = await request('GET', `/api/v1/admin/history-campaigns/${campaignId}`);
    const campaign = value.data?.campaign;
    console.log(
      JSON.stringify({
        id: campaign?.id,
        status: campaign?.status,
        completed: campaign?.completed_components,
        gaps: campaign?.gap_components,
        total: campaign?.total_components,
      })
    );
    if (['complete', 'complete_with_gaps', 'failed', 'cancelled'].includes(campaign?.status)) {
      if (requireTerminal && !['complete', 'complete_with_gaps'].includes(campaign.status))
        process.exitCode = 2;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

async function watchCampaign(requireTerminal) {
  for (;;) {
    const value = await request('GET', `/api/v1/admin/backfill-campaigns/${campaignId}`);
    const campaign = value.data?.campaign;
    console.log(
      JSON.stringify({
        id: campaign?.id,
        status: campaign?.status,
        completed: campaign?.completed_components,
        gaps: campaign?.gap_components,
        total: campaign?.total_components,
      })
    );
    if (['complete', 'complete_with_gaps', 'failed', 'cancelled'].includes(campaign?.status)) {
      if (requireTerminal && !['complete', 'complete_with_gaps'].includes(campaign.status)) {
        process.exitCode = 2;
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

async function request(method, path, value) {
  const body = value === undefined ? '' : JSON.stringify(value);
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const canonical = [
      method,
      normalizedPath(`${environmentConfig.baseUrl}${path}`),
      timestamp,
      nonce,
      createHash('sha256').update(body).digest('hex'),
    ].join('\n');
    const response = await fetch(`${environmentConfig.baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        'X-Admin-Key-Id': environmentConfig.keyId,
        'X-Admin-Timestamp': timestamp,
        'X-Admin-Nonce': nonce,
        'X-Admin-Signature': createHmac('sha256', secret).update(canonical).digest('hex'),
      },
      body: body || undefined,
    });
    const responseBody = await response.json().catch(() => ({}));
    if (response.ok) return responseBody;
    lastError = new Error(
      `${method} ${path} returned ${response.status}: ${JSON.stringify(responseBody)}`
    );
    if (response.status < 500 || attempt === 5) throw lastError;
    const ceiling = Math.min(10_000, 500 * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(Math.random() * ceiling)));
  }
  throw lastError;
}

function setSecret() {
  const value = randomBytes(32).toString('hex');
  const keychain = spawnSync(
    'security',
    [
      'add-generic-password',
      '-U',
      '-a',
      'lazuli-operator',
      '-s',
      environmentConfig.keychainService,
      '-w',
      value,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  if (keychain.status !== 0) fail('Could not update macOS Keychain');
  const wrangler = spawnSync(
    'bunx',
    ['wrangler', 'secret', 'put', 'ADMIN_SIGNING_SECRET', '--env', environment],
    { input: `${value}\n`, stdio: ['pipe', 'inherit', 'inherit'] }
  );
  if (wrangler.status !== 0) fail('Could not update the Cloudflare Worker secret');
  console.log(`Admin signing secret updated for ${environment}; value retained in macOS Keychain.`);
}

function readSecret() {
  const result = spawnSync(
    'security',
    [
      'find-generic-password',
      '-a',
      'lazuli-operator',
      '-s',
      environmentConfig.keychainService,
      '-w',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    fail(`No operator secret found. Run secret-set --env ${environment} first.`);
  }
  return result.stdout.trim();
}

function normalizedPath(rawUrl) {
  const url = new URL(rawUrl);
  const entries = [...url.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
  );
  if (entries.length === 0) return url.pathname;
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.append(key, value);
  return `${url.pathname}?${params}`;
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requireCampaign() {
  if (!campaignId) fail('--campaign is required');
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
