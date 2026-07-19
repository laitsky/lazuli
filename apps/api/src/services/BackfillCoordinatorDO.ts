import { DurableObject } from 'cloudflare:workers';
import type { BackfillQueueMessage, Env, HistoricalBackfillQueueMessage } from '../types';
import {
  processBackfillMessage,
  RetryableBackfillError,
  TerminalBackfillError,
} from './backfillService';
import { ccxtService } from './ccxtService';
import { getActiveFaultInjection } from './faultInjectionService';
import {
  claimDailyHistoricalAttempt,
  processHistoricalMessage,
  RetryableHistoricalError,
  TerminalHistoricalError,
} from './historicalDataService';

type CoordinatedMessage = BackfillQueueMessage | HistoricalBackfillQueueMessage;

const CIRCUIT_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000;

interface CoordinatorState {
  consecutiveFailures: number;
  openUntil: number;
  nextAllowedAt: number;
}

interface CoordinatorFailure {
  error: string;
  terminal: boolean;
  delaySeconds: number;
  failureClass: string;
}

export class BackfillCoordinatorDO extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve();
  private state: CoordinatorState = { consecutiveFailures: 0, openUntil: 0, nextAllowedAt: 0 };
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state =
        (await ctx.storage.get<CoordinatorState>('backfill-coordinator-state')) ?? this.state;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/health') {
      await this.ready;
      return Response.json({ ok: true, ...this.state });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/process') {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const message = (await request.json()) as CoordinatedMessage;
    const work = this.tail.then(
      () => this.process(message),
      () => this.process(message)
    );
    this.tail = work.then(
      () => undefined,
      () => undefined
    );
    return work;
  }

  private async process(message: CoordinatedMessage): Promise<Response> {
    await this.ready;
    const now = Date.now();
    if (this.state.openUntil > now) {
      return Response.json(
        {
          error: `Provider circuit is open for '${providerKey(message)}'`,
          terminal: false,
          delaySeconds: Math.max(1, Math.ceil((this.state.openUntil - now) / 1_000)),
          failureClass: 'provider_unavailable',
        } satisfies CoordinatorFailure,
        { status: 429 }
      );
    }

    try {
      const providerFault = await getActiveFaultInjection(this.env, 'provider');
      if (providerFault) {
        const configuredDelay = Number(providerFault.config.retryAfterSeconds);
        const retryAfterSeconds = Number.isFinite(configuredDelay)
          ? Math.max(1, Math.min(1_800, Math.ceil(configuredDelay)))
          : 30;
        throw new RetryableBackfillError(
          `Staging provider 429 fault injected for '${providerKey(message)}'`,
          retryAfterSeconds,
          'provider_rate_limit'
        );
      }
      if (isHistoricalMessage(message)) {
        await processHistoricalMessage(this.env, message, () => this.pace(message));
      } else {
        await processBackfillMessage(this.env, message, () => this.pace(message));
      }
      this.state.consecutiveFailures = 0;
      this.state.openUntil = 0;
      await this.persist();
      return Response.json({ ok: true });
    } catch (error) {
      if (error instanceof TerminalBackfillError || error instanceof TerminalHistoricalError) {
        return Response.json(
          {
            error: error.message,
            terminal: true,
            delaySeconds: 0,
            failureClass: 'terminal',
          } satisfies CoordinatorFailure,
          { status: 422 }
        );
      }

      const retryable =
        error instanceof RetryableBackfillError || error instanceof RetryableHistoricalError
          ? error
          : new RetryableBackfillError(
              error instanceof Error ? error.message : String(error),
              10,
              'internal'
            );
      if (retryable.failureClass.startsWith('provider_')) {
        this.state.consecutiveFailures += 1;
        if (this.state.consecutiveFailures >= CIRCUIT_FAILURES) {
          this.state.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        }
      }
      await this.persist();
      return Response.json(
        {
          error: retryable.message,
          terminal: false,
          delaySeconds: Math.max(
            retryable.delaySeconds,
            Math.ceil(Math.max(0, this.state.openUntil - Date.now()) / 1_000)
          ),
          failureClass: retryable.failureClass,
        } satisfies CoordinatorFailure,
        { status: 429 }
      );
    }
  }

  private async pace(message: CoordinatedMessage): Promise<void> {
    const now = Date.now();
    if (this.state.nextAllowedAt > now) {
      await new Promise((resolve) => setTimeout(resolve, this.state.nextAllowedAt - now));
    }
    const intervalMs = Math.max(
      1_000,
      isHistoricalMessage(message) && !message.exchange
        ? 1_000
        : ccxtService.getExchangeRateLimitMs(
            message.exchange!,
            isHistoricalMessage(message)
              ? (message.marketType ?? (message.exchange === 'hyperliquid' ? 'perp' : 'spot'))
              : message.type
          )
    );
    this.state.nextAllowedAt = Date.now() + intervalMs;
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.ctx.storage.put('backfill-coordinator-state', this.state);
  }
}

export class CoordinatorBackfillError extends Error {
  constructor(
    message: string,
    readonly terminal: boolean,
    readonly delaySeconds: number
  ) {
    super(message);
    this.name = 'CoordinatorBackfillError';
  }
}

export async function processCoordinatedBackfill(
  env: Env,
  message: CoordinatedMessage
): Promise<void> {
  const coordinatedMessage = isHistoricalMessage(message)
    ? { ...message, dailyAttemptReserved: true }
    : message;
  if (isHistoricalMessage(message) && !(await claimDailyHistoricalAttempt(env, message))) return;
  if (!env.BACKFILL_COORDINATOR) {
    if (isHistoricalMessage(coordinatedMessage))
      await processHistoricalMessage(env, coordinatedMessage);
    else await processBackfillMessage(env, coordinatedMessage);
    return;
  }
  const id = env.BACKFILL_COORDINATOR.idFromName(providerKey(coordinatedMessage));
  const response = await env.BACKFILL_COORDINATOR.get(id).fetch('https://coordinator/process', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(coordinatedMessage),
  });
  if (response.ok) return;
  const body = (await response.json()) as CoordinatorFailure;
  throw new CoordinatorBackfillError(
    body.error || 'Backfill coordinator failed',
    body.terminal,
    body.delaySeconds || 10
  );
}

function isHistoricalMessage(
  message: CoordinatedMessage
): message is HistoricalBackfillQueueMessage {
  return 'kind' in message && message.kind === 'history-backfill';
}

function providerKey(message: CoordinatedMessage): string {
  return isHistoricalMessage(message) ? message.provider : message.exchange;
}
