/**
 * Documentation Routes for Elysia
 * Serves API documentation using Stoplight Elements
 */

import { Elysia } from 'elysia';
import { successResponse, errorResponse } from '../utils/response';
import { ErrorCode } from '../errors';
import { createServiceLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

// Create logger for docs routes
const log = createServiceLogger('docs');

interface ApiSpecCache {
  content: string | null;
  path?: string;
  error?: string;
}

/**
 * Load API specification once at startup to avoid sync I/O per request
 */
function loadApiSpec(): ApiSpecCache {
  const candidates = [
    path.join(__dirname, 'api-spec.yaml'),
    path.join(__dirname, '../api-spec.yaml'),
    path.resolve(process.cwd(), 'apps/api/src/api-spec.yaml'),
    path.resolve(process.cwd(), 'src/api-spec.yaml'),
    path.resolve(process.cwd(), 'api-spec.yaml'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8');
        return { content, path: candidate };
      }
    } catch (error) {
      return {
        content: null,
        error: error instanceof Error ? error.message : 'Unknown error loading API spec',
      };
    }
  }

  return { content: null, error: 'API specification file not found' };
}

const apiSpecCache = loadApiSpec();
if (apiSpecCache.content) {
  log.info('API spec loaded', { path: apiSpecCache.path });
} else {
  log.warn('API spec not loaded', { error: apiSpecCache.error });
}

/**
 * Documentation routes plugin
 */
export const docsRoutes = new Elysia({ prefix: '/docs' })
  // GET /api/v1/docs - Serve interactive API documentation
  .get('/', ({ set }) => {
    // Generate HTML page with Stoplight Elements embedded
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <title>Lazuli API Documentation</title>
  <script src="https://unpkg.com/@stoplight/elements/web-components.min.js"></script>
  <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css">
  <style>
    body { margin: 0; padding: 0; }
    elements-api {
      height: 100vh;
    }
  </style>
</head>
<body>
  <elements-api
    apiDescriptionUrl="/api/v1/docs/spec"
    router="hash"
    layout="sidebar"
    hideInternal="false"
    hideSchemas="false"
    hideExport="false"
  />
</body>
</html>`;

    // Set CORS headers to allow API testing
    set.headers['Access-Control-Allow-Origin'] = '*';
    set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    set.headers['Content-Type'] = 'text/html';

    return html;
  })
  // GET /api/v1/docs/spec - Serve OpenAPI specification
  .get('/spec', ({ set }) => {
    try {
      if (!apiSpecCache.content) {
        set.status = 404;
        return errorResponse('API specification file not found', ErrorCode.NOT_FOUND_DATA);
      }

      // Set appropriate headers for YAML content
      set.headers['Content-Type'] = 'application/yaml';
      set.headers['Access-Control-Allow-Origin'] = '*';
      set.headers['Access-Control-Allow-Headers'] =
        'Origin, X-Requested-With, Content-Type, Accept';

      return apiSpecCache.content;
    } catch (error) {
      log.error('Error serving API specification', error);
      set.status = 500;
      return errorResponse('Failed to load API specification');
    }
  })
  // GET /api/v1/docs/info - Get documentation metadata
  .get('/info', () => {
    const docsInfo = {
      title: 'Lazuli API Documentation',
      description: 'Interactive API documentation powered by Stoplight Elements',
      version: '1.0.0',
      endpoints: {
        docs: '/api/v1/docs',
        spec: '/api/v1/docs/spec',
        info: '/api/v1/docs/info',
      },
      features: [
        'Interactive API testing',
        'Real-time request/response examples',
        'Schema validation',
        'Code generation examples',
        'Try It functionality',
      ],
      exchanges_supported: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'],
      api_categories: [
        'Live ticker data (no database required)',
        'Market information',
        'Historical data storage (database required)',
        'Data management operations',
      ],
    };

    return successResponse(docsInfo);
  });
