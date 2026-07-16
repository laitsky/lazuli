import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { validateReleaseEvidence } from './ops/release-evidence';

export const EXPECTED_IDS = [
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
] as const;

export const REQUIRED_CONDITIONS = [
  'endToEndFlow',
  'automatedVerification',
  'productionEnablement',
  'sloObservability',
  'recoveryRollback',
  'strategyEvidence',
] as const;

const REQUIRED_EVIDENCE_KINDS = ['implementation', 'test', 'production'] as const;
const VALID_STATUSES = new Set(['planned', 'in_progress', 'partial', 'blocked', 'complete']);
const VALID_CONDITION_STATES = new Set(['pending', 'verified']);
const VALID_EVIDENCE_KINDS = new Set([
  ...REQUIRED_EVIDENCE_KINDS,
  'observability',
  'runbook',
  'documentation',
]);

type UnknownRecord = Record<string, unknown>;

export interface ValidationResult {
  errors: string[];
  summary: Record<string, number>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateEvidenceRef(ref: string, repositoryRoot: string): string | null {
  if (/^https:\/\//.test(ref)) {
    return null;
  }

  if (isAbsolute(ref)) {
    return 'must be a repository-relative path or an HTTPS URL';
  }

  const pathWithoutFragment = ref.split('#', 1)[0];
  if (!pathWithoutFragment) {
    return 'must include a file path before any anchor';
  }

  const absolutePath = resolve(repositoryRoot, pathWithoutFragment);
  const repositoryPrefix = repositoryRoot.endsWith(sep)
    ? repositoryRoot
    : `${repositoryRoot}${sep}`;
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(repositoryPrefix)) {
    return 'must not escape the repository root';
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return `references missing file ${pathWithoutFragment}`;
  }

  return null;
}

export function validateLedger(ledger: unknown, repositoryRoot: string): ValidationResult {
  const errors: string[] = [];
  const summary: Record<string, number> = {
    planned: 0,
    in_progress: 0,
    partial: 0,
    blocked: 0,
    complete: 0,
  };

  if (!isRecord(ledger)) {
    return { errors: ['ledger root must be an object'], summary };
  }

  if (ledger.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }
  if (ledger.strategy !== 'PRODUCT-STRATEGY.md') {
    errors.push('strategy must reference PRODUCT-STRATEGY.md');
  }
  if (typeof ledger.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.updatedAt)) {
    errors.push('updatedAt must use YYYY-MM-DD');
  }
  if (!isRecord(ledger.releaseStatus)) {
    errors.push('releaseStatus must be an object');
  } else {
    if (ledger.releaseStatus.channel !== 'beta') {
      errors.push('releaseStatus.channel must be beta');
    }
    if (ledger.releaseStatus.version !== '0.1.0-beta.0') {
      errors.push('releaseStatus.version must be 0.1.0-beta.0');
    }
    if (
      typeof ledger.releaseStatus.declaredAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ledger.releaseStatus.declaredAt)
    ) {
      errors.push('releaseStatus.declaredAt must use YYYY-MM-DD');
    }
    if (ledger.releaseStatus.qualification !== 'repository-verified') {
      errors.push('releaseStatus.qualification must be repository-verified');
    }
    if (ledger.releaseStatus.productionAuthorized !== false) {
      errors.push('releaseStatus.productionAuthorized must remain false for this beta');
    }
  }
  if (!Array.isArray(ledger.items)) {
    return { errors: [...errors, 'items must be an array'], summary };
  }

  const itemsById = new Map<string, UnknownRecord>();
  for (const [index, rawItem] of ledger.items.entries()) {
    if (!isRecord(rawItem)) {
      errors.push(`items[${index}] must be an object`);
      continue;
    }
    if (typeof rawItem.id !== 'string') {
      errors.push(`items[${index}].id must be a string`);
      continue;
    }
    if (itemsById.has(rawItem.id)) {
      errors.push(`duplicate strategy item ${rawItem.id}`);
      continue;
    }
    itemsById.set(rawItem.id, rawItem);
  }

  const expectedIds = new Set<string>(EXPECTED_IDS);
  for (const id of EXPECTED_IDS) {
    if (!itemsById.has(id)) {
      errors.push(`missing strategy item ${id}`);
    }
  }
  for (const id of itemsById.keys()) {
    if (!expectedIds.has(id)) {
      errors.push(`unknown strategy item ${id}`);
    }
  }

  for (const id of EXPECTED_IDS) {
    const item = itemsById.get(id);
    if (!item) continue;

    if (typeof item.title !== 'string' || item.title.trim().length === 0) {
      errors.push(`${id}.title must be a non-empty string`);
    }
    if (typeof item.status !== 'string' || !VALID_STATUSES.has(item.status)) {
      errors.push(`${id}.status is invalid`);
      continue;
    }
    summary[item.status] = (summary[item.status] ?? 0) + 1;

    if (!isRecord(item.conditions)) {
      errors.push(`${id}.conditions must be an object`);
      continue;
    }

    const evidenceKinds = new Set<string>();
    const productionManifestRefs = new Set<string>();
    for (const conditionName of REQUIRED_CONDITIONS) {
      const condition = item.conditions[conditionName];
      if (!isRecord(condition)) {
        errors.push(`${id}.${conditionName} is required`);
        continue;
      }
      if (typeof condition.state !== 'string' || !VALID_CONDITION_STATES.has(condition.state)) {
        errors.push(`${id}.${conditionName}.state must be pending or verified`);
      }
      if (!Array.isArray(condition.evidence)) {
        errors.push(`${id}.${conditionName}.evidence must be an array`);
        continue;
      }

      for (const [evidenceIndex, rawEvidence] of condition.evidence.entries()) {
        const prefix = `${id}.${conditionName}.evidence[${evidenceIndex}]`;
        if (!isRecord(rawEvidence)) {
          errors.push(`${prefix} must be an object`);
          continue;
        }
        if (typeof rawEvidence.kind !== 'string' || !VALID_EVIDENCE_KINDS.has(rawEvidence.kind)) {
          errors.push(`${prefix}.kind is invalid`);
        } else {
          evidenceKinds.add(rawEvidence.kind);
          if (
            rawEvidence.kind === 'production' &&
            typeof rawEvidence.ref === 'string' &&
            rawEvidence.ref.startsWith('docs/operations/evidence/') &&
            rawEvidence.ref.split('#', 1)[0]?.endsWith('.json')
          ) {
            productionManifestRefs.add(rawEvidence.ref.split('#', 1)[0]!);
          }
        }
        if (
          typeof rawEvidence.description !== 'string' ||
          rawEvidence.description.trim().length === 0
        ) {
          errors.push(`${prefix}.description must be a non-empty string`);
        }
        if (typeof rawEvidence.ref !== 'string' || rawEvidence.ref.trim().length === 0) {
          errors.push(`${prefix}.ref must be a non-empty string`);
        } else {
          const refError = validateEvidenceRef(rawEvidence.ref, repositoryRoot);
          if (refError) errors.push(`${prefix}.ref ${refError}`);
        }
      }

      if (item.status === 'complete') {
        if (condition.state !== 'verified') {
          errors.push(`${id} is complete but ${conditionName} is not verified`);
        }
        if (condition.evidence.length === 0) {
          errors.push(`${id} is complete but ${conditionName} has no evidence`);
        }
      }
    }

    if (item.status === 'complete') {
      for (const evidenceKind of REQUIRED_EVIDENCE_KINDS) {
        if (!evidenceKinds.has(evidenceKind)) {
          errors.push(`${id} is complete but has no ${evidenceKind} evidence`);
        }
      }
      if (typeof item.completedAt !== 'string' || Number.isNaN(Date.parse(item.completedAt))) {
        errors.push(`${id}.completedAt must be a valid timestamp when status is complete`);
      }
      if (productionManifestRefs.size === 0) {
        errors.push(`${id} is complete but has no production release evidence manifest`);
      } else {
        for (const ref of productionManifestRefs) {
          try {
            const manifest = JSON.parse(
              readFileSync(resolve(repositoryRoot, ref), 'utf8')
            ) as unknown;
            for (const manifestError of validateReleaseEvidence(manifest, true)) {
              errors.push(`${id} production manifest ${ref}: ${manifestError}`);
            }
          } catch (error) {
            errors.push(`${id} production manifest ${ref} could not be read: ${String(error)}`);
          }
        }
      }
    }
  }

  return { errors, summary };
}

export function readLedger(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..');
  const ledgerPath = resolve(repositoryRoot, 'docs/strategy/completion-ledger.json');

  let ledger: unknown;
  try {
    ledger = readLedger(ledgerPath);
  } catch (error) {
    console.error(`Strategy ledger could not be read: ${String(error)}`);
    process.exit(1);
  }

  const result = validateLedger(ledger, repositoryRoot);
  if (result.errors.length > 0) {
    console.error('Strategy completion ledger validation failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const counts = Object.entries(result.summary)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}=${count}`)
    .join(', ');
  console.log(`Strategy completion ledger valid (${counts}).`);
}
