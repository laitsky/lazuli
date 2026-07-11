/**
 * Backfill service for Cloudflare-only historical OHLCV archives.
 *
 * D1 stores job/task/manifests metadata. R2 stores the large historical corpus
 * as monthly NDJSON objects so D1 does not become a time-series warehouse.
 */

import type { BackfillQueueMessage, Env, OHLCV, Timeframe } from '../types';
import { ccxtService } from './ccxtService';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

export const DEFAULT_BACKFILL_TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d'];
export const MAX_BACKFILL_ATTEMPTS = 5;
export const MAX_BACKFILL_TASKS = 5_000;
const SUPPORTED_EXCHANGES = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'] as const;
const SUPPORTED_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '3d', '1w'] as const;
const EXCHANGE_CAPABILITIES: Record<string, Array<'spot' | 'perp'>> = {
  binance: ['spot', 'perp'],
  bybit: ['spot', 'perp'],
  okx: ['spot', 'perp'],
  hyperliquid: ['perp'],
  upbit: ['spot'],
};

interface ArchiveWriteResult {
  objectKey: string;
  rowCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  checksum: string;
  gapSummary: string;
}

export interface BackfillJobRequest {
  exchanges?: string[];
  symbols?: string[];
  types?: Array<'spot' | 'perp'>;
  timeframes?: Timeframe[];
  startTime?: number;
  endTime?: number;
  maxSymbolsPerExchange?: number;
}

interface D1StatusCount {
  status: string;
  count: number;
}

interface PreparedUniverse {
  exchanges: Array<(typeof SUPPORTED_EXCHANGES)[number]>;
  timeframes: Timeframe[];
  typesByExchange: Record<string, Array<'spot' | 'perp'>>;
  symbolsByExchangeType: Record<string, string[]>;
  startTime: number;
  endTime: number;
  maxSymbolsPerExchange: number | null;
}

interface TaskRow {
  id: string;
  exchange: string;
  symbol: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  start_time: number;
  end_time: number;
  attempts: number;
}

export const DEFAULT_BACKFILL_START = Date.parse('2019-01-01T00:00:00Z');
export const DEFAULT_BACKFILL_END = Date.now();
export const DEFAULT_BACKFILL_SYMBOL_LIMIT = 50;

export class TerminalBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalBackfillError';
  }
}

export function assertBackfillTaskLimit(taskCount: number): void {
  if (taskCount > MAX_BACKFILL_TASKS) {
    throw new Error(`Backfill request exceeds the ${MAX_BACKFILL_TASKS} task limit`);
  }
}

export function queueRetryDelaySeconds(attempts: number): number {
  const retryIndex = Math.max(0, Math.floor(attempts) - 1);
  return Math.min(300, 10 * 2 ** retryIndex);
}

/**
 * Create a D1-tracked backfill job and enqueue or workflow-trigger the work.
 */
export async function createBackfillJob(
  env: Env,
  request: BackfillJobRequest
): Promise<{
  jobId: string;
  taskCount: number;
  workflowInstanceId: string | null;
}> {
  assertD1(env);

  const universe = await prepareBackfillUniverse(request);
  const jobId = `bf_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const tasks = buildBackfillTasks(jobId, universe);

  if (tasks.length === 0) {
    throw new Error('Backfill request produced no tasks');
  }
  assertBackfillTaskLimit(tasks.length);

  await env.DB.prepare(
    `INSERT INTO backfill_jobs
      (id, status, start_time, end_time, requested_universe_json, created_at, updated_at)
     VALUES (?, 'creating', ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(jobId, universe.startTime, universe.endTime, JSON.stringify(universe))
    .run();

  await insertTasks(env, tasks);
  await env.DB.prepare(
    `UPDATE backfill_jobs
     SET status = 'queued', total_tasks = ?, pending_tasks = ?, updated_at = unixepoch()
     WHERE id = ?`
  )
    .bind(tasks.length, tasks.length, jobId)
    .run();
  await syncBackfillJobStatus(env, jobId);

  let workflowInstanceId: string | null = null;
  if (env.BACKFILL_WORKFLOW) {
    const instance = await env.BACKFILL_WORKFLOW.create({ id: jobId, params: { jobId } });
    workflowInstanceId = instance.id;
  } else if (env.BACKFILL_QUEUE) {
    await sendQueueBatch(env, tasks);
  }

  return { jobId, taskCount: tasks.length, workflowInstanceId };
}

/**
 * Enqueue all pending tasks for an existing job. Used by Workflows and admin
 * retry endpoints, and safe to call repeatedly because task IDs are stable.
 */
export async function enqueuePendingTasks(env: Env, jobId: string): Promise<number> {
  assertD1(env);
  await env.DB.prepare(
    `UPDATE backfill_tasks
     SET status = 'pending', attempts = 0, last_error = NULL, updated_at = unixepoch()
     WHERE job_id = ? AND status = 'failed'`
  )
    .bind(jobId)
    .run();
  await syncBackfillJobStatus(env, jobId);

  const { results } = await env.DB.prepare(
    `SELECT id, exchange, symbol, type, timeframe, start_time, end_time, attempts
     FROM backfill_tasks
     WHERE job_id = ? AND status = 'pending'
     ORDER BY start_time ASC`
  )
    .bind(jobId)
    .all<TaskRow>();

  const messages = results.map((task) => ({
    jobId,
    taskId: task.id,
    exchange: task.exchange as BackfillQueueMessage['exchange'],
    symbol: task.symbol,
    type: task.type,
    timeframe: task.timeframe,
    startTime: task.start_time,
    endTime: task.end_time,
    attempt: task.attempts,
  }));

  await sendQueueBatch(env, messages);
  return messages.length;
}

/**
 * Process one Queue message. It fetches an OHLCV range, writes one canonical R2
 * object, and updates D1 metadata in an idempotent order.
 */
export async function processBackfillMessage(
  env: Env,
  message: BackfillQueueMessage
): Promise<void> {
  assertD1(env);
  if (!env.OHLCV_ARCHIVE) {
    throw new Error('OHLCV_ARCHIVE R2 binding is not configured');
  }

  const task = await env.DB.prepare(`SELECT status, attempts FROM backfill_tasks WHERE id = ?`)
    .bind(message.taskId)
    .first<{ status: string; attempts: number }>();
  if (!task) {
    throw new TerminalBackfillError(`Backfill task '${message.taskId}' does not exist`);
  }
  if (task.status === 'complete') {
    return;
  }
  if (task.status === 'failed') {
    throw new TerminalBackfillError(`Backfill task '${message.taskId}' is already terminal`);
  }
  const nextAttempt = task.attempts + 1;

  await env.DB.prepare(
    `UPDATE backfill_tasks
     SET status = 'running', attempts = ?, updated_at = unixepoch(), last_error = NULL
     WHERE id = ?`
  )
    .bind(nextAttempt, message.taskId)
    .run();
  await syncBackfillJobStatus(env, message.jobId);

  try {
    await acquireRateLimit(env, message.exchange);
    const candles = await fetchOhlcvRange(message);
    const archive = await writeArchiveObject(env, message, candles);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO r2_ohlcv_manifests
          (object_key, exchange, symbol, type, timeframe, first_timestamp, last_timestamp,
           row_count, checksum, source, status, gap_summary_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ccxt', 'complete', ?, unixepoch(), unixepoch())
         ON CONFLICT(object_key) DO UPDATE SET
           row_count = excluded.row_count,
           first_timestamp = excluded.first_timestamp,
           last_timestamp = excluded.last_timestamp,
           checksum = excluded.checksum,
           status = 'complete',
           gap_summary_json = excluded.gap_summary_json,
           updated_at = unixepoch()`
      ).bind(
        archive.objectKey,
        message.exchange,
        message.symbol,
        message.type,
        message.timeframe,
        archive.firstTimestamp,
        archive.lastTimestamp,
        archive.rowCount,
        archive.checksum,
        archive.gapSummary
      ),
      env.DB.prepare(
        `UPDATE backfill_tasks
         SET status = 'complete', object_key = ?, row_count = ?, updated_at = unixepoch()
         WHERE id = ?`
      ).bind(archive.objectKey, archive.rowCount, message.taskId),
    ]);

    await syncBackfillJobStatus(env, message.jobId);
  } catch (error) {
    const terminal = backfillFailureStatus(nextAttempt) === 'failed';
    await env.DB.prepare(
      `UPDATE backfill_tasks
       SET status = ?, last_error = ?, updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        terminal ? 'failed' : 'pending',
        error instanceof Error ? error.message : String(error),
        message.taskId
      )
      .run();
    await syncBackfillJobStatus(env, message.jobId);

    if (terminal) {
      throw new TerminalBackfillError(
        `Backfill task '${message.taskId}' failed after ${nextAttempt} attempts`
      );
    }
    throw error;
  }
}

export async function getBackfillJob(env: Env, jobId: string): Promise<Record<string, unknown>> {
  assertD1(env);
  const job = await env.DB.prepare(`SELECT * FROM backfill_jobs WHERE id = ?`).bind(jobId).first();
  if (!job) {
    throw new Error(`Backfill job '${jobId}' not found`);
  }

  const statusCounts = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM backfill_tasks
     WHERE job_id = ?
     GROUP BY status`
  )
    .bind(jobId)
    .all<D1StatusCount>();

  const failures = await env.DB.prepare(
    `SELECT id, exchange, symbol, timeframe, start_time, end_time, last_error
     FROM backfill_tasks
     WHERE job_id = ? AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT 50`
  )
    .bind(jobId)
    .all();

  const progress = buildProgress(statusCounts.results);

  return {
    job,
    progress,
    statusCounts: statusCounts.results,
    recentFailures: failures.results,
  };
}

export interface ArchivedOhlcvResult {
  candles: OHLCV[];
  archiveObjects: string[];
  missingArchive: boolean;
}

export async function readArchivedOhlcv(
  env: Env,
  exchange: string,
  symbol: string,
  type: 'spot' | 'perp',
  timeframe: Timeframe,
  since?: number,
  until?: number
): Promise<ArchivedOhlcvResult> {
  if (!env.DB || !env.OHLCV_ARCHIVE) {
    return { candles: [], archiveObjects: [], missingArchive: true };
  }

  const lower = since ?? 0;
  const upper = until ?? Number.MAX_SAFE_INTEGER;
  const { results } = await env.DB.prepare(
    `SELECT object_key
     FROM r2_ohlcv_manifests
     WHERE exchange = ?
       AND symbol = ?
       AND type = ?
       AND timeframe = ?
       AND status = 'complete'
       AND last_timestamp >= ?
       AND first_timestamp <= ?
     ORDER BY first_timestamp ASC`
  )
    .bind(exchange, symbol, type, timeframe, lower, upper)
    .all<{ object_key: string }>();

  const candles: OHLCV[] = [];
  const archiveObjects = results.map((manifest) => manifest.object_key);
  for (const manifest of results) {
    const object = await env.OHLCV_ARCHIVE.get(manifest.object_key);
    if (!object) {
      continue;
    }
    const text = await readR2Text(object);
    for (const line of text.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      const row = JSON.parse(line) as {
        t: number;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      };
      if (row.t >= lower && row.t <= upper) {
        candles.push({
          timestamp: row.t,
          open: row.o,
          high: row.h,
          low: row.l,
          close: row.c,
          volume: row.v,
        });
      }
    }
  }

  return {
    candles: dedupeCandles(candles).sort((a, b) => a.timestamp - b.timestamp),
    archiveObjects,
    missingArchive: archiveObjects.length === 0,
  };
}

export async function prepareBackfillUniverse(
  request: BackfillJobRequest
): Promise<PreparedUniverse> {
  const exchanges = parseExchanges(request.exchanges);
  const explicitTypes = request.types ? parseMarketTypes(request.types) : null;
  const timeframes = parseTimeframes(request.timeframes);
  const startTime = request.startTime ?? DEFAULT_BACKFILL_START;
  const endTime = request.endTime ?? DEFAULT_BACKFILL_END;

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new Error('Backfill request requires a valid startTime before endTime');
  }

  const maxSymbolsPerExchange =
    request.maxSymbolsPerExchange === undefined
      ? DEFAULT_BACKFILL_SYMBOL_LIMIT
      : Math.max(1, Math.min(request.maxSymbolsPerExchange, 5_000));
  const symbolsByExchangeType: Record<string, string[]> = {};
  const typesByExchange: Record<string, Array<'spot' | 'perp'>> = {};

  for (const exchange of exchanges) {
    const supportedTypes = EXCHANGE_CAPABILITIES[exchange] ?? [];
    const selectedTypes = explicitTypes ?? supportedTypes;
    const unsupported = selectedTypes.filter((type) => !supportedTypes.includes(type));

    if (unsupported.length > 0) {
      throw new Error(`Exchange '${exchange}' does not support: ${unsupported.join(', ')}`);
    }

    typesByExchange[exchange] = selectedTypes;
    for (const type of selectedTypes) {
      const symbols = request.symbols?.length
        ? normalizeSymbols(request.symbols, maxSymbolsPerExchange)
        : await loadActiveSymbols(exchange, type, maxSymbolsPerExchange);
      symbolsByExchangeType[universeKey(exchange, type)] = symbols;
    }
  }

  return {
    exchanges,
    timeframes,
    typesByExchange,
    symbolsByExchangeType,
    startTime,
    endTime,
    maxSymbolsPerExchange,
  };
}

export function buildBackfillTasks(
  jobId: string,
  universe: PreparedUniverse
): BackfillQueueMessage[] {
  const tasks: BackfillQueueMessage[] = [];

  for (const exchange of universe.exchanges) {
    for (const type of universe.typesByExchange[exchange] ?? []) {
      const symbols = universe.symbolsByExchangeType[universeKey(exchange, type)] ?? [];

      for (const symbol of symbols) {
        for (const timeframe of universe.timeframes) {
          for (const month of splitMonths(universe.startTime, universe.endTime)) {
            tasks.push({
              jobId,
              taskId: `${jobId}:${exchange}:${type}:${timeframe}:${symbol}:${month.start}`,
              exchange,
              symbol,
              type,
              timeframe,
              startTime: month.start,
              endTime: month.end,
            });
          }
        }
      }
    }
  }

  return tasks;
}

export function backfillFailureStatus(attempts: number): 'pending' | 'failed' {
  return attempts >= MAX_BACKFILL_ATTEMPTS ? 'failed' : 'pending';
}

async function loadActiveSymbols(
  exchange: string,
  type: 'spot' | 'perp',
  maxSymbols: number | null
): Promise<string[]> {
  const markets = await ccxtService.getMarkets(exchange);
  const activeSymbols = markets
    .filter((market) => market.type === type && market.active)
    .map((market) => market.symbol);
  if (maxSymbols === null) return activeSymbols;

  try {
    const tickers = await ccxtService.getAllTickers(exchange);
    const activeSet = new Set(activeSymbols);
    const ranked = tickers
      .filter((ticker) => ticker.type === type && activeSet.has(ticker.symbol))
      .sort(
        (a, b) => (b.quoteVolume24h ?? b.volume24h ?? 0) - (a.quoteVolume24h ?? a.volume24h ?? 0)
      )
      .map((ticker) => ticker.symbol);
    if (ranked.length > 0) {
      return ranked.slice(0, maxSymbols);
    }
  } catch {
    // If ticker ranking is unavailable, preserve progress with the exchange's
    // active market order instead of failing the whole backfill creation.
  }

  return activeSymbols.slice(0, maxSymbols);
}

async function fetchOhlcvRange(message: BackfillQueueMessage): Promise<OHLCV[]> {
  const timeframeMs = TIMEFRAME_MS[message.timeframe];
  const candles: OHLCV[] = [];
  let cursor = message.startTime;
  let pages = 0;

  while (cursor <= message.endTime && pages < 250) {
    const remaining = Math.ceil((message.endTime - cursor + timeframeMs) / timeframeMs);
    const limit = Math.max(1, Math.min(1000, remaining));
    const batch = await ccxtService.fetchOHLCV(
      message.exchange,
      message.symbol,
      message.timeframe,
      message.type,
      limit,
      cursor
    );

    const filtered = batch.filter(
      (candle) => candle.timestamp >= message.startTime && candle.timestamp <= message.endTime
    );
    candles.push(...filtered);

    if (batch.length === 0) {
      break;
    }

    const lastTimestamp = batch[batch.length - 1]?.timestamp;
    if (!lastTimestamp || lastTimestamp < cursor) {
      break;
    }

    cursor = lastTimestamp + timeframeMs;
    pages += 1;
  }

  return dedupeCandles(candles).sort((a, b) => a.timestamp - b.timestamp);
}

async function writeArchiveObject(
  env: Env,
  message: BackfillQueueMessage,
  candles: OHLCV[]
): Promise<ArchiveWriteResult> {
  const objectKey = archiveKey(message);
  const ndjson = candles
    .map((candle) =>
      JSON.stringify({
        t: candle.timestamp,
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: candle.volume,
      })
    )
    .join('\n');
  const body = ndjson.length > 0 ? `${ndjson}\n` : '';
  const checksum = await sha256Hex(body);
  const gapSummary = JSON.stringify(summarizeGaps(candles, TIMEFRAME_MS[message.timeframe]));

  await env.OHLCV_ARCHIVE.put(objectKey, await gzipText(body), {
    httpMetadata: {
      contentType: 'application/x-ndjson; charset=utf-8',
      contentEncoding: 'gzip',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      checksum,
      exchange: message.exchange,
      symbol: message.symbol,
      timeframe: message.timeframe,
      type: message.type,
    },
  });

  return {
    objectKey,
    rowCount: candles.length,
    firstTimestamp: candles[0]?.timestamp ?? null,
    lastTimestamp: candles[candles.length - 1]?.timestamp ?? null,
    checksum,
    gapSummary,
  };
}

export function archiveKey(message: BackfillQueueMessage): string {
  const date = new Date(message.startTime);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return [
    'ohlcv/v1',
    `exchange=${message.exchange}`,
    `type=${message.type}`,
    `timeframe=${message.timeframe}`,
    `symbol=${encodeURIComponent(message.symbol)}`,
    `year=${year}`,
    `month=${month}.ndjson.gz`,
  ].join('/');
}

export function splitMonths(
  startTime: number,
  endTime: number
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = Date.UTC(new Date(startTime).getUTCFullYear(), new Date(startTime).getUTCMonth(), 1);

  while (cursor <= endTime) {
    const date = new Date(cursor);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    ranges.push({
      start: Math.max(cursor, startTime),
      end: Math.min(nextMonth - 1, endTime),
    });
    cursor = nextMonth;
  }

  return ranges;
}

async function insertTasks(env: Env, tasks: BackfillQueueMessage[]): Promise<void> {
  for (let index = 0; index < tasks.length; index += 100) {
    const statements = tasks.slice(index, index + 100).map((task) =>
      env.DB.prepare(
        `INSERT INTO backfill_tasks
          (id, job_id, status, exchange, symbol, type, timeframe, start_time, end_time, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
         ON CONFLICT(id) DO NOTHING`
      ).bind(
        task.taskId,
        task.jobId,
        task.exchange,
        task.symbol,
        task.type,
        task.timeframe,
        task.startTime,
        task.endTime
      )
    );
    await env.DB.batch(statements);
  }
}

async function sendQueueBatch(env: Env, messages: BackfillQueueMessage[]): Promise<void> {
  if (!env.BACKFILL_QUEUE || messages.length === 0) {
    return;
  }

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((body) => ({ body }));
    await env.BACKFILL_QUEUE.sendBatch(chunk);
  }
}

async function acquireRateLimit(env: Env, exchange: string): Promise<void> {
  if (!env.EXCHANGE_RATE_LIMITER) {
    return;
  }

  const outcome = await env.EXCHANGE_RATE_LIMITER.limit({ key: exchange });
  if (!outcome.success) {
    throw new Error('Exchange rate limiter busy; retry after 10000ms');
  }
}

async function syncBackfillJobStatus(env: Env, jobId: string): Promise<void> {
  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM backfill_tasks
     WHERE job_id = ?
     GROUP BY status`
  )
    .bind(jobId)
    .all<D1StatusCount>();
  const progress = buildProgress(counts.results);
  const status =
    progress.failed > 0
      ? 'failed'
      : progress.running > 0
        ? 'running'
        : progress.pending > 0
          ? 'queued'
          : 'complete';

  await env.DB.prepare(
    `UPDATE backfill_jobs
     SET status = ?,
         total_tasks = ?,
         pending_tasks = ?,
         completed_tasks = ?,
         failed_tasks = ?,
         updated_at = unixepoch()
     WHERE id = ?`
  )
    .bind(status, progress.total, progress.pending, progress.complete, progress.failed, jobId)
    .run();
}

function buildProgress(rows: D1StatusCount[]): {
  total: number;
  pending: number;
  running: number;
  complete: number;
  failed: number;
} {
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const pending = counts.get('pending') ?? 0;
  const running = counts.get('running') ?? 0;
  const complete = counts.get('complete') ?? 0;
  const failed = counts.get('failed') ?? 0;
  return {
    total: pending + running + complete + failed + (counts.get('cancelled') ?? 0),
    pending,
    running,
    complete,
    failed,
  };
}

function dedupeCandles(candles: OHLCV[]): OHLCV[] {
  return Array.from(new Map(candles.map((candle) => [candle.timestamp, candle])).values());
}

function summarizeGaps(
  candles: OHLCV[],
  expectedStepMs: number
): {
  gaps: number;
  largestGapMs: number;
} {
  let gaps = 0;
  let largestGapMs = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1];
    const current = candles[i];
    if (!previous || !current) {
      continue;
    }
    const gap = current.timestamp - previous.timestamp;
    if (gap > expectedStepMs) {
      gaps += 1;
      largestGapMs = Math.max(largestGapMs, gap);
    }
  }

  return { gaps, largestGapMs };
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function gzipText(value: string): Promise<ReadableStream<Uint8Array>> {
  return new Blob([value]).stream().pipeThrough(new CompressionStream('gzip'));
}

export async function gzipNdjsonForTest(value: string): Promise<string> {
  const compressed = await new Response(await gzipText(value)).arrayBuffer();
  return new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  ).text();
}

async function readR2Text(object: R2ObjectBody): Promise<string> {
  if (object.httpMetadata?.contentEncoding === 'gzip') {
    return new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return object.text();
}

function parseExchanges(value: string[] | undefined): Array<(typeof SUPPORTED_EXCHANGES)[number]> {
  const exchanges = value?.length
    ? value.map((item) => String(item).toLowerCase())
    : [...SUPPORTED_EXCHANGES];

  for (const exchange of exchanges) {
    if (!SUPPORTED_EXCHANGES.includes(exchange as (typeof SUPPORTED_EXCHANGES)[number])) {
      throw new Error(`Unsupported exchange '${exchange}'`);
    }
  }

  return Array.from(new Set(exchanges)) as Array<(typeof SUPPORTED_EXCHANGES)[number]>;
}

function parseMarketTypes(value: Array<'spot' | 'perp'>): Array<'spot' | 'perp'> {
  const types = value.map((item) => String(item).toLowerCase());
  for (const type of types) {
    if (type !== 'spot' && type !== 'perp') {
      throw new Error(`Unsupported market type '${type}'`);
    }
  }
  return Array.from(new Set(types)) as Array<'spot' | 'perp'>;
}

function parseTimeframes(value: Timeframe[] | undefined): Timeframe[] {
  const timeframes = value?.length ? value : DEFAULT_BACKFILL_TIMEFRAMES;
  for (const timeframe of timeframes) {
    if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
      throw new Error(`Unsupported timeframe '${timeframe}'`);
    }
  }
  return Array.from(new Set(timeframes));
}

function normalizeSymbols(symbols: string[], maxSymbols: number | null): string[] {
  const normalized = Array.from(
    new Set(symbols.map((symbol) => String(symbol).trim()).filter(Boolean))
  );
  return maxSymbols === null ? normalized : normalized.slice(0, maxSymbols);
}

function universeKey(exchange: string, type: 'spot' | 'perp'): string {
  return `${exchange}:${type}`;
}

function assertD1(env: Env): void {
  if (!env.DB) {
    throw new Error('DB D1 binding is not configured');
  }
}
