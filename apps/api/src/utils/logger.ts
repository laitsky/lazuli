/**
 * Workers-compatible logging utility.
 *
 * Replaces the previous Pino-based logger. On Cloudflare Workers we use
 * console.log / console.error with structured context objects. Observability
 * is handled by `wrangler tail` and the Workers dashboard.
 */

/**
 * Shape returned by createServiceLogger. Matches the subset of the old Pino
 * logger surface that the rest of the codebase calls.
 */
export interface ServiceLogger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, error?: unknown, context?: Record<string, unknown>): void;
  fatal(msg: string, error?: unknown, context?: Record<string, unknown>): void;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

/**
 * Creates a logger scoped to a service/module name. All emitted lines include
 * the `module` field so they can be filtered in wrangler tail output.
 */
export function createServiceLogger(module: string): ServiceLogger {
  return {
    debug(msg, context) {
      console.debug(JSON.stringify({ level: 'debug', module, msg, ...context }));
    },
    info(msg, context) {
      console.log(JSON.stringify({ level: 'info', module, msg, ...context }));
    },
    warn(msg, context) {
      console.warn(JSON.stringify({ level: 'warn', module, msg, ...context }));
    },
    error(msg, error?, context?) {
      const payload: Record<string, unknown> = { level: 'error', module, msg, ...context };
      if (error !== undefined) {
        payload.err = serializeError(error);
      }
      console.error(JSON.stringify(payload));
    },
    fatal(msg, error?, context?) {
      const payload: Record<string, unknown> = { level: 'fatal', module, msg, ...context };
      if (error !== undefined) {
        payload.err = serializeError(error);
      }
      console.error(JSON.stringify(payload));
    },
  };
}

/**
 * No-op kept for backward compatibility with call sites that invoked
 * logTransportStatus() during the Bun/Pino era. On Workers there are no
 * transport targets to configure.
 */
export function logTransportStatus(): void {
  // intentionally empty
}
