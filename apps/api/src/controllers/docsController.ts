import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import fs from 'fs';
import path from 'path';

/**
 * Controller for serving API documentation using Stoplight Elements
 * Handles both the interactive documentation UI and OpenAPI spec serving
 */
export class DocsController {
  /**
   * Serves the Stoplight Elements documentation interface
   * Provides an interactive API documentation and testing interface
   */
  static async serveDocs(_req: Request, res: Response): Promise<void> {
    try {
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
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error serving documentation:', error);
      errorResponse(res, 'Failed to load API documentation', 500);
    }
  }

  /**
   * Serves the OpenAPI specification file
   * Returns the API spec in YAML format for Elements to consume
   */
  static async serveApiSpec(_req: Request, res: Response): Promise<void> {
    try {
      // Read the OpenAPI spec file
      const specPath = path.join(__dirname, '../api-spec.yaml');

      if (!fs.existsSync(specPath)) {
        errorResponse(res, 'API specification file not found', 404);
        return;
      }

      const specContent = fs.readFileSync(specPath, 'utf8');

      // Set appropriate headers for YAML content
      res.setHeader('Content-Type', 'application/yaml');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept'
      );

      res.send(specContent);
    } catch (error) {
      console.error('Error serving API specification:', error);
      errorResponse(res, 'Failed to load API specification', 500);
    }
  }

  /**
   * Provides metadata about the API documentation
   * Returns information about available documentation formats and endpoints
   */
  static async getDocsInfo(_req: Request, res: Response): Promise<void> {
    try {
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
        exchanges_supported: ['binance', 'bybit', 'okx'],
        api_categories: [
          'Live ticker data (no database required)',
          'Market information',
          'Historical data storage (database required)',
          'Data management operations',
        ],
      };

      successResponse(res, docsInfo);
    } catch (error) {
      console.error('Error getting docs info:', error);
      errorResponse(res, 'Failed to get documentation information', 500);
    }
  }
}

export const docsController = DocsController;
