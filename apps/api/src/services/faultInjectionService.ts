import { ApiError, ErrorCode } from '../errors';
import type { Env } from '../types';

export type FaultTarget = 'provider' | 'd1' | 'r2' | 'queue' | 'delivery';
const TARGETS = new Set<FaultTarget>(['provider', 'd1', 'r2', 'queue', 'delivery']);

export interface FaultInjectionRecord {
  target: FaultTarget;
  enabled: boolean;
  expiresAt: number | null;
  config: Record<string, unknown>;
  changeId: string;
  updatedBy: string;
}

export async function getActiveFaultInjection(
  env: Env,
  target: FaultTarget
): Promise<FaultInjectionRecord | null> {
  if (env.ENVIRONMENT !== 'staging') return null;
  const row = await env.DB.prepare(
    `SELECT target, enabled, expires_at, config_json, change_id, updated_by
     FROM staging_fault_injections WHERE target = ?`
  )
    .bind(target)
    .first<{
      target: FaultTarget;
      enabled: number;
      expires_at: number | null;
      config_json: string;
      change_id: string;
      updated_by: string;
    }>();
  if (row?.enabled !== 1 || row.expires_at === null || row.expires_at <= Date.now() / 1_000) {
    return null;
  }
  return {
    target: row.target,
    enabled: true,
    expiresAt: row.expires_at * 1_000,
    config: safeJson(row.config_json),
    changeId: row.change_id,
    updatedBy: row.updated_by,
  };
}

export function requireFaultTarget(value: unknown): FaultTarget {
  if (typeof value !== 'string' || !TARGETS.has(value as FaultTarget)) {
    throw new ApiError(ErrorCode.VALIDATION_INVALID_PARAMETER, 'Invalid fault target', 400);
  }
  return value as FaultTarget;
}

export async function setFaultInjection(
  env: Env,
  input: {
    target: FaultTarget;
    enabled: boolean;
    durationSeconds: number;
    changeId: string;
    actor: string;
    config?: Record<string, unknown>;
  }
): Promise<FaultInjectionRecord> {
  assertStaging(env);
  if (!/^[-A-Za-z0-9_.:]{3,120}$/.test(input.changeId)) {
    throw new ApiError(ErrorCode.VALIDATION_INVALID_PARAMETER, 'A valid changeId is required', 400);
  }
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < 5 ||
    input.durationSeconds > 900
  ) {
    throw new ApiError(
      ErrorCode.VALIDATION_INVALID_PARAMETER,
      'durationSeconds must be 5-900',
      400
    );
  }
  const expiresAt = input.enabled ? Math.floor(Date.now() / 1_000) + input.durationSeconds : null;
  const config = input.config ?? {};
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO staging_fault_injections
        (target, enabled, expires_at, config_json, change_id, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(target) DO UPDATE SET
         enabled = excluded.enabled,
         expires_at = excluded.expires_at,
         config_json = excluded.config_json,
         change_id = excluded.change_id,
         updated_by = excluded.updated_by,
         updated_at = unixepoch()`
    ).bind(
      input.target,
      input.enabled ? 1 : 0,
      expiresAt,
      JSON.stringify(config),
      input.changeId,
      input.actor
    ),
    env.DB.prepare(
      `INSERT INTO staging_fault_injection_audit
        (id, target, action, change_id, actor, config_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())`
    ).bind(
      `fault_${crypto.randomUUID()}`,
      input.target,
      input.enabled ? 'enable' : 'disable',
      input.changeId,
      input.actor,
      JSON.stringify(config)
    ),
  ]);
  return {
    target: input.target,
    enabled: input.enabled,
    expiresAt: expiresAt ? expiresAt * 1_000 : null,
    config,
    changeId: input.changeId,
    updatedBy: input.actor,
  };
}

export async function listFaultInjections(env: Env): Promise<FaultInjectionRecord[]> {
  assertStaging(env);
  const result = await env.DB.prepare(
    `SELECT target, enabled, expires_at, config_json, change_id, updated_by
     FROM staging_fault_injections ORDER BY target`
  ).all<{
    target: FaultTarget;
    enabled: number;
    expires_at: number | null;
    config_json: string;
    change_id: string;
    updated_by: string;
  }>();
  return result.results.map((row) => ({
    target: row.target,
    enabled: row.enabled === 1 && row.expires_at !== null && row.expires_at > Date.now() / 1_000,
    expiresAt: row.expires_at ? row.expires_at * 1_000 : null,
    config: safeJson(row.config_json),
    changeId: row.change_id,
    updatedBy: row.updated_by,
  }));
}

export async function assertFaultNotInjected(env: Env, target: FaultTarget): Promise<void> {
  const fault = await getActiveFaultInjection(env, target);
  if (fault) {
    throw new ApiError(ErrorCode.INTERNAL_SERVICE_ERROR, `Staging ${target} fault injected`, 503, {
      faultInjected: true,
      target,
      changeId: fault.changeId,
    });
  }
}

function assertStaging(env: Env): void {
  if (env.ENVIRONMENT === 'production') {
    throw new ApiError(ErrorCode.NOT_FOUND_ROUTE, 'Route not found', 404);
  }
  if (env.ENVIRONMENT !== 'staging' && env.ENVIRONMENT !== 'local') {
    throw new ApiError(
      ErrorCode.INTERNAL_CONFIGURATION_ERROR,
      'Fault injection requires staging',
      503
    );
  }
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
