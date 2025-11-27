import { Response } from 'express';
import { ApiResponse } from '../types';
import { ApiError, ErrorCode, isApiError, getErrorMessage } from '../errors';

/**
 * Extended API response format that includes error code for error responses
 * This provides more detailed error information for clients
 */
export interface ApiErrorResponse {
  success: false;
  data: null;
  error: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Creates a standardized success response
 * @param res - Express response object
 * @param data - Data to include in the response
 * @param statusCode - HTTP status code (default: 200)
 * @returns Express response with success format
 */
export function successResponse<T>(res: Response, data: T, statusCode = 200): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
    error: null,
    timestamp: Date.now(),
  };
  return res.status(statusCode).json(response);
}

/**
 * Creates a standardized error response from an ApiError object
 * Extracts error code, message, status code, and details from the error
 *
 * @param res - Express response object
 * @param error - ApiError instance with code and details
 * @returns Express response with detailed error format
 */
export function apiErrorResponse(res: Response, error: ApiError): Response {
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
 * Creates a standardized error response from a string message
 * Used for simple error cases where a full ApiError is not needed
 *
 * @param res - Express response object
 * @param error - Error message to include
 * @param statusCode - HTTP status code (default: 500)
 * @param code - Optional error code (default: INTERNAL_ERROR)
 * @returns Express response with error format
 */
export function errorResponse(
  res: Response,
  error: string,
  statusCode = 500,
  code: ErrorCode = ErrorCode.INTERNAL_ERROR
): Response {
  const response: ApiErrorResponse = {
    success: false,
    data: null,
    error,
    code,
    timestamp: Date.now(),
  };
  return res.status(statusCode).json(response);
}

/**
 * Handles any error type and returns an appropriate error response
 * This is a convenience function that auto-detects ApiError instances
 *
 * @param res - Express response object
 * @param error - Any error (ApiError, Error, or unknown)
 * @param fallbackMessage - Message to use if error cannot be parsed
 * @returns Express response with error format
 */
export function handleError(res: Response, error: unknown, fallbackMessage?: string): Response {
  // If it's already an ApiError, use its structured data
  if (isApiError(error)) {
    return apiErrorResponse(res, error);
  }

  // For standard errors or unknown types, extract the message
  const message = getErrorMessage(error) || fallbackMessage || 'An unexpected error occurred';
  return errorResponse(res, message, 500, ErrorCode.INTERNAL_ERROR);
}
