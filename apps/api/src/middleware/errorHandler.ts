/**
 * Global Error Handling Middleware
 *
 * This middleware provides centralized error handling for the entire API.
 * It catches all errors thrown in route handlers and services, then
 * transforms them into standardized error responses.
 *
 * Features:
 * - Catches and classifies all errors
 * - Logs errors with context for debugging
 * - Returns consistent error response format
 * - Handles both ApiError instances and generic errors
 */

import { Request, Response, NextFunction } from 'express';
import {
  ApiError,
  ErrorCode,
  isApiError,
  getErrorMessage,
  routeNotFound,
  internalError,
} from '../errors';
import { ApiErrorResponse } from '../utils/response';

/**
 * Error logging interface for structured error logs
 */
interface ErrorLog {
  timestamp: string;
  code: ErrorCode;
  message: string;
  path: string;
  method: string;
  statusCode: number;
  stack?: string;
  details?: Record<string, unknown>;
}

/**
 * Logs an error with structured context
 * In production, this could be extended to send to external logging services
 *
 * @param error - The ApiError to log
 * @param req - Express request object for context
 */
function logError(error: ApiError, req: Request): void {
  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    code: error.code,
    message: error.message,
    path: req.path,
    method: req.method,
    statusCode: error.statusCode,
    details: error.details,
  };

  // Include stack trace in development mode
  if (process.env.NODE_ENV !== 'production') {
    errorLog.stack = error.stack;
  }

  // Log based on severity (5xx errors are more severe)
  if (error.statusCode >= 500) {
    console.error('[ERROR]', JSON.stringify(errorLog, null, 2));
  } else {
    console.warn('[WARN]', JSON.stringify(errorLog));
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
    return internalError(error.message, {
      name: error.name,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    });
  }

  // Unknown error type
  return internalError(getErrorMessage(error));
}

/**
 * 404 Not Found handler middleware
 * Catches requests to undefined routes and returns a standardized 404 response
 *
 * Usage: app.use(notFoundHandler) - should be placed after all route definitions
 */
export function notFoundHandler(req: Request, res: Response): Response {
  const error = routeNotFound(req.path);

  logError(error, req);

  const response: ApiErrorResponse = {
    success: false,
    data: null,
    error: error.message,
    code: error.code,
    details: error.details,
    timestamp: error.timestamp,
  };

  return res.status(error.statusCode).json(response);
}

/**
 * Global error handler middleware
 * Catches all errors thrown in the application and returns standardized responses
 *
 * This middleware MUST have 4 parameters for Express to recognize it as an error handler
 *
 * Usage: app.use(globalErrorHandler) - should be placed last in middleware chain
 */
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): Response {
  // Normalize the error to ApiError format
  const apiError = normalizeError(err);

  // Log the error with request context
  logError(apiError, req);

  // Build the response
  const response: ApiErrorResponse = {
    success: false,
    data: null,
    error: apiError.message,
    code: apiError.code,
    details: apiError.details,
    timestamp: apiError.timestamp,
  };

  return res.status(apiError.statusCode).json(response);
}

/**
 * Async handler wrapper that catches errors and passes them to the error handler
 * Use this to wrap async route handlers to avoid try-catch boilerplate
 *
 * @param fn - Async route handler function
 * @returns Wrapped function that catches errors
 *
 * @example
 * router.get('/example', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   return successResponse(res, data);
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>
) {
  return (req: Request, res: Response, next: NextFunction): Promise<void> => {
    return Promise.resolve(fn(req, res, next)).catch(next) as Promise<void>;
  };
}
