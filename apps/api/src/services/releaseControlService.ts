import type { Env } from '../types';

export const RELEASE_CONTROL_FLAGS = [
  'realtime',
  'accounts',
  'alerts',
  'delivery_channels',
  'cron_reconciliation',
  'async_backtests',
  'admin_operations',
] as const;

export const RELEASE_CONTROL_STATES = ['off', 'internal', '5', '25', '100'] as const;

export type ReleaseControlFlag = (typeof RELEASE_CONTROL_FLAGS)[number];
export type ReleaseControlState = (typeof RELEASE_CONTROL_STATES)[number];
export type ReleaseSubjectKind = 'user' | 'api_key' | 'anonymous' | 'internal';

export interface ReleaseSubject {
  kind: ReleaseSubjectKind;
  id: string;
}

export interface ReleaseResource {
  provider?: string;
  topic?: string;
}

export interface ReleaseControlRecord {
  flag: ReleaseControlFlag;
  state: ReleaseControlState;
  subjectAllowlist: string[];
  providerAllowlist: string[];
  topicAllowlist: string[];
  revision: number;
  updatedBy: string;
  updateReason: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReleaseControlAuditRecord {
  id: string;
  flag: ReleaseControlFlag;
  previousState: ReleaseControlState | null;
  nextState: ReleaseControlState;
  previousRevision: number | null;
  nextRevision: number;
  previousConfig: Record<string, unknown> | null;
  nextConfig: Record<string, unknown>;
  actor: string;
  reason: string;
  requestId: string | null;
  createdAt: number;
}

export interface UpdateReleaseControlInput {
  flag: ReleaseControlFlag;
  state: ReleaseControlState;
  subjectAllowlist?: string[];
  providerAllowlist?: string[];
  topicAllowlist?: string[];
  expectedRevision: number;
  actor: string;
  reason: string;
  requestId?: string | null;
}

interface ReleaseControlRow {
  flag: string;
  state: string;
  subject_allowlist_json: string;
  provider_allowlist_json: string;
  topic_allowlist_json: string;
  revision: number;
  updated_by: string;
  update_reason: string;
  created_at: number;
  updated_at: number;
}

interface ReleaseControlAuditRow {
  id: string;
  flag: string;
  previous_state: string | null;
  next_state: string;
  previous_revision: number | null;
  next_revision: number;
  previous_config_json: string | null;
  next_config_json: string;
  actor: string;
  reason: string;
  request_id: string | null;
  created_at: number;
}

export class ReleaseControlConflictError extends Error {
  constructor(
    readonly flag: ReleaseControlFlag,
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Release control '${flag}' revision conflict: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = 'ReleaseControlConflictError';
  }
}

export function isReleaseControlFlag(value: unknown): value is ReleaseControlFlag {
  return typeof value === 'string' && RELEASE_CONTROL_FLAGS.includes(value as ReleaseControlFlag);
}

export function isReleaseControlState(value: unknown): value is ReleaseControlState {
  return typeof value === 'string' && RELEASE_CONTROL_STATES.includes(value as ReleaseControlState);
}

export function canonicalReleaseSubject(subject: ReleaseSubject): string {
  return `${subject.kind}:${subject.id.trim().toLowerCase()}`;
}

export async function cohortBucket(identity: string): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  );
  return (((digest[0] ?? 0) << 8) | (digest[1] ?? 0)) % 100;
}

export async function evaluateReleaseControl(
  control: ReleaseControlRecord,
  input: { subject?: ReleaseSubject | null; resource?: ReleaseResource | null } = {}
): Promise<boolean> {
  if (control.state === 'off') return false;
  if (control.state === '100') return true;

  const subjectKey = input.subject ? canonicalReleaseSubject(input.subject) : null;
  if (input.subject?.kind === 'internal') return true;
  if (subjectKey && control.subjectAllowlist.includes(subjectKey)) return true;

  const resourceKey = releaseResourceKey(input.resource);
  const resourceIsInternal = resourceMatchesAllowlist(control, input.resource);
  if (control.state === 'internal') return resourceIsInternal;

  const identity = subjectKey ?? resourceKey;
  if (!identity) return false;
  return (await cohortBucket(`${control.flag}:${identity}`)) < Number(control.state);
}

export async function getReleaseControl(
  env: Pick<Env, 'DB'>,
  flag: ReleaseControlFlag
): Promise<ReleaseControlRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM release_controls WHERE flag = ?`)
    .bind(flag)
    .first<ReleaseControlRow>();
  return row ? mapReleaseControl(row) : null;
}

export async function listReleaseControls(env: Pick<Env, 'DB'>): Promise<ReleaseControlRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM release_controls ORDER BY flag ASC`
  ).all<ReleaseControlRow>();
  return rows.results.map(mapReleaseControl);
}

export async function listReleaseControlAudit(
  env: Pick<Env, 'DB'>,
  options: { flag?: ReleaseControlFlag; limit?: number } = {}
): Promise<ReleaseControlAuditRecord[]> {
  const limit = Math.max(1, Math.min(250, options.limit ?? 100));
  const statement = options.flag
    ? env.DB.prepare(
        `SELECT * FROM release_control_audit WHERE flag = ? ORDER BY created_at DESC, next_revision DESC LIMIT ?`
      ).bind(options.flag, limit)
    : env.DB.prepare(
        `SELECT * FROM release_control_audit ORDER BY created_at DESC, next_revision DESC LIMIT ?`
      ).bind(limit);
  const rows = await statement.all<ReleaseControlAuditRow>();
  return rows.results.map(mapAudit);
}

export async function updateReleaseControl(
  env: Pick<Env, 'DB'>,
  input: UpdateReleaseControlInput
): Promise<ReleaseControlRecord> {
  const current = await getReleaseControl(env, input.flag);
  const actualRevision = current?.revision ?? 0;
  if (input.expectedRevision !== actualRevision) {
    throw new ReleaseControlConflictError(input.flag, input.expectedRevision, actualRevision);
  }

  const subjectAllowlist = normalizeAllowlist(input.subjectAllowlist ?? current?.subjectAllowlist);
  const providerAllowlist = normalizeAllowlist(
    input.providerAllowlist ?? current?.providerAllowlist
  );
  const topicAllowlist = normalizeAllowlist(input.topicAllowlist ?? current?.topicAllowlist);
  const actor = requiredText(input.actor, 'actor', 200);
  const reason = requiredText(input.reason, 'reason', 500);

  if (!current) {
    try {
      await env.DB.prepare(
        `INSERT INTO release_controls (
           flag, state, subject_allowlist_json, provider_allowlist_json, topic_allowlist_json,
           revision, updated_by, update_reason, last_request_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, unixepoch(), unixepoch())`
      )
        .bind(
          input.flag,
          input.state,
          JSON.stringify(subjectAllowlist),
          JSON.stringify(providerAllowlist),
          JSON.stringify(topicAllowlist),
          actor,
          reason,
          input.requestId ?? null
        )
        .run();
    } catch (error) {
      const latest = await getReleaseControl(env, input.flag);
      if (latest) throw new ReleaseControlConflictError(input.flag, 0, latest.revision);
      throw error;
    }
  } else {
    const result = await env.DB.prepare(
      `UPDATE release_controls
       SET state = ?, subject_allowlist_json = ?, provider_allowlist_json = ?,
           topic_allowlist_json = ?, revision = revision + 1, updated_by = ?,
           update_reason = ?, last_request_id = ?, updated_at = unixepoch()
       WHERE flag = ? AND revision = ?`
    )
      .bind(
        input.state,
        JSON.stringify(subjectAllowlist),
        JSON.stringify(providerAllowlist),
        JSON.stringify(topicAllowlist),
        actor,
        reason,
        input.requestId ?? null,
        input.flag,
        input.expectedRevision
      )
      .run();
    // D1 may include rows written by the immutable audit trigger in `changes`.
    // Zero means the optimistic-lock update lost; any positive value means the
    // release-control row changed and its audit event committed atomically.
    if ((result.meta.changes ?? 0) < 1) {
      const latest = await getReleaseControl(env, input.flag);
      throw new ReleaseControlConflictError(
        input.flag,
        input.expectedRevision,
        latest?.revision ?? 0
      );
    }
  }

  const updated = await getReleaseControl(env, input.flag);
  if (!updated) throw new Error(`Release control '${input.flag}' was not persisted`);
  return updated;
}

function resourceMatchesAllowlist(
  control: ReleaseControlRecord,
  resource: ReleaseResource | null | undefined
): boolean {
  if (!resource) return false;
  const provider = resource.provider?.trim().toLowerCase();
  const topic = resource.topic?.trim().toLowerCase();
  return Boolean(
    (provider && control.providerAllowlist.includes(provider)) ||
    (topic && control.topicAllowlist.includes(topic))
  );
}

function releaseResourceKey(resource: ReleaseResource | null | undefined): string | null {
  if (!resource) return null;
  const provider = resource.provider?.trim().toLowerCase() ?? '';
  const topic = resource.topic?.trim().toLowerCase() ?? '';
  return provider || topic ? `resource:${provider}:${topic}` : null;
}

function normalizeAllowlist(values: string[] | undefined): string[] {
  if (!values) return [];
  if (values.length > 500) throw new Error('Release control allowlists are limited to 500 entries');
  return [
    ...new Set(values.map((value) => requiredText(value, 'allowlist entry', 300).toLowerCase())),
  ].sort();
}

function requiredText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${field} must be between 1 and ${maximum} characters`);
  }
  return normalized;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapReleaseControl(row: ReleaseControlRow): ReleaseControlRecord {
  if (!isReleaseControlFlag(row.flag) || !isReleaseControlState(row.state)) {
    throw new Error('D1 returned an invalid release control row');
  }
  return {
    flag: row.flag,
    state: row.state,
    subjectAllowlist: parseJsonArray(row.subject_allowlist_json),
    providerAllowlist: parseJsonArray(row.provider_allowlist_json),
    topicAllowlist: parseJsonArray(row.topic_allowlist_json),
    revision: row.revision,
    updatedBy: row.updated_by,
    updateReason: row.update_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: ReleaseControlAuditRow): ReleaseControlAuditRecord {
  if (!isReleaseControlFlag(row.flag) || !isReleaseControlState(row.next_state)) {
    throw new Error('D1 returned an invalid release control audit row');
  }
  const previousState = row.previous_state;
  if (previousState !== null && !isReleaseControlState(previousState)) {
    throw new Error('D1 returned an invalid previous release control state');
  }
  return {
    id: row.id,
    flag: row.flag,
    previousState,
    nextState: row.next_state,
    previousRevision: row.previous_revision,
    nextRevision: row.next_revision,
    previousConfig: parseJsonObject(row.previous_config_json),
    nextConfig: parseJsonObject(row.next_config_json) ?? {},
    actor: row.actor,
    reason: row.reason,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}
