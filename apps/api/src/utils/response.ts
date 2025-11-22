import { Response } from 'express';
import { ApiResponse } from '../types';

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
 * Creates a standardized error response
 * @param res - Express response object
 * @param error - Error message to include
 * @param statusCode - HTTP status code (default: 500)
 * @returns Express response with error format
 */
export function errorResponse(res: Response, error: string, statusCode = 500): Response {
  const response: ApiResponse = {
    success: false,
    data: null,
    error,
    timestamp: Date.now(),
  };
  return res.status(statusCode).json(response);
}
