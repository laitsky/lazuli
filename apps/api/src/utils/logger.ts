import '../config/environment';

/**
 * Centralized Logging Utility
 *
 * Provides industry-standard structured logging using Pino.
 * Features:
 * - ISO 8601 timestamps
 * - Log levels (debug, info, warn, error, fatal)
 * - File/module context via child loggers
 * - Request ID tracing
 * - Performance timing utilities
 * - Pretty printing in development, JSON in production
 * - Redaction of sensitive data
 * - Rolling file logs with automatic rotation
 * - Multi-transport support (stdout + file)
 */

import pino, { Logger, LoggerOptions, TransportTargetOptions } from 'pino';
import path from 'path';
import fs from 'fs';

/**
 * Determine if we're in production mode
 */
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Get log level from environment or use defaults
 * - Production: 'info' (skip debug logs)
 * - Development: 'debug' (show all logs)
 */
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

/**
 * Rolling file log configuration from environment
 * - LOG_FILE_ENABLED: Enable file logging (default: false)
 * - LOG_FILE_PATH: Directory for log files (default: ./logs)
 * - LOG_FILE_FREQUENCY: Time-based rotation - 'daily' or 'hourly' (default: daily)
 * - LOG_FILE_SIZE: Size-based rotation - e.g., '10M', '100K', '1G' (optional, can combine with frequency)
 * - LOG_FILE_MAX_FILES: Number of log files to keep (default: 7)
 *
 * Note: pino-roll supports combining frequency and size options.
 * If both are set, rotation happens when either condition is met.
 */
const logFileEnabled = process.env.LOG_FILE_ENABLED === 'true';
const logFilePath = process.env.LOG_FILE_PATH || './logs';
const logFileFrequency = process.env.LOG_FILE_FREQUENCY || 'daily';
const logFileSize = process.env.LOG_FILE_SIZE; // e.g., '10M', '50M', '1G'
const logFileMaxFiles = parseInt(process.env.LOG_FILE_MAX_FILES || '7', 10);

/**
 * Track whether file logging is actually available after setup attempts.
 * This allows graceful degradation if directory creation or transport setup fails.
 */
let fileLoggingAvailable = false;
let fileLoggingError: string | null = null;

/**
 * Attempt to create log directory if file logging is enabled.
 * Fails gracefully - logs error and continues with stdout-only logging.
 */
if (logFileEnabled) {
  try {
    const absoluteLogPath = path.resolve(logFilePath);
    if (!fs.existsSync(absoluteLogPath)) {
      fs.mkdirSync(absoluteLogPath, { recursive: true });
    }
    // Verify directory is writable by checking access
    fs.accessSync(absoluteLogPath, fs.constants.W_OK);
    fileLoggingAvailable = true;
  } catch (error) {
    fileLoggingError =
      error instanceof Error ? error.message : 'Unknown error creating log directory';
    // Will fall back to stdout-only logging
  }
}

/**
 * Build transport targets based on configuration.
 * Supports multi-transport: stdout (pretty in dev) + rolling files.
 * Gracefully degrades to stdout-only if file transport setup fails.
 */
function buildTransportTargets(): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [];

  // Always add stdout transport - this is the fallback that must always work
  if (isProduction) {
    // Production: JSON to stdout for container/cloud logging
    targets.push({
      target: 'pino/file',
      options: { destination: 1 }, // 1 = stdout
      level: logLevel,
    });
  } else {
    // Development: Pretty print to stdout
    targets.push({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
        messageFormat: '{module}: {msg}',
        destination: 1, // stdout
      },
      level: logLevel,
    });
  }

  // Add rolling file transport only if directory setup succeeded
  if (logFileEnabled && fileLoggingAvailable) {
    try {
      const absoluteLogPath = path.resolve(logFilePath);

      // Build pino-roll options
      const rollOptions: Record<string, unknown> = {
        file: path.join(absoluteLogPath, 'api'), // Creates api.log, api.1.log, etc.
        frequency: logFileFrequency, // 'daily' or 'hourly'
        limit: { count: logFileMaxFiles }, // Keep N most recent files
        mkdir: true, // Create directory if it doesn't exist
        sync: false, // Async writes for better performance
        extension: '.log', // File extension
      };

      // Add size-based rotation if configured (can combine with frequency)
      if (logFileSize) {
        rollOptions.size = logFileSize; // e.g., '10M', '50M', '1G'
      }

      targets.push({
        target: 'pino-roll',
        options: rollOptions,
        level: logLevel,
      });
    } catch (error) {
      // Mark file logging as unavailable and record the error
      fileLoggingAvailable = false;
      fileLoggingError =
        error instanceof Error ? error.message : 'Unknown error configuring file transport';
      // Continue with stdout-only logging
    }
  }

  return targets;
}

/**
 * Pino logger configuration
 * - Uses ISO timestamp format
 * - Multi-transport for stdout + rolling files
 * - JSON output in production for log aggregation
 *
 * Note: Custom level formatters are not compatible with multi-transport,
 * so we use pino's default level format (numeric in JSON, string in pretty)
 */
const loggerOptions: LoggerOptions = {
  level: logLevel,

  // Custom timestamp format - ISO 8601
  timestamp: () => `,"time":"${new Date().toISOString()}"`,

  // Base context included in all logs
  base: {
    pid: process.pid,
    env: process.env.NODE_ENV || 'development',
  },

  // Redact sensitive fields from logs
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'apiKey', 'secret'],
    censor: '[REDACTED]',
  },

  // Configure multi-transport
  transport: {
    targets: buildTransportTargets(),
  },
};

/**
 * Root logger instance
 * Use createLogger() to create child loggers with module context
 */
const rootLogger: Logger = pino(loggerOptions);

/**
 * Creates a child logger with module/file context
 * This allows logs to show which part of the application generated them
 *
 * @param module - The name of the module/file (e.g., 'ccxtService', 'tickerController')
 * @returns A child logger with the module context
 *
 * @example
 * const logger = createLogger('ccxtService');
 * logger.info('Exchange initialized');
 * // Output: 2024-01-15 10:30:45.123 INFO ccxtService: Exchange initialized
 */
export function createLogger(module: string): Logger {
  return rootLogger.child({ module });
}

/**
 * Request context interface with request ID for tracing
 */
export interface RequestWithId {
  id: string;
  startTime: number;
}

/**
 * Timer utility for measuring operation duration
 * Returns a function that logs the elapsed time when called
 *
 * @param logger - Logger instance to use
 * @param operation - Name of the operation being timed
 * @returns Function to call when operation completes
 *
 * @example
 * const logger = createLogger('ccxtService');
 * const done = startTimer(logger, 'fetchTickers');
 * await fetchTickers();
 * done(); // Logs: "fetchTickers completed in 150ms"
 */
export function startTimer(
  logger: Logger,
  operation: string
): (additionalContext?: Record<string, unknown>) => void {
  const start = Date.now();
  return (additionalContext?: Record<string, unknown>) => {
    const duration = Date.now() - start;
    logger.info({
      operation,
      duration: `${duration}ms`,
      durationMs: duration,
      ...additionalContext,
      msg: `${operation} completed in ${duration}ms`,
    });
  };
}

/**
 * Logs an error with full context
 * Automatically extracts error details and stack trace
 *
 * @param logger - Logger instance to use
 * @param error - Error object or unknown error
 * @param context - Additional context to include
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logError(logger, error, { exchange: 'binance', symbol: 'BTC/USDT' });
 * }
 */
export function logError(
  logger: Logger,
  error: unknown,
  context?: Record<string, unknown>,
  message?: string
): void {
  const errorObj =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : { message: String(error) };

  const finalMessage = message ?? errorObj.message;

  logger.error({
    err: errorObj,
    ...context,
    msg: finalMessage,
  });
}

/**
 * Creates a logger for a specific service with common context
 * Useful for services that need consistent logging throughout
 *
 * @param serviceName - Name of the service
 * @returns Object with logging methods and timer utility
 *
 * @example
 * const log = createServiceLogger('ccxtService');
 * log.info('Initializing exchange', { exchange: 'binance' });
 * log.debug('Market data loaded', { count: 150 });
 * const done = log.startTimer('fetchTickers');
 * await fetchTickers();
 * done({ tickerCount: 100 });
 */
export function createServiceLogger(serviceName: string) {
  const logger = createLogger(serviceName);

  return {
    debug: (msg: string, context?: Record<string, unknown>) => logger.debug({ ...context, msg }),

    info: (msg: string, context?: Record<string, unknown>) => logger.info({ ...context, msg }),

    warn: (msg: string, context?: Record<string, unknown>) => logger.warn({ ...context, msg }),

    error: (msg: string, error?: unknown, context?: Record<string, unknown>) => {
      if (error) {
        logError(logger, error, context, msg);
      } else {
        logger.error({ ...context, msg });
      }
    },

    fatal: (msg: string, error?: unknown, context?: Record<string, unknown>) => {
      if (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        logger.fatal({ err: errorObj, ...context, msg });
      } else {
        logger.fatal({ ...context, msg });
      }
    },

    startTimer: (operation: string) => startTimer(logger, operation),

    // Get raw pino logger for advanced use cases
    raw: logger,
  };
}

/**
 * Export root logger for direct use if needed
 * Prefer createLogger() or createServiceLogger() for module-specific logging
 */
export const logger = rootLogger;

/**
 * Logger configuration status for health checks and diagnostics.
 * Call logTransportStatus() on startup to confirm logging configuration.
 */
export interface LoggerStatus {
  level: string;
  fileLoggingEnabled: boolean;
  fileLoggingAvailable: boolean;
  fileLoggingError: string | null;
  filePath: string | null;
  fileFrequency: string | null;
  fileSize: string | null;
  fileMaxFiles: number | null;
}

/**
 * Get current logger configuration status.
 * Useful for health checks and diagnostics.
 */
export function getLoggerStatus(): LoggerStatus {
  return {
    level: logLevel,
    fileLoggingEnabled: logFileEnabled,
    fileLoggingAvailable,
    fileLoggingError,
    filePath: logFileEnabled ? path.resolve(logFilePath) : null,
    fileFrequency: logFileEnabled ? logFileFrequency : null,
    fileSize: logFileEnabled && logFileSize ? logFileSize : null,
    fileMaxFiles: logFileEnabled ? logFileMaxFiles : null,
  };
}

/**
 * Log the current transport configuration on startup.
 * Call this once during server initialization to confirm logging is working.
 * Emits a warning if file logging was requested but failed.
 */
export function logTransportStatus(): void {
  const log = createLogger('logger');
  const status = getLoggerStatus();

  // Log successful configuration
  if (status.fileLoggingEnabled && status.fileLoggingAvailable) {
    log.info({
      msg: 'Logger initialized with file transport',
      transports: ['stdout', 'file'],
      filePath: status.filePath,
      frequency: status.fileFrequency,
      size: status.fileSize || 'unlimited',
      maxFiles: status.fileMaxFiles,
    });
  } else if (status.fileLoggingEnabled && !status.fileLoggingAvailable) {
    // File logging was requested but failed - emit warning
    log.warn({
      msg: 'File logging requested but unavailable, falling back to stdout only',
      error: status.fileLoggingError,
      requestedPath: status.filePath,
    });
  } else {
    log.info({
      msg: 'Logger initialized with stdout transport only',
      transports: ['stdout'],
    });
  }
}

/**
 * Export types for TypeScript consumers
 */
export type { Logger };
