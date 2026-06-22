import type { Context, Next } from 'hono';
import { ErrorCode, internalError, unauthorized } from '../errors';
import { errorResponse } from './response';
import type { Env } from '../types';

const ADMIN_SIGNATURE_TTL_MS = 5 * 60 * 1000;
const ADMIN_NONCE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMITER_TIMEOUT_MS = 750;

type AppContext = Context<{ Bindings: Env }>;

interface RouteLimit {
  capacity: number;
  refillPerSecond: number;
  routeClass: string;
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
  if (!c.env.RATE_LIMITER) {
    if (shouldFailClosedWhenLimiterUnavailable(routeLimit.routeClass)) {
      return rateLimitUnavailableResponse(c, routeLimit.routeClass);
    }

    logSecurityEvent(c, 'rate_limiter_missing_fail_open', {
      routeClass: routeLimit.routeClass,
    });
    await next();
    return;
  }

  const clientId = clientFingerprint(c);
  const id = c.env.RATE_LIMITER.idFromName(`${routeLimit.routeClass}:${clientId}`);
  const url = new URL('https://rate-limit/acquire');
  url.searchParams.set('cost', '1');
  url.searchParams.set('capacity', String(routeLimit.capacity));
  url.searchParams.set('refillPerSecond', String(routeLimit.refillPerSecond));

  try {
    const response = await fetchWithTimeout(
      () => c.env.RATE_LIMITER.get(id).fetch(url.toString()),
      RATE_LIMITER_TIMEOUT_MS
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { retryAfterMs?: number; remaining?: number };
    };

    if (response.status === 429) {
      const retryAfterMs = payload.data?.retryAfterMs ?? 1000;
      c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      c.header('X-RateLimit-Remaining', '0');
      logSecurityEvent(c, 'rate_limit_rejected', {
        routeClass: routeLimit.routeClass,
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

    if (typeof payload.data?.remaining === 'number') {
      c.header('X-RateLimit-Remaining', String(Math.floor(payload.data.remaining)));
      logSecurityEvent(c, 'rate_limit_granted', {
        routeClass: routeLimit.routeClass,
        remaining: Math.floor(payload.data.remaining),
      });
    }
  } catch (error) {
    if (shouldFailClosedWhenLimiterUnavailable(routeLimit.routeClass)) {
      logSecurityEvent(c, 'rate_limiter_unavailable_fail_closed', {
        routeClass: routeLimit.routeClass,
        error: error instanceof Error ? error.message : String(error),
      });
      return rateLimitUnavailableResponse(c, routeLimit.routeClass);
    }

    logSecurityEvent(c, 'rate_limiter_unavailable_fail_open', {
      routeClass: routeLimit.routeClass,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await next();
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
  if (!c.env.RATE_LIMITER) {
    throw internalError(
      'RATE_LIMITER must be configured for admin nonce replay protection outside local development'
    );
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

  await rememberAdminNonce(c, keyId, nonce);
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

async function rememberAdminNonce(c: AppContext, keyId: string, nonce: string): Promise<void> {
  const id = c.env.RATE_LIMITER.idFromName(`admin-nonce:${keyId}`);
  const url = new URL('https://rate-limit/nonce');
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('ttlMs', String(ADMIN_NONCE_TTL_MS));

  const response = await fetchWithTimeout(
    () => c.env.RATE_LIMITER.get(id).fetch(url.toString(), { method: 'POST' }),
    RATE_LIMITER_TIMEOUT_MS
  );

  if (response.status === 409) {
    logSecurityEvent(c, 'admin_auth_failed', { reason: 'nonce_replay' });
    throw unauthorized('Admin request nonce has already been used');
  }
  if (!response.ok) {
    throw internalError('Admin nonce replay protection is unavailable');
  }
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
  c.env.API_ANALYTICS?.writeDataPoint({
    blobs: [event, c.req.method, c.req.path, requestId],
    doubles: [Date.now()],
    indexes: [event],
  });

  console.warn(
    JSON.stringify({
      level: event.includes('failed') || event.includes('unavailable') ? 'warn' : 'info',
      module: 'security',
      event,
      requestId,
      path: c.req.path,
      ...details,
    })
  );
}

function rateLimitUnavailableResponse(c: AppContext, routeClass: string): Response {
  c.header('Retry-After', '1');
  c.header('X-RateLimit-Remaining', '0');
  return c.json(
    {
      ...errorResponse('Rate limiter unavailable', ErrorCode.EXCHANGE_RATE_LIMIT),
      meta: {
        requestId: c.res.headers.get('X-Request-ID') ?? undefined,
        rateLimit: { retryAfterMs: 1000, routeClass, unavailable: true },
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
  if (
    path.includes('/custom-index') ||
    path.includes('/superema/') ||
    (path.includes('/screener/') && path.endsWith('/ohlcv')) ||
    path.includes('/ohlcv/multi/') ||
    path.includes('/orderbook/')
  ) {
    return { routeClass: 'expensive', capacity: 20, refillPerSecond: 0.5 };
  }

  if (path.includes('/admin/')) {
    return { routeClass: 'admin', capacity: 10, refillPerSecond: 0.25 };
  }

  return { routeClass: 'public', capacity: 120, refillPerSecond: 4 };
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

async function fetchWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`operation timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
