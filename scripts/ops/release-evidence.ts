export type EvidenceEnvironment = 'staging' | 'production';

export interface ReleaseEvidence {
  schemaVersion: 1;
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
}

export interface EvidenceResult {
  passed: boolean;
  report: string;
}

const REQUIRED_DASHBOARDS = ['realtime', 'alerts', 'storage-jobs', 'product', 'release'];
const REQUIRED_MIGRATIONS = ['0007', '0008', '0009', '0010', '0011'];
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

export function validateReleaseEvidence(value: unknown, requireProduction = false): string[] {
  const errors: string[] = [];
  if (!record(value)) return ['evidence must be an object'];
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof value.releaseId !== 'string' || !value.releaseId) errors.push('releaseId is required');
  if (value.environment !== 'staging' && value.environment !== 'production')
    errors.push('environment is invalid');
  if (requireProduction && value.environment !== 'production')
    errors.push('production evidence is required');
  if (typeof value.commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(value.commitSha))
    errors.push('commitSha must be a full SHA');
  if (typeof value.owner !== 'string' || !value.owner) errors.push('owner is required');
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
    errors.push('migrations 0007-0011 are required');
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
  if (!record(value.drills)) errors.push('drill results are required');
  else
    for (const name of REQUIRED_DRILLS)
      if (!passedResult(value.drills[name])) errors.push(`${name} drill must pass`);
  if (requireProduction) {
    const rollout = Array.isArray(value.rollout) ? value.rollout : [];
    for (const cohort of ['internal', '5', '25', '100'])
      if (!rollout.some((item) => record(item) && item.cohort === cohort && item.passed === true))
        errors.push(`${cohort} rollout evidence is required`);
  }
  return errors;
}

function passedResult(value: unknown): boolean {
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
