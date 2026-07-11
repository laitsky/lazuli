import type { Context, Next } from 'hono';
import { ErrorCode, internalError, unauthorized } from '../errors';
import { errorResponse } from './response';
import type { Env } from '../types';
import { verifyApiKey } from '../services/growthRetentionService';
import type { ApiKeyRecord } from '@lazuli/shared';

const ADMIN_SIGNATURE_TTL_MS = 5 * 60 * 1000;
const ADMIN_NONCE_TTL_MS = 10 * 60 * 1000;

type AppContext = Context<{ Bindings: Env }>;

export type RouteLimitClass = 'public' | 'expensive' | 'admin';
export type RateLimitBindingName =
  | 'PUBLIC_RATE_LIMITER'
  | 'EXPENSIVE_RATE_LIMITER'
  | 'BUILDER_PUBLIC_RATE_LIMITER'
  | 'BUILDER_EXPENSIVE_RATE_LIMITER'
  | 'ADMIN_RATE_LIMITER';

export interface RouteLimit {
  routeClass: RouteLimitClass;
  anonymousBinding: RateLimitBindingName;
  builderBinding: RateLimitBindingName;
  retryAfterSeconds: number;
}

export interface AdminSignatureParts {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export function requireProductionCors(env: Env): void {
  if (env.ENVIRONMENT === 'production' && parseAllowedOrigins(env).length === 0) {
    throw internalError('CORS_ORIGIN must be configured in production');
  }
}

export function resolveCorsOrigin(origin: string | undefined, env: Env): string | undefined {
  const allowed = parseAllowedOrigins(env);
  if (allowed.length === 0) {
    return env.ENVIRONMENT === 'production' ? undefined : origin;
  }

  return origin && allowed.includes(origin) ? origin : undefined;
}

export function applySecurityHeaders(c: AppContext): void {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  c.header('Cache-Control', defaultCacheControl(c.req.path));
}

export async function enforcePublicRateLimit(c: AppContext, next: Next): Promise<Response | void> {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  const routeLimit = classifyRouteLimit(c.req.path);
  const apiKey = shouldResolvePublicApiKey(c.req.path, routeLimit.routeClass)
    ? await resolvePublicApiKey(c)
    : null;
  const bindingName = apiKey ? routeLimit.builderBinding : routeLimit.anonymousBinding;
  const limiter = c.env[bindingName];
  if (!limiter) {
    if (shouldFailClosedWhenLimiterUnavailable(routeLimit.routeClass)) {
      return rateLimitUnavailableResponse(c, routeLimit.routeClass);
    }

    logSecurityEvent(c, 'rate_limiter_missing_fail_open', {
      routeClass: routeLimit.routeClass,
    });
    await next();
    return;
  }

  const clientId = apiKey ? `api-key:${apiKey.keyPrefix}` : `ip:${clientFingerprint(c)}`;

  try {
    const outcome = await limiter.limit({ key: clientId });
    if (!outcome.success) {
      const retryAfterMs = routeLimit.retryAfterSeconds * 1000;
      c.header('Retry-After', String(routeLimit.retryAfterSeconds));
      c.header('X-RateLimit-Remaining', '0');
      logSecurityEvent(c, 'rate_limit_rejected', {
        routeClass: routeLimit.routeClass,
        bindingName,
        retryAfterMs,
      });
      return c.json(
        {
          ...errorResponse('Too many requests', ErrorCode.EXCHANGE_RATE_LIMIT),
          meta: {
            requestId: c.res.headers.get('X-Request-ID') ?? undefined,
            rateLimit: { retryAfterMs },
          },
        },
        429
      );
    }

    if (apiKey) {
      c.header('X-API-Key-Prefix', apiKey.keyPrefix);
      c.header('X-API-Key-Tier', 'builder');
    }
  } catch (error) {
    if (shouldFailClosedWhenLimiterUnavailable(routeLimit.routeClass)) {
      logSecurityEvent(c, 'rate_limiter_unavailable_fail_closed', {
        routeClass: routeLimit.routeClass,
        bindingName,
        error: error instanceof Error ? error.message : String(error),
      });
      return rateLimitUnavailableResponse(c, routeLimit.routeClass);
    }

    logSecurityEvent(c, 'rate_limiter_unavailable_fail_open', {
      routeClass: routeLimit.routeClass,
      bindingName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await next();
}

async function resolvePublicApiKey(c: AppContext): Promise<ApiKeyRecord | null> {
  const presented = presentedApiKey(c);
  if (!presented) return null;

  const record = await verifyApiKey(c.env, presented).catch((error) => {
    logSecurityEvent(c, 'api_key_verification_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!record) {
    logSecurityEvent(c, 'api_key_auth_failed', { reason: 'invalid_or_revoked' });
    throw unauthorized('Invalid API key');
  }

  logSecurityEvent(c, 'api_key_auth_succeeded', {
    keyPrefix: record.keyPrefix,
    userId: record.userId,
  });
  return record;
}

function presentedApiKey(c: AppContext): string | null {
  const explicit = c.req.header('X-API-Key')?.trim();
  if (explicit) return explicit;

  const authorization = c.req.header('Authorization')?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token?.startsWith('lz_live_') ? token : null;
}

export async function requireAdminRequest(c: AppContext): Promise<void> {
  if (!c.env.ENVIRONMENT || c.env.ENVIRONMENT === 'local') {
    const apiKey = c.req.header('X-Admin-API-Key');
    if (!c.env.ADMIN_API_KEY || !constantTimeEqual(apiKey ?? '', c.env.ADMIN_API_KEY)) {
      logSecurityEvent(c, 'admin_auth_failed', { reason: 'local_api_key_mismatch' });
      throw unauthorized('Admin API key is required');
    }
    return;
  }

  if (!c.env.ADMIN_API_KEY_ID || !c.env.ADMIN_SIGNING_SECRET) {
    throw internalError(
      'ADMIN_API_KEY_ID and ADMIN_SIGNING_SECRET must be configured outside local development'
    );
  }
  if (!c.env.DB) {
    throw internalError('D1 must be configured for admin nonce replay protection');
  }

  const keyId = c.req.header('X-Admin-Key-Id');
  const timestamp = c.req.header('X-Admin-Timestamp');
  const nonce = c.req.header('X-Admin-Nonce');
  const signature = c.req.header('X-Admin-Signature');
  if (!keyId || !timestamp || !nonce || !signature) {
    logSecurityEvent(c, 'admin_auth_failed', { reason: 'missing_headers' });
    throw unauthorized('Signed admin request headers are required');
  }

  if (!constantTimeEqual(keyId, c.env.ADMIN_API_KEY_ID)) {
    logSecurityEvent(c, 'admin_auth_failed', { reason: 'key_id_mismatch' });
    throw unauthorized('Invalid admin request signature');
  }

  const body =
    c.req.method === 'GET' || c.req.method === 'HEAD' ? '' : await c.req.raw.clone().text();
  const verification = await verifyAdminSignature({
    expectedKeyId: c.env.ADMIN_API_KEY_ID,
    signingSecret: c.env.ADMIN_SIGNING_SECRET,
    keyId,
    signature,
    nowMs: Date.now(),
    request: {
      method: c.req.method,
      url: c.req.url,
      timestamp,
      nonce,
      body,
    },
  });

  if (!verification.ok) {
    logSecurityEvent(c, 'admin_auth_failed', { reason: verification.reason });
    throw unauthorized(verification.message);
  }

  if (!(await rememberAdminNonce(c.env, keyId, nonce))) {
    logSecurityEvent(c, 'admin_auth_failed', { reason: 'nonce_replay' });
    throw unauthorized('Admin request nonce has already been used');
  }
  logSecurityEvent(c, 'admin_auth_succeeded', { keyId });
}

export async function buildAdminCanonicalRequest(parts: AdminSignatureParts): Promise<string> {
  const bodyHash = await sha256Hex(parts.body);
  return [
    parts.method.toUpperCase(),
    normalizedPathWithQuery(parts.url),
    parts.timestamp,
    parts.nonce,
    bodyHash,
  ].join('\n');
}

export async function signAdminRequest(
  signingSecret: string,
  parts: AdminSignatureParts
): Promise<string> {
  return hmacSha256Hex(signingSecret, await buildAdminCanonicalRequest(parts));
}

export async function verifyAdminSignature(input: {
  expectedKeyId: string;
  signingSecret: string;
  keyId: string;
  signature: string;
  nowMs: number;
  request: AdminSignatureParts;
}): Promise<{ ok: true } | { ok: false; reason: string; message: string }> {
  if (!constantTimeEqual(input.keyId, input.expectedKeyId)) {
    return { ok: false, reason: 'key_id_mismatch', message: 'Invalid admin request signature' };
  }

  const timestampMs = Number(input.request.timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(input.nowMs - timestampMs) > ADMIN_SIGNATURE_TTL_MS
  ) {
    return {
      ok: false,
      reason: 'timestamp_outside_window',
      message: 'Admin request timestamp is outside the allowed window',
    };
  }

  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.request.nonce)) {
    return {
      ok: false,
      reason: 'invalid_nonce',
      message: 'Admin request nonce is invalid',
    };
  }

  const expected = await signAdminRequest(input.signingSecret, input.request);
  if (!constantTimeEqual(input.signature, expected)) {
    return { ok: false, reason: 'signature_mismatch', message: 'Invalid admin request signature' };
  }

  return { ok: true };
}

export async function rememberAdminNonce(
  env: Env,
  keyId: string,
  nonce: string,
  nowMs = Date.now()
): Promise<boolean> {
  if (!env.DB) throw internalError('D1 must be configured for admin nonce replay protection');

  const now = Math.floor(nowMs / 1000);
  const expiresAt = Math.ceil((nowMs + ADMIN_NONCE_TTL_MS) / 1000);
  const nonceHash = await sha256Hex(nonce);
  const result = await env.DB.prepare(
    `INSERT INTO admin_nonces (key_id, nonce_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key_id, nonce_hash) DO UPDATE SET
       expires_at = excluded.expires_at,
       created_at = excluded.created_at
     WHERE admin_nonces.expires_at <= ?`
  )
    .bind(keyId, nonceHash, expiresAt, now, now)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

function normalizedPathWithQuery(rawUrl: string): string {
  const url = new URL(rawUrl);
  const sortedParams = Array.from(url.searchParams.entries()).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
  );

  if (sortedParams.length === 0) {
    return url.pathname;
  }

  const params = new URLSearchParams();
  for (const [key, value] of sortedParams) {
    params.append(key, value);
  }
  return `${url.pathname}?${params.toString()}`;
}

function logSecurityEvent(c: AppContext, event: string, details: Record<string, unknown>): void {
  const requestId = c.res.headers.get('X-Request-ID') ?? '';
  const routeClass = classifyRouteLimit(c.req.path).routeClass;
  const keyPrefix = typeof details.keyPrefix === 'string' ? details.keyPrefix : '';
  const userId = typeof details.userId === 'string' ? details.userId : '';
  if (
    routeClass === 'admin' ||
    event.includes('failed') ||
    event.includes('rejected') ||
    event.includes('unavailable')
  ) {
    c.env.API_ANALYTICS?.writeDataPoint({
      blobs: [event, c.req.method, routeClass, keyPrefix, userId],
      doubles: [Date.now()],
      indexes: [keyPrefix || event],
    });
  }

  console.warn(
    JSON.stringify({
      level: event.includes('failed') || event.includes('unavailable') ? 'warn' : 'info',
      module: 'security',
      event,
      requestId,
      routeClass,
      ...details,
    })
  );
}

function rateLimitUnavailableResponse(c: AppContext, routeClass: string): Response {
  c.header('Retry-After', '60');
  c.header('X-RateLimit-Remaining', '0');
  return c.json(
    {
      ...errorResponse('Rate limiter unavailable', ErrorCode.EXCHANGE_RATE_LIMIT),
      meta: {
        requestId: c.res.headers.get('X-Request-ID') ?? undefined,
        rateLimit: { retryAfterMs: 60_000, routeClass, unavailable: true },
      },
    },
    429
  );
}

function parseAllowedOrigins(env: Env): string[] {
  return (
    env.CORS_ORIGIN?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export function classifyRouteLimit(path: string): RouteLimit {
  if (path.includes('/admin/')) {
    return {
      routeClass: 'admin',
      anonymousBinding: 'ADMIN_RATE_LIMITER',
      builderBinding: 'ADMIN_RATE_LIMITER',
      retryAfterSeconds: 60,
    };
  }

  if (
    path.includes('/custom-index') ||
    path.includes('/custom-pair/') ||
    path.includes('/superema/') ||
    path.includes('/indicators/') ||
    path.includes('/ohlcv/') ||
    path.includes('/screener/') ||
    path.includes('/orderflow/') ||
    path.includes('/liquidations/') ||
    path.includes('/backtest/') ||
    path.includes('/trending/') ||
    path.includes('/institutional/') ||
    path.includes('/alpha-feed') ||
    path.includes('/funding/radar') ||
    path.includes('/funding/arbitrage') ||
    path.includes('/funding/compare') ||
    path.includes('/arbitrage/prices') ||
    path.includes('/orderbook/')
  ) {
    return {
      routeClass: 'expensive',
      anonymousBinding: 'EXPENSIVE_RATE_LIMITER',
      builderBinding: 'BUILDER_EXPENSIVE_RATE_LIMITER',
      retryAfterSeconds: 60,
    };
  }

  return {
    routeClass: 'public',
    anonymousBinding: 'PUBLIC_RATE_LIMITER',
    builderBinding: 'BUILDER_PUBLIC_RATE_LIMITER',
    retryAfterSeconds: 60,
  };
}

export function selectRateLimitBindingName(
  path: string,
  hasBuilderApiKey: boolean
): RateLimitBindingName {
  const limit = classifyRouteLimit(path);
  return hasBuilderApiKey ? limit.builderBinding : limit.anonymousBinding;
}

export function shouldResolvePublicApiKey(path: string, routeClass: RouteLimitClass): boolean {
  if (routeClass === 'admin') return false;
  return !(
    path === '/api/v1/me' ||
    path.startsWith('/api/v1/me/') ||
    path.startsWith('/api/v1/auth/')
  );
}

export function shouldFailClosedWhenLimiterUnavailable(routeClass: string): boolean {
  return routeClass === 'admin' || routeClass === 'expensive';
}

function clientFingerprint(c: AppContext): string {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'anonymous'
  );
}

function defaultCacheControl(path: string): string {
  if (path.includes('/tickers') || path.includes('/funding') || path.includes('/orderbook')) {
    return 'public, max-age=3, stale-while-revalidate=10';
  }
  if (path.includes('/markets') || path.includes('/exchanges')) {
    return 'public, max-age=300, stale-while-revalidate=3600';
  }
  return 'no-store';
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return hex(new Uint8Array(signature));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let i = 0; i < length; i += 1) {
    diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }

  return diff === 0;
}
