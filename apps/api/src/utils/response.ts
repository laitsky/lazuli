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
 * Creates a standardized success response object
 * @param data - Data to include in the response
 * @returns API response object with success format
 */
export function successResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    error: null,
    timestamp: Date.now(),
  };
}

/**
 * Creates a standardized error response from an ApiError object
 * Extracts error code, message, status code, and details from the error
 *
 * @param error - ApiError instance with code and details
 * @returns API error response object
 */
export function apiErrorResponse(error: ApiError): ApiErrorResponse {
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
 * Creates a standardized error response from a string message
 * Used for simple error cases where a full ApiError is not needed
 *
 * @param error - Error message to include
 * @param code - Optional error code (default: INTERNAL_ERROR)
 * @returns API error response object
 */
export function errorResponse(
  error: string,
  code: ErrorCode = ErrorCode.INTERNAL_ERROR
): ApiErrorResponse {
  return {
    success: false,
    data: null,
    error,
    code,
    timestamp: Date.now(),
  };
}

/**
 * Handles any error type and returns an appropriate error response
 * This is a convenience function that auto-detects ApiError instances
 *
 * @param error - Any error (ApiError, Error, or unknown)
 * @param fallbackMessage - Message to use if error cannot be parsed
 * @returns Object with response body and status code
 */
export function handleError(
  error: unknown,
  fallbackMessage?: string
): { body: ApiErrorResponse; status: number } {
  // If it's already an ApiError, use its structured data
  if (isApiError(error)) {
    return {
      body: apiErrorResponse(error),
      status: error.statusCode,
    };
  }

  // For standard errors or unknown types, extract the message
  const message = getErrorMessage(error) || fallbackMessage || 'An unexpected error occurred';
  return {
    body: errorResponse(message, ErrorCode.INTERNAL_ERROR),
    status: 500,
  };
}
