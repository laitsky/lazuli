import { readFile } from 'node:fs/promises';
import { validateReleaseEvidence } from './release-evidence';

const path = Bun.argv[2];
if (!path)
  throw new Error('Usage: validate-release-evidence.ts <report.json> [--require-production]');
const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
const errors = validateReleaseEvidence(value, Bun.argv.includes('--require-production'));
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Release evidence is complete and valid.');
}
