import { ErrorCode } from '../errors';
import {
  evaluateReleaseControl,
  getReleaseControl,
  type ReleaseControlFlag,
  type ReleaseControlRecord,
  type ReleaseResource,
  type ReleaseSubject,
} from '../services/releaseControlService';
import { readUserFromSession } from '../services/growthRetentionService';
import type { Env } from '../types';
import { errorResponse, type ApiErrorResponse } from './response';

export type FeatureFlag =
  | 'ACCOUNT_FEATURES_ENABLED'
  | 'ALERT_EVALUATION_ENABLED'
  | 'ADMIN_ROUTES_ENABLED';

export function featureEnabled(env: Env, flag: FeatureFlag): boolean {
  return env[flag] === 'true' || (env[flag] === undefined && env.ENVIRONMENT === 'local');
}

export interface ReleaseControlContext {
  authorization?: string | null;
  signedAnonymousSubject?: string | null;
  subject?: ReleaseSubject | null;
  resource?: ReleaseResource | null;
}

const RELEASE_CONTROL_CACHE_TTL_MS = 1_000;
const releaseControlCaches = new WeakMap<
  object,
  Map<ReleaseControlFlag, { expiresAt: number; value: ReleaseControlRecord | null }>
>();

/**
 * Evaluates the D1 source of truth, falling back to the legacy environment
 * boolean only when a control has not been created yet or D1 is unavailable.
 */
export async function releaseControlEnabled(
  env: Env,
  flag: ReleaseControlFlag,
  context: ReleaseControlContext = {}
): Promise<boolean> {
  if (!env.DB) return legacyReleaseControlFallback(env, flag);
  try {
    const control = await getCachedReleaseControl(env, flag);
    if (!control) return legacyReleaseControlFallback(env, flag);
    const subject = await resolveReleaseSubject(env, context);
    return evaluateReleaseControl(control, { subject, resource: context.resource });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'release-control',
        msg: 'D1 release control unavailable; using legacy fallback',
        flag,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return legacyReleaseControlFallback(env, flag);
  }
}

export function invalidateReleaseControlCache(env: Env, flag: ReleaseControlFlag): void {
  if (env.DB && typeof env.DB === 'object') releaseControlCaches.get(env.DB)?.delete(flag);
}

async function getCachedReleaseControl(
  env: Env,
  flag: ReleaseControlFlag
): Promise<ReleaseControlRecord | null> {
  const cacheKey = env.DB as unknown as object;
  let cache = releaseControlCaches.get(cacheKey);
  if (!cache) {
    cache = new Map();
    releaseControlCaches.set(cacheKey, cache);
  }
  const cached = cache.get(flag);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await getReleaseControl(env, flag);
  cache.set(flag, { expiresAt: Date.now() + RELEASE_CONTROL_CACHE_TTL_MS, value });
  return value;
}

export async function resolveReleaseSubject(
  env: Env,
  context: ReleaseControlContext
): Promise<ReleaseSubject | null> {
  if (context.subject) return context.subject;

  const authorization = context.authorization?.trim() ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (bearer?.startsWith('lz_live_')) {
    return { kind: 'api_key', id: bearer.slice(0, 18).toLowerCase() };
  }
  if (bearer) {
    try {
      const user = await readUserFromSession(env, authorization);
      return { kind: 'user', id: user.id.toLowerCase() };
    } catch {
      // An invalid session does not receive a rollout identity.
    }
  }

  const anonymous = await verifySignedAnonymousSubject(env, context.signedAnonymousSubject);
  return anonymous ? { kind: 'anonymous', id: anonymous.toLowerCase() } : null;
}

export function legacyReleaseControlFallback(env: Env, flag: ReleaseControlFlag): boolean {
  switch (flag) {
    case 'realtime':
      return env.ENVIRONMENT === 'local' || env.ENVIRONMENT === undefined;
    case 'accounts':
    case 'delivery_channels':
    case 'async_backtests':
      return featureEnabled(env, 'ACCOUNT_FEATURES_ENABLED');
    case 'alerts':
    case 'cron_reconciliation':
      return featureEnabled(env, 'ALERT_EVALUATION_ENABLED');
    case 'admin_operations':
      return featureEnabled(env, 'ADMIN_ROUTES_ENABLED');
  }
}

async function verifySignedAnonymousSubject(
  env: Env,
  value: string | null | undefined
): Promise<string | null> {
  if (!value) return null;
  const split = value.lastIndexOf('.');
  if (split <= 0) return null;
  const subject = value.slice(0, split);
  const signature = value.slice(split + 1);
  if (!/^[a-f0-9]{64}$/i.test(subject) || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  const secret = env.METRICS_INGEST_SECRET ?? env.REALTIME_TOKEN_SECRET;
  if (!secret) return null;
  const expected = await hmacSha256Hex(secret, subject);
  return constantTimeTextEqual(expected, signature) ? subject : null;
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
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function featureDisabledEnvelope(message: string): ApiErrorResponse {
  return errorResponse(message, ErrorCode.FEATURE_DISABLED);
}
