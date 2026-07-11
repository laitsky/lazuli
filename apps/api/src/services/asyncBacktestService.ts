import type {
  AsyncBacktestJob,
  AsyncBacktestJobRequest,
  AsyncBacktestResultSummary,
  BacktestResponse,
  BacktestTrade,
  OHLCV,
  StrategyDefinition,
} from '@lazuli/shared';
import type { AsyncBacktestQueueMessage, Env } from '../types';

const CHECKPOINT_VERSION = 1;
const MAX_ARCHIVE_OBJECTS = 2_000;
const MAX_ROWS_PER_ARCHIVE_OBJECT = 60_000;
const JOB_PREFIX = 'backtests/v1/jobs';

interface ArchiveManifest {
  key: string;
  rowCount: number;
}

interface StoredRequest extends AsyncBacktestJobRequest {
  archiveObjects: ArchiveManifest[];
}

interface EmaState {
  seed: number[];
  value: number | null;
}

interface RsiState {
  previousClose: number | null;
  averageGain: number;
  averageLoss: number;
  initialized: boolean;
}

interface BacktestCheckpoint {
  version: number;
  nextChunkIndex: number;
  candleCount: number;
  processedRows: number;
  lastTimestamp: number | null;
  fast: EmaState;
  slow: EmaState;
  rsi: RsiState;
  previousFast: number | null;
  previousSlow: number | null;
  position: {
    direction: 'long' | 'short';
    entryPrice: number;
    entryTime: number;
  } | null;
  equity: number;
  peak: number;
  maxDrawdownPercent: number;
  returnCount: number;
  returnSum: number;
  returnSquares: number;
  wins: number;
  grossWin: number;
  grossLoss: number;
  tradeCount: number;
  equityPointCount: number;
}

interface ChunkOutput {
  equityCurve: BacktestResponse['equityCurve'];
  trades: BacktestTrade[];
}

interface AsyncBacktestJobRow {
  id: string;
  user_id: string;
  status: AsyncBacktestJob['status'];
  exchange: AsyncBacktestJob['exchange'];
  symbol: string;
  market_type: AsyncBacktestJob['marketType'];
  timeframe: AsyncBacktestJob['timeframe'];
  start_time: number;
  end_time: number;
  request_json: string;
  progress: number;
  processed_rows: number;
  total_rows: number | null;
  result_object_key: string | null;
  result_summary_json: string | null;
  last_error: string | null;
  cancel_requested_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ManifestRow {
  object_key: string;
  row_count: number;
}

export class TerminalAsyncBacktestError extends Error {}

/**
 * Create or retrieve a job by owner-scoped idempotency key and enqueue its first
 * monthly R2 partition. D1 remains the source of truth for ownership and status.
 */
export async function createAsyncBacktestJob(
  env: Env,
  userId: string,
  request: AsyncBacktestJobRequest,
  idempotencyKey: string
): Promise<AsyncBacktestJob> {
  assertBindings(env);
  const scopedKey = `${userId}:${idempotencyKey}`;
  const existing = await env.DB.prepare(
    `SELECT * FROM async_backtest_jobs WHERE idempotency_key = ?`
  )
    .bind(scopedKey)
    .first<AsyncBacktestJobRow>();
  if (existing) {
    await ensureInitialJobQueued(env, existing);
    return mapJob(existing);
  }

  const manifests = await env.DB.prepare(
    `SELECT object_key, row_count
     FROM r2_ohlcv_manifests
     WHERE exchange = ? AND symbol = ? AND type = ? AND timeframe = ?
       AND status = 'complete' AND last_timestamp >= ? AND first_timestamp <= ?
     ORDER BY first_timestamp ASC
     LIMIT ?`
  )
    .bind(
      request.exchange,
      request.symbol,
      request.marketType,
      request.timeframe,
      request.startTime,
      request.endTime,
      MAX_ARCHIVE_OBJECTS + 1
    )
    .all<ManifestRow>();

  if (manifests.results.length === 0) {
    throw new TerminalAsyncBacktestError('No completed OHLCV archive covers this request');
  }
  if (manifests.results.length > MAX_ARCHIVE_OBJECTS) {
    throw new TerminalAsyncBacktestError(
      `Backtest exceeds the ${MAX_ARCHIVE_OBJECTS} archive-partition limit`
    );
  }

  const archiveObjects = manifests.results.map((row) => ({
    key: row.object_key,
    rowCount: Number(row.row_count),
  }));
  const totalRows = archiveObjects.reduce((sum, item) => sum + item.rowCount, 0);
  const jobId = `abt_${crypto.randomUUID()}`;
  const storedRequest: StoredRequest = { ...request, idempotencyKey: undefined, archiveObjects };

  await env.DB.prepare(
    `INSERT INTO async_backtest_jobs
       (id, user_id, strategy_id, saved_backtest_id, idempotency_key, status,
        exchange, symbol, market_type, timeframe, start_time, end_time,
        request_json, total_rows, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
     ON CONFLICT(idempotency_key) DO NOTHING`
  )
    .bind(
      jobId,
      userId,
      request.strategyId ?? null,
      request.savedBacktestId ?? null,
      scopedKey,
      request.exchange,
      request.symbol,
      request.marketType,
      request.timeframe,
      request.startTime,
      request.endTime,
      JSON.stringify(storedRequest),
      totalRows
    )
    .run();

  const created = await env.DB.prepare(
    `SELECT * FROM async_backtest_jobs WHERE idempotency_key = ?`
  )
    .bind(scopedKey)
    .first<AsyncBacktestJobRow>();
  if (!created) throw new Error('Async backtest job could not be created');

  await ensureInitialJobQueued(env, created);
  return mapJob(created);
}

export async function getAsyncBacktestJob(
  env: Env,
  userId: string,
  jobId: string
): Promise<AsyncBacktestJob | null> {
  const row = await env.DB.prepare(`SELECT * FROM async_backtest_jobs WHERE id = ? AND user_id = ?`)
    .bind(jobId, userId)
    .first<AsyncBacktestJobRow>();
  return row ? mapJob(row) : null;
}

export async function cancelAsyncBacktestJob(
  env: Env,
  userId: string,
  jobId: string
): Promise<AsyncBacktestJob | null> {
  await env.DB.prepare(
    `UPDATE async_backtest_jobs
     SET cancel_requested_at = COALESCE(cancel_requested_at, unixepoch()),
         status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
         completed_at = CASE WHEN status = 'queued' THEN unixepoch() ELSE completed_at END,
         updated_at = unixepoch()
     WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')`
  )
    .bind(jobId, userId)
    .run();
  return getAsyncBacktestJob(env, userId, jobId);
}

export async function getAsyncBacktestResultObject(
  env: Env,
  userId: string,
  jobId: string
): Promise<R2ObjectBody | null> {
  const row = await env.DB.prepare(
    `SELECT result_object_key FROM async_backtest_jobs
     WHERE id = ? AND user_id = ? AND status = 'complete'`
  )
    .bind(jobId, userId)
    .first<{ result_object_key: string | null }>();
  return row?.result_object_key ? env.OHLCV_ARCHIVE.get(row.result_object_key) : null;
}

/** Process exactly one manifest object and persist a restart-safe checkpoint. */
export async function processAsyncBacktestMessage(
  env: Env,
  message: AsyncBacktestQueueMessage
): Promise<void> {
  assertBindings(env);
  const row = await env.DB.prepare(`SELECT * FROM async_backtest_jobs WHERE id = ?`)
    .bind(message.jobId)
    .first<AsyncBacktestJobRow>();
  if (!row) throw new TerminalAsyncBacktestError(`Async backtest '${message.jobId}' not found`);
  if (row.status === 'complete' || row.status === 'cancelled') return;
  if (row.status === 'failed') {
    throw new TerminalAsyncBacktestError(`Async backtest '${message.jobId}' is terminal`);
  }
  if (row.cancel_requested_at !== null) {
    await markCancelled(env, row.id);
    return;
  }

  const request = parseStoredRequest(row.request_json);
  let checkpoint = await readCheckpoint(env, row.id);
  if (checkpoint.nextChunkIndex > message.chunkIndex) {
    await resumeFromCheckpoint(env, row, request, checkpoint);
    return;
  }
  if (checkpoint.nextChunkIndex < message.chunkIndex) {
    throw new Error(`Async backtest chunk ${message.chunkIndex} arrived before its predecessor`);
  }

  const manifest = request.archiveObjects[message.chunkIndex];
  if (!manifest) {
    await finalizeJob(env, row, request, checkpoint);
    return;
  }
  if (manifest.rowCount > MAX_ROWS_PER_ARCHIVE_OBJECT) {
    throw new TerminalAsyncBacktestError(
      `Archive partition '${manifest.key}' exceeds ${MAX_ROWS_PER_ARCHIVE_OBJECT} rows`
    );
  }

  await env.DB.prepare(
    `UPDATE async_backtest_jobs
     SET status = 'running', started_at = COALESCE(started_at, unixepoch()),
         last_error = NULL, updated_at = unixepoch()
     WHERE id = ? AND status IN ('queued', 'running')`
  )
    .bind(row.id)
    .run();

  const object = await env.OHLCV_ARCHIVE.get(manifest.key);
  if (!object) throw new Error(`Archive object '${manifest.key}' is unavailable`);
  const output: ChunkOutput = { equityCurve: [], trades: [] };
  let rowsSeen = 0;
  for await (const candle of readArchiveCandles(object)) {
    rowsSeen += 1;
    if (rowsSeen > MAX_ROWS_PER_ARCHIVE_OBJECT) {
      throw new TerminalAsyncBacktestError(
        `Archive partition '${manifest.key}' exceeds ${MAX_ROWS_PER_ARCHIVE_OBJECT} rows`
      );
    }
    if (candle.timestamp < request.startTime || candle.timestamp > request.endTime) continue;
    if (checkpoint.lastTimestamp !== null && candle.timestamp <= checkpoint.lastTimestamp) continue;
    checkpoint = applyCandle(checkpoint, request.strategy, candle, output);
  }

  checkpoint.nextChunkIndex += 1;
  await env.OHLCV_ARCHIVE.put(partialKey(row.id, message.chunkIndex), JSON.stringify(output), {
    httpMetadata: { contentType: 'application/json' },
  });
  await writeCheckpoint(env, row.id, checkpoint);

  const progress = checkpoint.nextChunkIndex / request.archiveObjects.length;
  await env.DB.prepare(
    `UPDATE async_backtest_jobs
     SET progress = ?, processed_rows = ?, updated_at = unixepoch()
     WHERE id = ? AND status = 'running'`
  )
    .bind(Math.min(1, progress), checkpoint.processedRows, row.id)
    .run();

  const cancellation = await env.DB.prepare(
    `SELECT cancel_requested_at FROM async_backtest_jobs WHERE id = ?`
  )
    .bind(row.id)
    .first<{ cancel_requested_at: number | null }>();
  if (cancellation && cancellation.cancel_requested_at !== null) {
    await markCancelled(env, row.id);
  } else if (checkpoint.nextChunkIndex >= request.archiveObjects.length) {
    await finalizeJob(env, row, request, checkpoint);
  } else {
    await sendNextChunk(env, row.id, checkpoint.nextChunkIndex);
  }
}

export async function failAsyncBacktestJob(env: Env, jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(
    `UPDATE async_backtest_jobs
     SET status = 'failed', last_error = ?, completed_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND status IN ('queued', 'running')`
  )
    .bind(message.slice(0, 1_000), jobId)
    .run();
}

function applyCandle(
  checkpoint: BacktestCheckpoint,
  strategy: StrategyDefinition,
  candle: OHLCV,
  output: ChunkOutput
): BacktestCheckpoint {
  const index = checkpoint.candleCount;
  const currentFast = updateEma(checkpoint.fast, candle.close, strategy.fastPeriod);
  const currentSlow = updateEma(checkpoint.slow, candle.close, strategy.slowPeriod);
  const currentRsi = updateRsi(checkpoint.rsi, candle.close, strategy.rsiPeriod, index);

  if (
    index >= 1 &&
    checkpoint.previousFast !== null &&
    checkpoint.previousSlow !== null &&
    currentFast !== null &&
    currentSlow !== null
  ) {
    const entry = shouldEnter(strategy, {
      previousFast: checkpoint.previousFast,
      previousSlow: checkpoint.previousSlow,
      currentFast,
      currentSlow,
      rsi: currentRsi,
      candle,
    });
    const exit = shouldExit(strategy, {
      previousFast: checkpoint.previousFast,
      previousSlow: checkpoint.previousSlow,
      currentFast,
      currentSlow,
      rsi: currentRsi,
    });

    if (!checkpoint.position && entry) {
      checkpoint.position = {
        direction: entry,
        entryPrice: candle.close,
        entryTime: candle.timestamp,
      };
    } else if (checkpoint.position && exit) {
      const rawPnl =
        checkpoint.position.direction === 'long'
          ? (candle.close - checkpoint.position.entryPrice) / checkpoint.position.entryPrice
          : (checkpoint.position.entryPrice - candle.close) / checkpoint.position.entryPrice;
      const pnlPercent = (rawPnl - (strategy.feeBps / 10_000) * 2) * 100;
      checkpoint.equity *= 1 + pnlPercent / 100;
      output.trades.push({
        entryTime: checkpoint.position.entryTime,
        exitTime: candle.timestamp,
        direction: checkpoint.position.direction,
        entryPrice: checkpoint.position.entryPrice,
        exitPrice: candle.close,
        pnlPercent,
        reason: 'strategy-exit',
      });
      checkpoint.position = null;
      checkpoint.returnCount += 1;
      checkpoint.returnSum += pnlPercent;
      checkpoint.returnSquares += pnlPercent * pnlPercent;
      checkpoint.tradeCount += 1;
      if (pnlPercent > 0) {
        checkpoint.wins += 1;
        checkpoint.grossWin += pnlPercent;
      } else if (pnlPercent < 0) {
        checkpoint.grossLoss += Math.abs(pnlPercent);
      }
    }

    checkpoint.peak = Math.max(checkpoint.peak, checkpoint.equity);
    output.equityCurve.push({
      timestamp: candle.timestamp,
      equity: checkpoint.equity,
      drawdownPercent:
        checkpoint.peak > 0 ? ((checkpoint.equity - checkpoint.peak) / checkpoint.peak) * 100 : 0,
    });
    checkpoint.maxDrawdownPercent = Math.min(
      checkpoint.maxDrawdownPercent,
      output.equityCurve.at(-1)?.drawdownPercent ?? 0
    );
    checkpoint.equityPointCount += 1;
  }

  checkpoint.previousFast = currentFast;
  checkpoint.previousSlow = currentSlow;
  checkpoint.candleCount += 1;
  checkpoint.processedRows += 1;
  checkpoint.lastTimestamp = candle.timestamp;
  return checkpoint;
}

function updateEma(state: EmaState, close: number, period: number): number | null {
  if (state.value === null) {
    state.seed.push(close);
    if (state.seed.length < period) return null;
    state.value = state.seed.reduce((sum, value) => sum + value, 0) / period;
    state.seed = [];
    return state.value;
  }
  state.value = (close - state.value) * (2 / (period + 1)) + state.value;
  return state.value;
}

function updateRsi(state: RsiState, close: number, period: number, index: number): number | null {
  if (state.previousClose === null) {
    state.previousClose = close;
    return null;
  }
  const change = close - state.previousClose;
  state.previousClose = close;
  const gain = Math.max(0, change);
  const loss = Math.max(0, -change);
  if (index <= period) {
    state.averageGain += gain;
    state.averageLoss += loss;
    if (index === period) {
      state.averageGain /= period;
      state.averageLoss /= period;
      state.initialized = true;
    }
    return null;
  }
  state.averageGain = (state.averageGain * (period - 1) + gain) / period;
  state.averageLoss = (state.averageLoss * (period - 1) + loss) / period;
  const relativeStrength =
    state.averageLoss === 0 ? Number.POSITIVE_INFINITY : state.averageGain / state.averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function shouldEnter(
  strategy: StrategyDefinition,
  input: {
    previousFast: number;
    previousSlow: number;
    currentFast: number;
    currentSlow: number;
    rsi: number | null;
    candle: OHLCV;
  }
): 'long' | 'short' | null {
  if (strategy.mode === 'momentum') {
    return input.previousFast <= input.previousSlow && input.currentFast > input.currentSlow
      ? 'long'
      : null;
  }
  if (strategy.mode === 'breakout') {
    return input.currentFast > input.currentSlow && input.candle.close >= input.candle.high * 0.995
      ? 'long'
      : null;
  }
  if (input.rsi !== null && input.rsi <= strategy.rsiOversold) return 'long';
  if (input.rsi !== null && input.rsi >= strategy.rsiOverbought) return 'short';
  return null;
}

function shouldExit(
  strategy: StrategyDefinition,
  input: {
    previousFast: number;
    previousSlow: number;
    currentFast: number;
    currentSlow: number;
    rsi: number | null;
  }
): boolean {
  if (strategy.mode === 'momentum' || strategy.mode === 'breakout') {
    return input.previousFast >= input.previousSlow && input.currentFast < input.currentSlow;
  }
  return input.rsi !== null && input.rsi > 45 && input.rsi < 55;
}

async function finalizeJob(
  env: Env,
  row: AsyncBacktestJobRow,
  request: StoredRequest,
  checkpoint: BacktestCheckpoint
): Promise<void> {
  const metrics = buildMetrics(checkpoint);
  const resultKey = `${JOB_PREFIX}/${row.user_id}/${row.id}/result.json`;
  const timestamp = Date.now();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  const put = env.OHLCV_ARCHIVE.put(resultKey, stream.readable, {
    httpMetadata: { contentType: 'application/json' },
  });

  await writer.write(
    encoder.encode(
      `${JSON.stringify({
        exchange: request.exchange,
        symbol: request.symbol,
        type: request.marketType,
        timeframe: request.timeframe,
        strategy: request.strategy,
        metrics,
      }).slice(0, -1)},"equityCurve":[`
    )
  );
  await writePartialArray(
    env,
    writer,
    encoder,
    row.id,
    request.archiveObjects.length,
    'equityCurve'
  );
  await writer.write(encoder.encode('],"trades":['));
  await writePartialArray(env, writer, encoder, row.id, request.archiveObjects.length, 'trades');
  await writer.write(encoder.encode(`],"timestamp":${timestamp}}`));
  await writer.close();
  await put;

  const summary: AsyncBacktestResultSummary = {
    metrics,
    candleCount: checkpoint.candleCount,
    equityPointCount: checkpoint.equityPointCount,
    tradeCount: checkpoint.tradeCount,
    resultUrl: `/api/v1/backtests/jobs/${row.id}/result`,
  };
  const completed = await env.DB.prepare(
    `UPDATE async_backtest_jobs
     SET status = 'complete', progress = 1, processed_rows = ?, result_object_key = ?,
         result_summary_json = ?, last_error = NULL, completed_at = unixepoch(),
         updated_at = unixepoch()
     WHERE id = ? AND status IN ('queued', 'running') AND cancel_requested_at IS NULL`
  )
    .bind(checkpoint.processedRows, resultKey, JSON.stringify(summary), row.id)
    .run();
  if ((completed.meta.changes ?? 0) === 0) await markCancelled(env, row.id);
}

async function writePartialArray(
  env: Env,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  jobId: string,
  chunkCount: number,
  field: keyof ChunkOutput
): Promise<void> {
  let first = true;
  for (let index = 0; index < chunkCount; index += 1) {
    const object = await env.OHLCV_ARCHIVE.get(partialKey(jobId, index));
    if (!object) throw new Error(`Async backtest partial ${index} is unavailable`);
    const partial = JSON.parse(await object.text()) as ChunkOutput;
    for (const item of partial[field]) {
      await writer.write(encoder.encode(`${first ? '' : ','}${JSON.stringify(item)}`));
      first = false;
    }
  }
}

function buildMetrics(checkpoint: BacktestCheckpoint): BacktestResponse['metrics'] {
  const count = checkpoint.returnCount;
  const average = count > 0 ? checkpoint.returnSum / count : 0;
  const variance =
    count > 1
      ? Math.max(0, (checkpoint.returnSquares - count * average * average) / (count - 1))
      : 0;
  const stdev = Math.sqrt(variance);
  return {
    totalReturnPercent: checkpoint.equity - 100,
    maxDrawdownPercent: checkpoint.maxDrawdownPercent,
    sharpe: stdev > 0 ? (average / stdev) * Math.sqrt(252) : 0,
    winRate: count > 0 ? checkpoint.wins / count : 0,
    tradeCount: checkpoint.tradeCount,
    profitFactor:
      checkpoint.grossLoss > 0
        ? checkpoint.grossWin / checkpoint.grossLoss
        : checkpoint.grossWin > 0
          ? Number.MAX_SAFE_INTEGER
          : 0,
  };
}

async function resumeFromCheckpoint(
  env: Env,
  row: AsyncBacktestJobRow,
  request: StoredRequest,
  checkpoint: BacktestCheckpoint
): Promise<void> {
  if (checkpoint.nextChunkIndex >= request.archiveObjects.length) {
    await finalizeJob(env, row, request, checkpoint);
  } else {
    await sendNextChunk(env, row.id, checkpoint.nextChunkIndex);
  }
}

async function markCancelled(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE async_backtest_jobs
     SET status = 'cancelled', completed_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND status IN ('queued', 'running')`
  )
    .bind(jobId)
    .run();
}

async function sendNextChunk(env: Env, jobId: string, chunkIndex: number): Promise<void> {
  await env.BACKFILL_QUEUE.send({ kind: 'async-backtest', jobId, chunkIndex });
}

async function ensureInitialJobQueued(env: Env, row: AsyncBacktestJobRow): Promise<void> {
  if (row.status !== 'queued' || Number(row.progress) !== 0 || row.processed_rows !== 0) return;
  const existingCheckpoint = await env.OHLCV_ARCHIVE.get(checkpointKey(row.id));
  if (!existingCheckpoint) await writeCheckpoint(env, row.id, initialCheckpoint());
  await sendNextChunk(env, row.id, 0);
}

async function writeCheckpoint(
  env: Env,
  jobId: string,
  checkpoint: BacktestCheckpoint
): Promise<void> {
  await env.OHLCV_ARCHIVE.put(checkpointKey(jobId), JSON.stringify(checkpoint), {
    httpMetadata: { contentType: 'application/json' },
  });
}

async function readCheckpoint(env: Env, jobId: string): Promise<BacktestCheckpoint> {
  const object = await env.OHLCV_ARCHIVE.get(checkpointKey(jobId));
  if (!object) throw new Error(`Async backtest checkpoint '${jobId}' is unavailable`);
  const checkpoint = JSON.parse(await object.text()) as BacktestCheckpoint;
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new TerminalAsyncBacktestError('Unsupported async backtest checkpoint version');
  }
  return checkpoint;
}

async function* readArchiveCandles(object: R2ObjectBody): AsyncGenerator<OHLCV> {
  const stream =
    object.httpMetadata?.contentEncoding === 'gzip'
      ? object.body.pipeThrough(new DecompressionStream('gzip'))
      : object.body;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield parseArchiveRow(line);
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer.trim()) yield parseArchiveRow(buffer.trim());
  } finally {
    reader.releaseLock();
  }
}

function parseArchiveRow(line: string): OHLCV {
  const row = JSON.parse(line) as Record<string, unknown>;
  const values = [row.t, row.o, row.h, row.l, row.c, row.v];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new TerminalAsyncBacktestError('Archive contains a malformed OHLCV row');
  }
  return {
    timestamp: row.t as number,
    open: row.o as number,
    high: row.h as number,
    low: row.l as number,
    close: row.c as number,
    volume: row.v as number,
  };
}

function initialCheckpoint(): BacktestCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    nextChunkIndex: 0,
    candleCount: 0,
    processedRows: 0,
    lastTimestamp: null,
    fast: { seed: [], value: null },
    slow: { seed: [], value: null },
    rsi: {
      previousClose: null,
      averageGain: 0,
      averageLoss: 0,
      initialized: false,
    },
    previousFast: null,
    previousSlow: null,
    position: null,
    equity: 100,
    peak: 100,
    maxDrawdownPercent: 0,
    returnCount: 0,
    returnSum: 0,
    returnSquares: 0,
    wins: 0,
    grossWin: 0,
    grossLoss: 0,
    tradeCount: 0,
    equityPointCount: 0,
  };
}

function parseStoredRequest(value: string): StoredRequest {
  const request = JSON.parse(value) as StoredRequest;
  if (!Array.isArray(request.archiveObjects)) {
    throw new TerminalAsyncBacktestError('Async backtest request manifest is invalid');
  }
  return request;
}

function mapJob(row: AsyncBacktestJobRow): AsyncBacktestJob {
  return {
    id: row.id,
    status: row.status,
    exchange: row.exchange,
    symbol: row.symbol,
    marketType: row.market_type,
    timeframe: row.timeframe,
    startTime: row.start_time,
    endTime: row.end_time,
    progress: Number(row.progress),
    processedRows: Number(row.processed_rows),
    totalRows: row.total_rows === null ? null : Number(row.total_rows),
    result: row.result_summary_json
      ? (JSON.parse(row.result_summary_json) as AsyncBacktestResultSummary)
      : null,
    error: row.last_error,
    cancelRequestedAt: toMilliseconds(row.cancel_requested_at),
    startedAt: toMilliseconds(row.started_at),
    completedAt: toMilliseconds(row.completed_at),
    createdAt: row.created_at * 1_000,
    updatedAt: row.updated_at * 1_000,
  };
}

function toMilliseconds(value: number | null): number | null {
  return value === null ? null : value * 1_000;
}

function checkpointKey(jobId: string): string {
  return `${JOB_PREFIX}/${jobId}/checkpoint.json`;
}

function partialKey(jobId: string, chunkIndex: number): string {
  return `${JOB_PREFIX}/${jobId}/partials/${String(chunkIndex).padStart(5, '0')}.json`;
}

function assertBindings(env: Env): void {
  if (!env.DB) throw new Error('D1 DB binding is not configured');
  if (!env.OHLCV_ARCHIVE) throw new Error('OHLCV_ARCHIVE R2 binding is not configured');
  if (!env.BACKFILL_QUEUE) throw new Error('BACKFILL_QUEUE binding is not configured');
}

/** Test helper proving that chunk boundaries preserve the streaming engine state. */
export function runBacktestChunksForTest(
  request: Pick<AsyncBacktestJobRequest, 'strategy'>,
  chunks: OHLCV[][]
): { checkpoint: BacktestCheckpoint; output: ChunkOutput } {
  let checkpoint = initialCheckpoint();
  const output: ChunkOutput = { equityCurve: [], trades: [] };
  for (const chunk of chunks) {
    const part: ChunkOutput = { equityCurve: [], trades: [] };
    for (const candle of chunk)
      checkpoint = applyCandle(checkpoint, request.strategy, candle, part);
    output.equityCurve.push(...part.equityCurve);
    output.trades.push(...part.trades);
  }
  return { checkpoint, output };
}
