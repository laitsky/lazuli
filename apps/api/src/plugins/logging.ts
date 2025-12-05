/**
 * Request Logging Plugin for Elysia
 *
 * This plugin provides request/response logging functionality:
 * - Assigns unique request ID to each request
 * - Logs incoming requests
 * - Logs response completion with duration
 * - Sets X-Request-ID header for client correlation
 */

import { Elysia } from 'elysia';
import { createLogger } from '../utils/logger';
import { randomUUID } from 'crypto';

// Create logger for HTTP requests
const logger = createLogger('http');

/**
 * Logging plugin for Elysia
 * Logs all incoming requests and their responses
 */
export const loggingPlugin = new Elysia({ name: 'request-logger' })
  // Derive request context for each request
  .derive({ as: 'global' }, ({ request }) => {
    // Generate or use existing request ID (useful for distributed tracing)
    const requestId = request.headers.get('x-request-id') || randomUUID();
    const startTime = Date.now();

    // Log incoming request
    const url = new URL(request.url);
    logger.info({
      requestId,
      method: request.method,
      url: url.pathname + url.search,
      userAgent: request.headers.get('user-agent'),
      msg: `→ ${request.method} ${url.pathname}${url.search}`,
    });

    return {
      requestId,
      startTime,
    };
  })
  // Log response and set headers
  .onAfterResponse(({ request, requestId, startTime, set }) => {
    const duration = Date.now() - startTime;
    const url = new URL(request.url);
    const statusCode = set.status || 200;

    const logData = {
      requestId,
      method: request.method,
      url: url.pathname + url.search,
      statusCode,
      duration: `${duration}ms`,
      msg: `← ${request.method} ${url.pathname}${url.search} ${statusCode} (${duration}ms)`,
    };

    // Log level based on status code
    if (typeof statusCode === 'number') {
      if (statusCode >= 500) {
        logger.error(logData);
      } else if (statusCode >= 400) {
        logger.warn(logData);
      } else {
        logger.info(logData);
      }
    } else {
      logger.info(logData);
    }
  })
  // Set response headers
  .onBeforeHandle(({ requestId, set }) => {
    set.headers['X-Request-ID'] = requestId;
  });
