export type EvidenceEnvironment = 'staging' | 'production';
export type StrategyItemId =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'B1'
  | 'B2'
  | 'B3'
  | 'B4'
  | 'B5'
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'E1'
  | 'E2'
  | 'E3'
  | 'E4'
  | 'E5';

export interface EvidenceReference {
  ref: string;
  description: string;
}

export interface StrategyItemEvidence {
  implementation: EvidenceReference[];
  test: EvidenceReference[];
  deployment: EvidenceReference[];
  dashboard: EvidenceReference[];
  drill: EvidenceReference[];
  rollback: EvidenceReference[];
  production: EvidenceReference[];
}

export interface ReleaseEvidence {
  schemaVersion: 2;
  releaseId: string;
  environment: EvidenceEnvironment;
  commitSha: string;
  generatedAt: string;
  owner: string;
  changeId: string | null;
  deployments: Record<'api' | 'web' | 'ingest', string>;
  migrations: string[];
  dashboards: Array<{ name: string; url: string; owner: string; alerts: string[] }>;
  acceptance: Record<'browser' | 'load' | 'reconnect' | 'soak' | 'security', EvidenceResult>;
  drills: Record<string, EvidenceResult>;
  rollout: Array<{
    cohort: 'internal' | '5' | '25' | '100';
    startedAt: string;
    endedAt: string;
    passed: boolean;
  }>;
  items: Record<StrategyItemId, StrategyItemEvidence>;
  rejectedBaselines: EvidenceResult[];
}

export interface EvidenceResult {
  passed: boolean;
  report: string;
  startedAt?: string;
  endedAt?: string;
}

const REQUIRED_DASHBOARDS = ['realtime', 'alerts', 'storage-jobs', 'product', 'release'];
const REQUIRED_MIGRATIONS = ['0007', '0008', '0009', '0010', '0011', '0012'];
const REQUIRED_DRILLS = [
  'provider-disconnect',
  'deployment-restart',
  'd1-outage',
  'r2-outage',
  'queue-dlq',
  'secret-rotation',
  'migration-rehearsal',
  'feature-rollback',
];
const STRATEGY_ITEM_IDS: StrategyItemId[] = [
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'C1',
  'C2',
  'C3',
  'C4',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
];
const ITEM_EVIDENCE_KINDS = [
  'implementation',
  'test',
  'deployment',
  'dashboard',
  'drill',
  'rollback',
  'production',
] as const;
const HOUR_MS = 60 * 60 * 1_000;

export function validateReleaseEvidence(value: unknown, requireProduction = false): string[] {
  const errors: string[] = [];
  if (!record(value)) return ['evidence must be an object'];
  if (value.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (typeof value.releaseId !== 'string' || !value.releaseId) errors.push('releaseId is required');
  if (value.environment !== 'staging' && value.environment !== 'production')
    errors.push('environment is invalid');
  if (requireProduction && value.environment !== 'production')
    errors.push('production evidence is required');
  if (typeof value.commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(value.commitSha))
    errors.push('commitSha must be a full SHA');
  if (typeof value.owner !== 'string' || !value.owner) errors.push('owner is required');
  if (requireProduction && (typeof value.changeId !== 'string' || value.changeId.length < 3))
    errors.push('production changeId is required');
  if (!record(value.deployments)) errors.push('deployments are required');
  else
    for (const name of ['api', 'web', 'ingest'])
      if (typeof value.deployments[name] !== 'string' || !value.deployments[name])
        errors.push(`${name} deployment is required`);
  if (
    !Array.isArray(value.migrations) ||
    !REQUIRED_MIGRATIONS.every((id) =>
      value.migrations.some((item) => typeof item === 'string' && item.startsWith(id))
    )
  )
    errors.push('migrations 0007-0012 are required');
  const dashboards = Array.isArray(value.dashboards) ? value.dashboards : [];
  for (const required of REQUIRED_DASHBOARDS) {
    const dashboard = dashboards.find((item) => record(item) && item.name === required);
    if (
      !record(dashboard) ||
      typeof dashboard.url !== 'string' ||
      !dashboard.url.startsWith('https://') ||
      !Array.isArray(dashboard.alerts) ||
      dashboard.alerts.length === 0
    )
      errors.push(`${required} dashboard with alerts is required`);
  }
  if (!record(value.acceptance)) errors.push('acceptance results are required');
  else
    for (const name of ['browser', 'load', 'reconnect', 'soak', 'security'])
      if (!passedResult(value.acceptance[name])) errors.push(`${name} acceptance must pass`);
  if (record(value.acceptance) && passedResult(value.acceptance.soak)) {
    const duration = evidenceDuration(value.acceptance.soak);
    if (duration === null || duration < 72 * HOUR_MS)
      errors.push('soak acceptance must cover at least 72 continuous hours');
  }
  if (!record(value.drills)) errors.push('drill results are required');
  else
    for (const name of REQUIRED_DRILLS)
      if (!passedResult(value.drills[name])) errors.push(`${name} drill must pass`);
  if (requireProduction) {
    const rollout = Array.isArray(value.rollout) ? value.rollout : [];
    for (const cohort of ['internal', '5', '25', '100']) {
      const result = rollout.find(
        (item) => record(item) && item.cohort === cohort && item.passed === true
      );
      if (!record(result)) {
        errors.push(`${cohort} rollout evidence is required`);
        continue;
      }
      const duration = evidenceDuration(result);
      const minimum = cohort === 'internal' ? 4 * HOUR_MS : 24 * HOUR_MS;
      if (duration === null || duration < minimum)
        errors.push(`${cohort} rollout duration is below the required minimum`);
    }
  }
  validateItemEvidence(value.items, requireProduction, errors);
  if (!Array.isArray(value.rejectedBaselines)) errors.push('rejectedBaselines must be an array');
  else if (value.rejectedBaselines.some((item) => !record(item) || item.passed !== false))
    errors.push('rejectedBaselines may contain only explicitly failed results');
  return errors;
}

function validateItemEvidence(value: unknown, requireProduction: boolean, errors: string[]): void {
  if (!record(value)) {
    errors.push('A0-E5 item evidence map is required');
    return;
  }
  const seen = new Map<string, StrategyItemId>();
  for (const id of STRATEGY_ITEM_IDS) {
    const item = value[id];
    if (!record(item)) {
      errors.push(`${id} item evidence is required`);
      continue;
    }
    for (const kind of ITEM_EVIDENCE_KINDS) {
      const references = item[kind];
      const required = kind !== 'production' || requireProduction;
      if (!Array.isArray(references) || (required && references.length === 0)) {
        if (required) errors.push(`${id}.${kind} evidence is required`);
        continue;
      }
      for (const reference of references) {
        if (
          !record(reference) ||
          typeof reference.ref !== 'string' ||
          reference.ref.length === 0 ||
          typeof reference.description !== 'string' ||
          !reference.description.includes(id)
        ) {
          errors.push(`${id}.${kind} evidence must include a ref and an item-specific description`);
          continue;
        }
        const fingerprint = `${kind}\u0000${reference.ref}\u0000${reference.description}`;
        const previous = seen.get(fingerprint);
        if (previous && previous !== id)
          errors.push(`${id}.${kind} reuses placeholder evidence from ${previous}`);
        else seen.set(fingerprint, id);
      }
    }
  }
  for (const id of Object.keys(value)) {
    if (!STRATEGY_ITEM_IDS.includes(id as StrategyItemId))
      errors.push(`unknown item evidence ${id}`);
  }
}

function evidenceDuration(value: Record<string, unknown>): number | null {
  if (typeof value.startedAt !== 'string' || typeof value.endedAt !== 'string') return null;
  const startedAt = Date.parse(value.startedAt);
  const endedAt = Date.parse(value.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return endedAt - startedAt;
}

function passedResult(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    value.passed === true &&
    typeof value.report === 'string' &&
    value.report.length > 0
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
