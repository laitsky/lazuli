import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import { OPENAPI_DOCUMENT } from '../generated-openapi';

declare const Bun: {
  file(path: string): { text(): Promise<string> };
};

const testDirectory = (import.meta as ImportMeta & { dir: string }).dir;
const sourceDirectory = `${testDirectory}/..`;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function extractWorkerOperations(source: string): string[] {
  const operations = new Set<string>();
  const routePattern = /\b(api|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

  for (const match of source.matchAll(routePattern)) {
    const owner = match[1];
    const method = match[2];
    const path = match[3];
    if (!owner || !method || !path) continue;

    // Root /health is a compatibility alias of /api/v1/health. Root /ws is a
    // separately supported public endpoint and must remain in the contract.
    if (owner === 'app' && path !== '/ws') continue;
    operations.add(`${method} ${normalizePath(path)}`);
  }

  return [...operations].sort();
}

function extractOpenApiOperations(source: string): string[] {
  const pathsStart = source.indexOf('paths:\n');
  const componentsStart = source.indexOf('\ncomponents:\n', pathsStart);
  if (pathsStart === -1 || componentsStart === -1) return [];

  const operations = new Set<string>();
  let currentPath: string | null = null;
  for (const line of source.slice(pathsStart, componentsStart).split('\n')) {
    const pathMatch = /^  (\/[^:]+):$/.exec(line);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^    ([a-z]+):$/.exec(line);
    const method = methodMatch?.[1];
    if (currentPath && method && HTTP_METHODS.has(method)) {
      operations.add(`${method} ${currentPath}`);
    }
  }

  return [...operations].sort();
}

describe('OpenAPI route contract', () => {
  test('serves the generated form of the checked-in typed contract without drift', async () => {
    const source = await Bun.file(`${sourceDirectory}/api-spec.yaml`).text();
    expect(OPENAPI_DOCUMENT).toEqual(parse(source));
  });

  test('documents every registered API operation and no nonexistent operation', async () => {
    const [workerSource, openApiSource] = await Promise.all([
      Bun.file(`${sourceDirectory}/index.ts`).text(),
      Bun.file(`${sourceDirectory}/api-spec.yaml`).text(),
    ]);

    expect(extractOpenApiOperations(openApiSource)).toEqual(extractWorkerOperations(workerSource));
  });

  test('declares every templated path parameter', async () => {
    const source = await Bun.file(`${sourceDirectory}/api-spec.yaml`).text();
    const pathsStart = source.indexOf('paths:\n');
    const componentsStart = source.indexOf('\ncomponents:\n', pathsStart);
    const blocks = source
      .slice(pathsStart + 'paths:\n'.length, componentsStart)
      .split(/(?=^  \/[^:\n]+:\n)/m)
      .filter(Boolean);

    for (const block of blocks) {
      const path = /^  (\/[^:]+):/m.exec(block)?.[1];
      if (!path) continue;
      for (const parameter of path.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
        const declaredInline = block.includes(`name: ${parameter[1]}`);
        const declaredBySharedExchangeParameter =
          parameter[1] === 'exchange' &&
          block.includes("$ref: '#/components/parameters/ExchangeParam'");
        expect(declaredInline || declaredBySharedExchangeParameter).toBe(true);
      }
    }
  });

  test('every operation defines response contracts and write payload schemas where applicable', () => {
    for (const [path, pathItem] of Object.entries(OPENAPI_DOCUMENT.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = (pathItem as Record<string, unknown>)[method];
        if (!operation) continue;
        const record = operation as Record<string, unknown>;
        expect(Boolean(record.responses)).toBe(true);
        for (const [status, rawResponse] of Object.entries(
          record.responses as Record<string, unknown>
        )) {
          if (!/^2\d\d$/.test(status) || typeof rawResponse !== 'object' || rawResponse === null) {
            continue;
          }
          const response = rawResponse as Record<string, unknown>;
          expect(Boolean(response.content || response.$ref)).toBe(true);
        }
        if (['post', 'put', 'patch'].includes(method) && path !== '/auth/logout') {
          const hasRequestBody = Boolean(record.requestBody);
          const explicitlyBodyless = new Set([
            '/backtests/jobs/{id}/cancel',
            '/auth/passkeys/registration/options',
            '/me/alerts/evaluate',
            '/me/alert-deliveries/{id}/retry',
            '/admin/backfills/{id}/retry',
          ]).has(path);
          expect(hasRequestBody || explicitlyBodyless).toBe(true);
        }
      }
    }
  });
});
