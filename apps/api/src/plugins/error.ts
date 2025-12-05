/**
 * Error Handling Plugin for Elysia
 *
 * This plugin provides centralized error handling for the entire API.
 * It catches all errors thrown in route handlers and services, then
 * transforms them into standardized error responses.
 *
 * Features:
 * - Catches and classifies all errors
 * - Logs errors with context for debugging
 * - Returns consistent error response format
 * - Handles both ApiError instances and generic errors
 */

import { Elysia } from 'elysia';
import { ApiError, isApiError, getErrorMessage, routeNotFound, ErrorCode } from '../errors';
import { createServiceLogger } from '../utils/logger';
import { ApiErrorResponse } from '../utils/response';

// Create logger for error handling
const log = createServiceLogger('errorHandler');

/**
 * Logs an error with structured context
 * Uses centralized logger for consistent formatting and log aggregation
 *
 * @param error - The ApiError to log
 * @param path - Request path for context
 * @param method - HTTP method for context
 * @param requestId - Request ID for tracing
 */
function logApiError(error: ApiError, path: string, method: string, requestId?: string): void {
  const errorContext = {
    code: error.code,
    path,
    method,
    statusCode: error.statusCode,
    details: error.details,
    requestId,
    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
  };

  // Log based on severity (5xx errors are more severe)
  if (error.statusCode >= 500) {
    log.error(error.message, error, errorContext);
  } else {
    log.warn(error.message, errorContext);
  }
}

/**
 * Converts any error to an ApiError instance
 * This ensures all errors have a consistent structure
 *
 * @param error - Unknown error type
 * @returns ApiError instance
 */
function normalizeError(error: unknown): ApiError {
  // Already an ApiError, return as-is
  if (isApiError(error)) {
    return error;
  }

  // Standard Error object
  if (error instanceof Error) {
    return new ApiError(ErrorCode.INTERNAL_ERROR, error.message, 500, {
      name: error.name,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    });
  }

  // Unknown error type
  return new ApiError(ErrorCode.INTERNAL_ERROR, getErrorMessage(error), 500);
}

/**
 * Build standardized error response
 */
function buildErrorResponse(error: ApiError): ApiErrorResponse {
  return {
    success: false,
    data: null,
    error: error.message,
    code: error.code,
    details: error.details,
    timestamp: error.timestamp,
  };
}

/**
 * Error handling plugin for Elysia
 * Catches all errors and returns standardized responses
 */
export const errorPlugin = new Elysia({ name: 'error-handler' })
  // Handle all errors globally - use 'scoped' to ensure it catches all routes
  .onError({ as: 'global' }, ({ code, error, path, request, set }) => {
    // Handle 404 Not Found
    if (code === 'NOT_FOUND') {
      const notFoundError = routeNotFound(path);
      logApiError(notFoundError, path, request.method);
      set.status = 404;
      return buildErrorResponse(notFoundError);
    }

    // Handle validation errors from Elysia
    if (code === 'VALIDATION') {
      const validationError = new ApiError(
        ErrorCode.VALIDATION_FAILED,
        error.message || 'Validation failed',
        400,
        { validator: error.validator, value: error.value }
      );
      logApiError(validationError, path, request.method);
      set.status = 400;
      return buildErrorResponse(validationError);
    }

    // Handle parse errors
    if (code === 'PARSE') {
      const parseError = new ApiError(
        ErrorCode.VALIDATION_FAILED,
        'Failed to parse request body',
        400
      );
      logApiError(parseError, path, request.method);
      set.status = 400;
      return buildErrorResponse(parseError);
    }

    // Normalize all other errors to ApiError
    const apiError = normalizeError(error);
    logApiError(apiError, path, request.method);
    set.status = apiError.statusCode;
    return buildErrorResponse(apiError);
  });
