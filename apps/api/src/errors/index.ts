/**
 * Standardized Error Handling System for Lazuli API
 *
 * This module provides a comprehensive error handling framework with:
 * - Specific error codes for different failure scenarios
 * - Custom error classes that carry error codes and HTTP status
 * - Type-safe error creation and handling
 *
 * Error codes follow the pattern: CATEGORY_SPECIFIC_ERROR
 * - EXCHANGE_*: Exchange-related errors (API calls, rate limits, timeouts)
 * - VALIDATION_*: Input validation errors
 * - DATABASE_*: Database operation errors
 * - CACHE_*: Cache-related errors
 * - NOT_FOUND_*: Resource not found errors
 * - INTERNAL_*: Internal server errors
 */

/**
 * Enumeration of all error codes used in the application
 * Each code maps to a specific error scenario for precise error tracking
 */
export enum ErrorCode {
  // Exchange-related errors (4xx/5xx depending on context)
  EXCHANGE_NOT_SUPPORTED = 'EXCHANGE_NOT_SUPPORTED',
  EXCHANGE_TIMEOUT = 'EXCHANGE_TIMEOUT',
  EXCHANGE_RATE_LIMIT = 'EXCHANGE_RATE_LIMIT',
  EXCHANGE_UNAVAILABLE = 'EXCHANGE_UNAVAILABLE',
  EXCHANGE_API_ERROR = 'EXCHANGE_API_ERROR',
  EXCHANGE_AUTHENTICATION_ERROR = 'EXCHANGE_AUTHENTICATION_ERROR',
  EXCHANGE_INSUFFICIENT_FUNDS = 'EXCHANGE_INSUFFICIENT_FUNDS',
  EXCHANGE_INVALID_ORDER = 'EXCHANGE_INVALID_ORDER',
  EXCHANGE_NETWORK_ERROR = 'EXCHANGE_NETWORK_ERROR',

  // Validation errors (400)
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  VALIDATION_INVALID_EXCHANGE = 'VALIDATION_INVALID_EXCHANGE',
  VALIDATION_INVALID_SYMBOL = 'VALIDATION_INVALID_SYMBOL',
  VALIDATION_INVALID_TIMEFRAME = 'VALIDATION_INVALID_TIMEFRAME',
  VALIDATION_INVALID_MARKET_TYPE = 'VALIDATION_INVALID_MARKET_TYPE',
  VALIDATION_INVALID_PARAMETER = 'VALIDATION_INVALID_PARAMETER',
  VALIDATION_MISSING_PARAMETER = 'VALIDATION_MISSING_PARAMETER',
  VALIDATION_INVALID_DATE_RANGE = 'VALIDATION_INVALID_DATE_RANGE',
  VALIDATION_WEIGHTS_INVALID = 'VALIDATION_WEIGHTS_INVALID',

  // Not found errors (404)
  NOT_FOUND_TICKER = 'NOT_FOUND_TICKER',
  NOT_FOUND_MARKET = 'NOT_FOUND_MARKET',
  NOT_FOUND_SYMBOL = 'NOT_FOUND_SYMBOL',
  NOT_FOUND_ROUTE = 'NOT_FOUND_ROUTE',
  NOT_FOUND_DATA = 'NOT_FOUND_DATA',

  // Database errors (500/503)
  DATABASE_CONNECTION_ERROR = 'DATABASE_CONNECTION_ERROR',
  DATABASE_QUERY_ERROR = 'DATABASE_QUERY_ERROR',
  DATABASE_WRITE_ERROR = 'DATABASE_WRITE_ERROR',
  DATABASE_NOT_CONFIGURED = 'DATABASE_NOT_CONFIGURED',

  // Cache errors (500)
  CACHE_ERROR = 'CACHE_ERROR',
  CACHE_MISS = 'CACHE_MISS',

  // Internal errors (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INTERNAL_CONFIGURATION_ERROR = 'INTERNAL_CONFIGURATION_ERROR',
  INTERNAL_SERVICE_ERROR = 'INTERNAL_SERVICE_ERROR',
}

/**
 * Mapping of error codes to their default HTTP status codes
 * This ensures consistent HTTP responses for each error type
 */
export const ErrorCodeToHttpStatus: Record<ErrorCode, number> = {
  // Exchange errors
  [ErrorCode.EXCHANGE_NOT_SUPPORTED]: 400,
  [ErrorCode.EXCHANGE_TIMEOUT]: 504,
  [ErrorCode.EXCHANGE_RATE_LIMIT]: 429,
  [ErrorCode.EXCHANGE_UNAVAILABLE]: 503,
  [ErrorCode.EXCHANGE_API_ERROR]: 502,
  [ErrorCode.EXCHANGE_AUTHENTICATION_ERROR]: 401,
  [ErrorCode.EXCHANGE_INSUFFICIENT_FUNDS]: 400,
  [ErrorCode.EXCHANGE_INVALID_ORDER]: 400,
  [ErrorCode.EXCHANGE_NETWORK_ERROR]: 503,

  // Validation errors
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.VALIDATION_INVALID_EXCHANGE]: 400,
  [ErrorCode.VALIDATION_INVALID_SYMBOL]: 400,
  [ErrorCode.VALIDATION_INVALID_TIMEFRAME]: 400,
  [ErrorCode.VALIDATION_INVALID_MARKET_TYPE]: 400,
  [ErrorCode.VALIDATION_INVALID_PARAMETER]: 400,
  [ErrorCode.VALIDATION_MISSING_PARAMETER]: 400,
  [ErrorCode.VALIDATION_INVALID_DATE_RANGE]: 400,
  [ErrorCode.VALIDATION_WEIGHTS_INVALID]: 400,

  // Not found errors
  [ErrorCode.NOT_FOUND_TICKER]: 404,
  [ErrorCode.NOT_FOUND_MARKET]: 404,
  [ErrorCode.NOT_FOUND_SYMBOL]: 404,
  [ErrorCode.NOT_FOUND_ROUTE]: 404,
  [ErrorCode.NOT_FOUND_DATA]: 404,

  // Database errors
  [ErrorCode.DATABASE_CONNECTION_ERROR]: 503,
  [ErrorCode.DATABASE_QUERY_ERROR]: 500,
  [ErrorCode.DATABASE_WRITE_ERROR]: 500,
  [ErrorCode.DATABASE_NOT_CONFIGURED]: 503,

  // Cache errors
  [ErrorCode.CACHE_ERROR]: 500,
  [ErrorCode.CACHE_MISS]: 500,

  // Internal errors
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.INTERNAL_CONFIGURATION_ERROR]: 500,
  [ErrorCode.INTERNAL_SERVICE_ERROR]: 500,
};

/**
 * Base API error class that all custom errors extend
 * Provides consistent error structure with code, message, and HTTP status
 */
export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: number;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode ?? ErrorCodeToHttpStatus[code];
    this.details = details;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Converts error to JSON format for API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Exchange-related errors (API calls, rate limits, timeouts)
 * Used when interacting with exchange APIs via CCXT
 */
export class ExchangeError extends ApiError {
  public readonly exchange?: string;

  constructor(
    code: ErrorCode,
    message: string,
    exchange?: string,
    details?: Record<string, unknown>
  ) {
    super(code, message, undefined, { ...details, exchange });
    this.name = 'ExchangeError';
    this.exchange = exchange;
  }
}

/**
 * Validation errors for invalid input parameters
 * Used when request parameters fail validation
 */
export class ValidationError extends ApiError {
  public readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string, details?: Record<string, unknown>) {
    super(code, message, 400, { ...details, field });
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Not found errors for missing resources
 * Used when requested resource doesn't exist
 */
export class NotFoundError extends ApiError {
  public readonly resource?: string;

  constructor(code: ErrorCode, message: string, resource?: string) {
    super(code, message, 404, { resource });
    this.name = 'NotFoundError';
    this.resource = resource;
  }
}

/**
 * Database-related errors
 * Used when database operations fail
 */
export class DatabaseError extends ApiError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, undefined, details);
    this.name = 'DatabaseError';
  }
}

/**
 * Cache-related errors
 * Used when cache operations fail
 */
export class CacheError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.CACHE_ERROR, message, 500, details);
    this.name = 'CacheError';
  }
}

// ============================================
// Error Factory Functions
// ============================================

/**
 * Creates an exchange not supported error
 */
export function exchangeNotSupported(exchange: string): ExchangeError {
  return new ExchangeError(
    ErrorCode.EXCHANGE_NOT_SUPPORTED,
    `Exchange '${exchange}' is not supported`,
    exchange
  );
}

/**
 * Creates an exchange timeout error
 */
export function exchangeTimeout(exchange: string, operation?: string): ExchangeError {
  const message = operation
    ? `Exchange '${exchange}' timed out during ${operation}`
    : `Exchange '${exchange}' timed out`;
  return new ExchangeError(ErrorCode.EXCHANGE_TIMEOUT, message, exchange, { operation });
}

/**
 * Creates a rate limit exceeded error
 */
export function rateLimitExceeded(exchange: string): ExchangeError {
  return new ExchangeError(
    ErrorCode.EXCHANGE_RATE_LIMIT,
    `Rate limit exceeded for exchange '${exchange}'. Please try again later.`,
    exchange
  );
}

/**
 * Creates an exchange unavailable error
 */
export function exchangeUnavailable(exchange: string, reason?: string): ExchangeError {
  const message = reason
    ? `Exchange '${exchange}' is unavailable: ${reason}`
    : `Exchange '${exchange}' is currently unavailable`;
  return new ExchangeError(ErrorCode.EXCHANGE_UNAVAILABLE, message, exchange, { reason });
}

/**
 * Creates an exchange API error
 */
export function exchangeApiError(exchange: string, originalError?: string): ExchangeError {
  return new ExchangeError(
    ErrorCode.EXCHANGE_API_ERROR,
    `Exchange '${exchange}' API error: ${originalError || 'Unknown error'}`,
    exchange,
    { originalError }
  );
}

/**
 * Creates an exchange network error
 */
export function exchangeNetworkError(exchange: string): ExchangeError {
  return new ExchangeError(
    ErrorCode.EXCHANGE_NETWORK_ERROR,
    `Network error connecting to exchange '${exchange}'`,
    exchange
  );
}

/**
 * Creates an invalid exchange validation error
 */
export function invalidExchange(exchange: string): ValidationError {
  return new ValidationError(
    ErrorCode.VALIDATION_INVALID_EXCHANGE,
    `Invalid exchange: '${exchange}'`,
    'exchange',
    { provided: exchange, supported: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'] }
  );
}

/**
 * Creates an invalid symbol validation error
 */
export function invalidSymbol(symbol: string, exchange?: string): ValidationError {
  return new ValidationError(
    ErrorCode.VALIDATION_INVALID_SYMBOL,
    `Invalid symbol: '${symbol}'${exchange ? ` for exchange '${exchange}'` : ''}`,
    'symbol',
    { provided: symbol, exchange }
  );
}

/**
 * Creates an invalid timeframe validation error
 */
export function invalidTimeframe(timeframe: string, supported?: string[]): ValidationError {
  return new ValidationError(
    ErrorCode.VALIDATION_INVALID_TIMEFRAME,
    `Invalid timeframe: '${timeframe}'${supported ? `. Supported: ${supported.join(', ')}` : ''}`,
    'timeframe',
    { provided: timeframe, supported }
  );
}

/**
 * Creates an invalid market type validation error
 */
export function invalidMarketType(type: string): ValidationError {
  return new ValidationError(
    ErrorCode.VALIDATION_INVALID_MARKET_TYPE,
    `Invalid market type: '${type}'. Must be 'spot' or 'perp'`,
    'type',
    { provided: type, supported: ['spot', 'perp'] }
  );
}

/**
 * Creates an invalid parameter validation error
 */
export function invalidParameter(parameter: string, message: string): ValidationError {
  return new ValidationError(ErrorCode.VALIDATION_INVALID_PARAMETER, message, parameter);
}

/**
 * Creates a missing parameter validation error
 */
export function missingParameter(parameter: string): ValidationError {
  return new ValidationError(
    ErrorCode.VALIDATION_MISSING_PARAMETER,
    `Missing required parameter: '${parameter}'`,
    parameter
  );
}

/**
 * Creates an invalid weights validation error
 */
export function invalidWeights(reason: string): ValidationError {
  return new ValidationError(ErrorCode.VALIDATION_WEIGHTS_INVALID, reason, 'weights');
}

/**
 * Creates a ticker not found error
 */
export function tickerNotFound(symbol: string, exchange: string): NotFoundError {
  return new NotFoundError(
    ErrorCode.NOT_FOUND_TICKER,
    `Ticker '${symbol}' not found on exchange '${exchange}'`,
    `${exchange}:${symbol}`
  );
}

/**
 * Creates a market not found error
 */
export function marketNotFound(symbol: string, exchange: string): NotFoundError {
  return new NotFoundError(
    ErrorCode.NOT_FOUND_MARKET,
    `Market '${symbol}' not found on exchange '${exchange}'`,
    `${exchange}:${symbol}`
  );
}

/**
 * Creates a symbol not found error
 */
export function symbolNotFound(symbol: string, exchange: string): NotFoundError {
  return new NotFoundError(
    ErrorCode.NOT_FOUND_SYMBOL,
    `Symbol '${symbol}' not found on exchange '${exchange}'`,
    `${exchange}:${symbol}`
  );
}

/**
 * Creates a route not found error
 */
export function routeNotFound(path: string): NotFoundError {
  return new NotFoundError(ErrorCode.NOT_FOUND_ROUTE, `Route '${path}' not found`, path);
}

/**
 * Creates a data not found error
 */
export function dataNotFound(description: string): NotFoundError {
  return new NotFoundError(ErrorCode.NOT_FOUND_DATA, description);
}

/**
 * Creates a database connection error
 */
export function databaseConnectionError(details?: string): DatabaseError {
  return new DatabaseError(
    ErrorCode.DATABASE_CONNECTION_ERROR,
    `Database connection error${details ? `: ${details}` : ''}`,
    { details }
  );
}

/**
 * Creates a database query error
 */
export function databaseQueryError(operation: string, details?: string): DatabaseError {
  return new DatabaseError(
    ErrorCode.DATABASE_QUERY_ERROR,
    `Database query failed during ${operation}${details ? `: ${details}` : ''}`,
    { operation, details }
  );
}

/**
 * Creates a database write error
 */
export function databaseWriteError(operation: string, details?: string): DatabaseError {
  return new DatabaseError(
    ErrorCode.DATABASE_WRITE_ERROR,
    `Database write failed during ${operation}${details ? `: ${details}` : ''}`,
    { operation, details }
  );
}

/**
 * Creates a database not configured error
 */
export function databaseNotConfigured(): DatabaseError {
  return new DatabaseError(
    ErrorCode.DATABASE_NOT_CONFIGURED,
    'Database is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
  );
}

/**
 * Creates an internal error
 */
export function internalError(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(ErrorCode.INTERNAL_ERROR, message, 500, details);
}

// ============================================
// Error Detection Utilities
// ============================================

/**
 * Checks if an error is an instance of ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Checks if an error is a validation error
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Checks if an error is an exchange error
 */
export function isExchangeError(error: unknown): error is ExchangeError {
  return error instanceof ExchangeError;
}

/**
 * Checks if an error is a not found error
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

/**
 * Checks if an error is a database error
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

// ============================================
// CCXT Error Classification
// ============================================

/**
 * Classifies CCXT errors into our standardized error types
 * CCXT throws various error types that we need to map to our error codes
 *
 * @param error - The original error from CCXT
 * @param exchange - The exchange identifier
 * @returns Standardized ExchangeError
 */
export function classifyCcxtError(error: unknown, exchange: string): ExchangeError {
  // Handle non-Error objects
  if (!(error instanceof Error)) {
    return exchangeApiError(exchange, String(error));
  }

  const errorMessage = error.message.toLowerCase();
  const errorName = error.name || error.constructor.name;

  // Rate limit errors - CCXT throws RateLimitExceeded or DDoSProtection
  if (
    errorName === 'RateLimitExceeded' ||
    errorName === 'DDoSProtection' ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('429')
  ) {
    return rateLimitExceeded(exchange);
  }

  // Timeout errors - CCXT throws RequestTimeout
  if (
    errorName === 'RequestTimeout' ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out') ||
    errorMessage.includes('etimedout')
  ) {
    return exchangeTimeout(exchange);
  }

  // Network errors - CCXT throws NetworkError or ExchangeNotAvailable
  if (
    errorName === 'NetworkError' ||
    errorName === 'ExchangeNotAvailable' ||
    errorMessage.includes('network') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('econnreset')
  ) {
    return exchangeNetworkError(exchange);
  }

  // Exchange not available
  if (errorName === 'ExchangeNotAvailable' || errorMessage.includes('maintenance')) {
    return exchangeUnavailable(exchange, error.message);
  }

  // Authentication errors
  if (
    errorName === 'AuthenticationError' ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('api key') ||
    errorMessage.includes('unauthorized')
  ) {
    return new ExchangeError(
      ErrorCode.EXCHANGE_AUTHENTICATION_ERROR,
      `Authentication failed for exchange '${exchange}'`,
      exchange
    );
  }

  // Invalid order errors
  if (
    errorName === 'InvalidOrder' ||
    errorMessage.includes('invalid order') ||
    errorMessage.includes('order not found')
  ) {
    return new ExchangeError(
      ErrorCode.EXCHANGE_INVALID_ORDER,
      `Invalid order on exchange '${exchange}': ${error.message}`,
      exchange
    );
  }

  // Insufficient funds
  if (
    errorName === 'InsufficientFunds' ||
    errorMessage.includes('insufficient') ||
    errorMessage.includes('not enough')
  ) {
    return new ExchangeError(
      ErrorCode.EXCHANGE_INSUFFICIENT_FUNDS,
      `Insufficient funds on exchange '${exchange}'`,
      exchange
    );
  }

  // Default to generic exchange API error
  return exchangeApiError(exchange, error.message);
}

/**
 * Extracts error message from unknown error type
 * Safely handles various error formats
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error occurred';
}
