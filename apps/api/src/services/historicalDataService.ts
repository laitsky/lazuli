import type {
  Env,
  HistoricalBackfillQueueMessage,
  HistoricalDataset,
  SupportedExchange,
} from '../types';
import { ErrorCode, ExchangeError, ValidationError } from '../errors';
import { ccxtService, isTransientExchangeError } from './ccxtService';
import { prepareBackfillUniverse, readArchivedOhlcv, splitMonths } from './backfillService';
import {
  fetchEtfFlowsBackfill,
  fetchMacroHistoryBackfill,
  fetchOptionsVolatilityBackfill,
} from './institutionalService';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_TASKS_PER_COMPONENT = 5_000;
const MAX_ATTEMPTS = 10;
const MAX_AGE_MS = 24 * HOUR;
const DEFAULT_DAILY_TASK_BUDGET = 10;
const DEFAULT_DAILY_ATTEMPT_BUDGET = 30;
const PROVIDER_COOLDOWN_FAILURES = 3;
const PROVIDER_COOLDOWN_SECONDS = 5 * 60;
const FINALIZATION_BATCH_SIZE = 25;
const EXCHANGES: SupportedExchange[] = ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'];
export const HISTORICAL_DATASETS: HistoricalDataset[] = [
  'funding_rate',
  'funding_basis',
  'open_interest',
  'options_volatility',
  'trade_aggregate',
  'liquidation_aggregate',
  'macro',
  'etf_flow',
  'market_catalog',
];

type Row = Record<string, unknown> & { t: number };
interface HistoricalFetchResult {
  rows: Row[];
  coverageState: 'complete' | 'partial';
  gapSummary: Record<string, unknown>;
}
type CampaignAction = 'pause' | 'resume' | 'cancel' | 'retry-gaps';

export interface HistoricalCampaignRequest {
  dryRun?: boolean;
  datasets?: HistoricalDataset[];
  exchanges?: SupportedExchange[];
  startTime?: number;
  cutoffTime?: number;
  maxSymbolsPerExchange?: number;
  symbols?: string[];
  types?: Array<'spot' | 'perp'>;
  assets?: string[];
}

interface PlannedTask {
  dataset: HistoricalDataset;
  provider: string;
  exchange?: SupportedExchange;
  entity: string;
  marketType?: 'spot' | 'perp';
  resolution: string;
  startTime: number;
  endTime: number;
  gapReason?: string;
  gapClass?: string;
}

interface HistoricalCampaignPlan {
  tasks: PlannedTask[];
  components: Array<{ dataset: string; provider: string; resolution: string; tasks: number }>;
  frozenUniverse: Record<string, string[]>;
  estimatedTasks: number;
  cutoffTime: number;
}

interface CreateHistoricalCampaignOptions {
  plan?: HistoricalCampaignPlan;
  dailyRefreshDate?: string;
  providerGaps?: Map<string, string>;
}

interface DailyRefreshRunRow {
  refresh_date: string;
  campaign_id: string | null;
  status: string;
  task_budget: number;
  attempt_budget: number;
  tasks_planned: number;
  attempts_used: number;
  excluded_providers_json: string;
  verification_status: string;
  verification_summary_json: string;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface ProviderCooldownRow {
  provider: string;
  consecutive_failures: number;
  failure_class: string | null;
  cooldown_until: number;
  last_error: string | null;
  updated_at: number;
}

export class TerminalHistoricalError extends Error {}
export class RetryableHistoricalError extends Error {
  constructor(
    message: string,
    readonly delaySeconds: number,
    readonly failureClass: string
  ) {
    super(message);
  }
}

export function classifyHistoricalFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TerminalHistoricalError || error instanceof ValidationError)
    return 'validation';
  if (error instanceof ExchangeError && error.code === ErrorCode.EXCHANGE_RATE_LIMIT)
    return 'provider_rate_limit';
  if (/rate|429/i.test(message)) return 'provider_rate_limit';
  if (error instanceof ExchangeError)
    return isTransientExchangeError(error) ? 'provider_network' : 'validation';
  if (/network|timeout|fetch/i.test(message)) return 'provider_network';
  if (/\bD1\b|database|SQLITE/i.test(message)) return 'storage_d1';
  if (/\bR2\b|object storage/i.test(message)) return 'storage_r2';
  if (/support|invalid|validation/i.test(message)) return 'validation';
  return 'internal';
}

export async function planHistoricalCampaign(
  request: HistoricalCampaignRequest
): Promise<HistoricalCampaignPlan> {
  const invalidDatasets = (request.datasets ?? []).filter(
    (dataset) => !HISTORICAL_DATASETS.includes(dataset)
  );
  const invalidExchanges = (request.exchanges ?? []).filter(
    (exchange) => !EXCHANGES.includes(exchange)
  );
  if (invalidDatasets.length)
    throw new Error(`Unsupported historical datasets: ${invalidDatasets}`);
  if (invalidExchanges.length) throw new Error(`Unsupported exchanges: ${invalidExchanges}`);
  if (
    request.maxSymbolsPerExchange !== undefined &&
    (!Number.isInteger(request.maxSymbolsPerExchange) ||
      request.maxSymbolsPerExchange < 1 ||
      request.maxSymbolsPerExchange > 5_000)
  )
    throw new Error('maxSymbolsPerExchange must be an integer between 1 and 5000');
  const now = Date.now();
  const cutoffTime =
    request.cutoffTime ??
    Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1) - 1;
  const requestedEnd = request.cutoffTime ?? now;
  const datasets = request.datasets?.length ? request.datasets : HISTORICAL_DATASETS;
  const exchanges = request.exchanges?.length ? request.exchanges : EXCHANGES;
  const symbolLimit = request.maxSymbolsPerExchange ?? 50;
  const frozenUniverse: Record<string, string[]> = {};
  const tasks: PlannedTask[] = [];

  const universe = async (exchange: SupportedExchange, type: 'spot' | 'perp', limit: number) => {
    const key = `${exchange}:${type}:${limit}`;
    if (frozenUniverse[key]) return frozenUniverse[key]!;
    try {
      const result = await prepareBackfillUniverse({
        exchanges: [exchange],
        symbols: request.symbols,
        types: [type],
        timeframes: ['1h'],
        startTime: cutoffTime - DAY,
        endTime: cutoffTime,
        maxSymbolsPerExchange: limit,
      });
      return (frozenUniverse[key] = result.symbolsByExchangeType[`${exchange}:${type}`] ?? []);
    } catch {
      return (frozenUniverse[key] = []);
    }
  };

  if (datasets.includes('funding_rate')) {
    for (const exchange of exchanges.filter((item) => item !== 'upbit')) {
      const symbols = await universe(exchange, 'perp', symbolLimit);
      for (const symbol of symbols) {
        for (const month of splitMonths(request.startTime ?? Date.UTC(2019, 0, 1), cutoffTime))
          tasks.push({
            dataset: 'funding_rate',
            provider: exchange,
            exchange,
            entity: symbol,
            marketType: 'perp',
            resolution: 'native',
            startTime: month.start,
            endTime: month.end,
          });
      }
    }
  }
  if (datasets.includes('open_interest')) {
    for (const exchange of exchanges.filter((item) => ['binance', 'bybit', 'okx'].includes(item))) {
      const symbols = await universe(exchange, 'perp', symbolLimit);
      for (const symbol of symbols) {
        for (const month of splitMonths(
          Math.max(request.startTime ?? 0, requestedEnd - 90 * DAY),
          requestedEnd
        ))
          tasks.push({
            dataset: 'open_interest',
            provider: exchange,
            exchange,
            entity: symbol,
            marketType: 'perp',
            resolution: '1h',
            startTime: month.start,
            endTime: month.end,
          });
        for (const month of splitMonths(
          Math.max(request.startTime ?? 0, requestedEnd - 2 * DAY),
          requestedEnd
        ))
          tasks.push({
            dataset: 'open_interest',
            provider: exchange,
            exchange,
            entity: symbol,
            marketType: 'perp',
            resolution: '5m',
            startTime: month.start,
            endTime: month.end,
          });
      }
    }
    if (exchanges.includes('hyperliquid'))
      tasks.push({
        dataset: 'open_interest',
        provider: 'hyperliquid',
        exchange: 'hyperliquid',
        entity: '*',
        marketType: 'perp',
        resolution: '1h',
        startTime: requestedEnd - 90 * DAY,
        endTime: requestedEnd,
        gapReason: 'Historical open interest is unsupported by the provider',
      });
  }
  if (datasets.includes('options_volatility')) {
    for (const asset of selectedAssets(request, ['BTC', 'ETH']))
      for (const month of splitMonths(request.startTime ?? requestedEnd - 365 * DAY, requestedEnd))
        tasks.push({
          dataset: 'options_volatility',
          provider: 'deribit',
          entity: asset,
          resolution: '1d',
          startTime: month.start,
          endTime: month.end,
        });
  }
  if (datasets.includes('trade_aggregate')) {
    for (const exchange of exchanges) {
      const supportedTypes: Array<'spot' | 'perp'> =
        exchange === 'upbit' ? ['spot'] : exchange === 'hyperliquid' ? ['perp'] : ['spot', 'perp'];
      const selectedTypes = request.types?.length
        ? supportedTypes.filter((type) => request.types!.includes(type))
        : supportedTypes;
      for (const type of selectedTypes) {
        for (const symbol of await universe(exchange, type, Math.min(10, symbolLimit)))
          for (const month of splitMonths(
            Math.max(request.startTime ?? 0, requestedEnd - 90 * DAY),
            requestedEnd
          ))
            tasks.push({
              dataset: 'trade_aggregate',
              provider: exchange,
              exchange,
              entity: symbol,
              marketType: type,
              resolution: '1h',
              startTime: month.start,
              endTime: month.end,
            });
      }
    }
  }
  if (datasets.includes('liquidation_aggregate')) {
    for (const exchange of exchanges.filter((item) => item !== 'upbit')) {
      const supported = ccxtService.historicalCapabilities(exchange).liquidations;
      tasks.push({
        dataset: 'liquidation_aggregate',
        provider: exchange,
        exchange,
        entity: '*',
        marketType: 'perp',
        resolution: '1h',
        startTime: requestedEnd - 90 * DAY,
        endTime: requestedEnd,
        ...(supported
          ? {}
          : { gapReason: 'Historical liquidations are unsupported by the provider' }),
      });
    }
  }
  if (datasets.includes('macro'))
    for (const [entity, provider] of [
      ['btcDominance', 'coingecko'],
      ['stablecoinSupplyUsd', 'defillama'],
      ['fearGreedIndex', 'alternative.me'],
    ] as const)
      for (const month of splitMonths(request.startTime ?? requestedEnd - 365 * DAY, requestedEnd))
        tasks.push({
          dataset: 'macro',
          provider,
          entity,
          resolution: '1d',
          startTime: month.start,
          endTime: month.end,
        });
  if (datasets.includes('etf_flow'))
    for (const asset of selectedAssets(request, ['BTC', 'ETH']))
      for (const month of splitMonths(request.startTime ?? Date.UTC(2019, 0, 1), requestedEnd))
        tasks.push({
          dataset: 'etf_flow',
          provider: 'farside',
          entity: asset,
          resolution: '1d',
          startTime: month.start,
          endTime: month.end,
        });
  if (datasets.includes('market_catalog'))
    for (const exchange of exchanges)
      tasks.push({
        dataset: 'market_catalog',
        provider: exchange,
        exchange,
        entity: '*',
        resolution: '1d',
        startTime: Date.UTC(
          new Date(now).getUTCFullYear(),
          new Date(now).getUTCMonth(),
          new Date(now).getUTCDate()
        ),
        endTime: now,
      });
  if (datasets.includes('funding_basis'))
    for (const asset of request.assets?.length ? request.assets : ['*'])
      for (const month of splitMonths(request.startTime ?? Date.UTC(2019, 0, 1), cutoffTime))
        tasks.push({
          dataset: 'funding_basis',
          provider: 'lazuli',
          entity: asset.toUpperCase(),
          marketType: 'perp',
          resolution: '1h',
          startTime: month.start,
          endTime: month.end,
          ...(datasets.length > 1
            ? { gapReason: 'Derived after funding and OHLCV source campaigns are verified' }
            : {}),
        });

  const counts = new Map<string, number>();
  for (const task of tasks) {
    const key = `${task.dataset}:${task.provider}:${task.resolution}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const components = [...counts].flatMap(([key, count]) => {
    const [dataset, provider, resolution] = key.split(':');
    return Array.from({ length: Math.ceil(count / MAX_TASKS_PER_COMPONENT) }, (_, index) => ({
      dataset: dataset!,
      provider: provider!,
      resolution: resolution!,
      tasks: Math.min(MAX_TASKS_PER_COMPONENT, count - index * MAX_TASKS_PER_COMPONENT),
    }));
  });
  return { tasks, components, frozenUniverse, estimatedTasks: tasks.length, cutoffTime };
}

export async function createHistoricalCampaign(
  env: Env,
  request: HistoricalCampaignRequest,
  options: CreateHistoricalCampaignOptions = {}
) {
  const planned = options.plan ?? (await planHistoricalCampaign(request));
  if (request.dryRun) return { dryRun: true, ...planned, tasks: undefined };
  const tasks = planned.tasks.map((task) => {
    const reason = options.providerGaps?.get(task.provider);
    return reason && !task.gapReason
      ? { ...task, gapReason: reason, gapClass: 'provider_cooldown' }
      : task;
  });
  const campaignId = `hfc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const grouped = new Map<string, PlannedTask[]>();
  for (const task of tasks) {
    const key = `${task.dataset}:${task.provider}:${task.resolution}`;
    const groups = grouped.get(key) ?? [];
    grouped.set(key, groups);
    groups.push(task);
  }
  const componentRows: Array<{ id: string; tasks: PlannedTask[]; key: string }> = [];
  for (const [key, items] of grouped)
    for (let offset = 0; offset < items.length; offset += MAX_TASKS_PER_COMPONENT)
      componentRows.push({
        id: `${campaignId}:${key}:${offset / MAX_TASKS_PER_COMPONENT}`,
        tasks: items.slice(offset, offset + MAX_TASKS_PER_COMPONENT),
        key,
      });
  await env.DB.prepare(
    `INSERT INTO historical_data_campaigns (id,status,requested_config_json,frozen_universe_json,total_components,total_tasks) VALUES (?,'running',?,?,?,?)`
  )
    .bind(
      campaignId,
      JSON.stringify({ ...request, dailyRefreshDate: options.dailyRefreshDate ?? undefined }),
      JSON.stringify(planned.frozenUniverse),
      componentRows.length,
      tasks.length
    )
    .run();
  if (options.dailyRefreshDate) {
    await env.DB.prepare(
      `UPDATE historical_daily_refresh_runs
       SET campaign_id=?,status='running',tasks_planned=?,last_error=NULL
       WHERE refresh_date=? AND status='planning'`
    )
      .bind(campaignId, tasks.length, options.dailyRefreshDate)
      .run();
  }
  const activeProviders = new Set<string>();
  const componentStates = new Map<string, 'running' | 'planned' | 'gap'>();
  const componentStatements = componentRows.map((component) => {
    const [dataset, provider, resolution] = component.key.split(':');
    const allGaps = component.tasks.every((task) => task.gapReason);
    const status = allGaps ? 'gap' : activeProviders.has(provider!) ? 'planned' : 'running';
    if (status === 'running') activeProviders.add(provider!);
    componentStates.set(component.id, status);
    return env.DB.prepare(
      `INSERT INTO historical_data_components (id,campaign_id,dataset,provider,resolution,status,task_count,gap_reason) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      component.id,
      campaignId,
      dataset,
      provider,
      resolution,
      status,
      component.tasks.length,
      allGaps ? (component.tasks[0]?.gapReason ?? null) : null
    );
  });
  for (let index = 0; index < componentStatements.length; index += 50)
    await env.DB.batch(componentStatements.slice(index, index + 50));
  const messages: HistoricalBackfillQueueMessage[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const component of componentRows)
    for (const task of component.tasks) {
      const id = `hft_${crypto.randomUUID()}`;
      const status = task.gapReason ? 'gap' : 'pending';
      const gapClass = task.gapClass ?? (task.gapReason ? 'provider_unavailable' : null);
      const shouldQueue =
        !task.gapReason && componentStates.get(component.id) === 'running' && messages.length < 500;
      statements.push(
        env.DB.prepare(
          `INSERT INTO historical_data_tasks (id,campaign_id,component_id,dataset,provider,exchange,entity,market_type,resolution,start_time,end_time,status,coverage_state,failure_class,last_error,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          id,
          campaignId,
          component.id,
          task.dataset,
          task.provider,
          task.exchange ?? null,
          task.entity,
          task.marketType ?? null,
          task.resolution,
          task.startTime,
          task.endTime,
          status,
          task.gapReason ? gapClass : 'planned',
          gapClass,
          task.gapReason ?? null,
          shouldQueue ? Math.floor(Date.now() / 1000) + 3600 : null
        )
      );
      if (shouldQueue)
        messages.push({
          kind: 'history-backfill',
          campaignId,
          componentId: component.id,
          taskId: id,
          dataset: task.dataset,
          provider: task.provider,
          exchange: task.exchange,
          entity: task.entity,
          marketType: task.marketType,
          resolution: task.resolution,
          startTime: task.startTime,
          endTime: task.endTime,
        });
    }
  for (let index = 0; index < statements.length; index += 50)
    await env.DB.batch(statements.slice(index, index + 50));
  try {
    for (let index = 0; index < messages.length; index += 100)
      await env.BACKFILL_QUEUE.sendBatch(
        messages.slice(index, index + 100).map((body) => ({ body }))
      );
  } catch (error) {
    await clearHistoricalQueueLeases(
      env,
      messages.map((message) => message.taskId)
    );
    throw error;
  }
  await refreshHistoricalCampaign(env, campaignId);
  return getHistoricalCampaign(env, campaignId);
}

export async function processHistoricalMessage(
  env: Env,
  message: HistoricalBackfillQueueMessage,
  pace?: () => Promise<void>
): Promise<void> {
  const task = await env.DB.prepare(
    `SELECT attempts,first_attempt_at,status FROM historical_data_tasks WHERE id=?`
  )
    .bind(message.taskId)
    .first<{ attempts: number; first_attempt_at: number | null; status: string }>();
  if (!task || ['complete', 'gap', 'cancelled'].includes(task.status)) return;
  if (!message.dailyAttemptReserved && !(await claimDailyHistoricalAttempt(env, message))) return;
  const attempts = task.attempts + 1;
  const firstAttempt = task.first_attempt_at ?? Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE historical_data_tasks SET status='running',attempts=?,first_attempt_at=?,next_attempt_at=NULL WHERE id=?`
  )
    .bind(attempts, firstAttempt, message.taskId)
    .run();
  try {
    const key = historicalObjectKey(message);
    const closedPartition = isClosedHistoricalPartition(message.startTime);
    const reusable = await env.DB.prepare(
      `SELECT checksum,row_count,coverage_state,finalized_at
       FROM historical_data_manifests
       WHERE object_key=? AND coverage_state IN ('complete','partial')`
    )
      .bind(key)
      .first<{
        checksum: string;
        row_count: number;
        coverage_state: string;
        finalized_at: number | null;
      }>();
    if (closedPartition && reusable) {
      if (!reusable.finalized_at) await finalizeHistoricalManifest(env, key, reusable);
      else await validateHistoricalArchiveMetadata(env, key, reusable);
      await env.DB.prepare(
        `UPDATE historical_data_tasks SET status='complete',coverage_state=?,object_key=?,row_count=?,last_error=NULL,failure_class=NULL WHERE id=?`
      )
        .bind(String(reusable.coverage_state), key, Number(reusable.row_count), message.taskId)
        .run();
      await refreshHistoricalCampaign(env, message.campaignId);
      return;
    }
    let existingRows: Row[] = [];
    if (reusable) {
      try {
        existingRows = (await readValidatedHistoricalArchive(env, key, reusable)).rows;
      } catch (error) {
        const recovered = await readRecoverableHistoricalArchive(env, key, message.taskId);
        if (!recovered) throw error;
        await commitHistoricalManifest(
          env,
          message,
          key,
          recovered.rows,
          recovered.checksum,
          recovered.coverageState,
          { recoveredAfterD1Failure: true },
          closedPartition
        );
        await populateRollups(env, message, recovered.rows);
        await recordHistoricalProviderSuccess(env, message.provider);
        await refreshHistoricalCampaign(env, message.campaignId);
        return;
      }
    }
    if (!reusable && (await env.OHLCV_ARCHIVE.head(key))) {
      const recovered = await readRecoverableHistoricalArchive(env, key, message.taskId);
      if (recovered) {
        await commitHistoricalManifest(
          env,
          message,
          key,
          recovered.rows,
          recovered.checksum,
          recovered.coverageState,
          { recoveredAfterD1Failure: true },
          closedPartition
        );
        await populateRollups(env, message, recovered.rows);
        await recordHistoricalProviderSuccess(env, message.provider);
        await refreshHistoricalCampaign(env, message.campaignId);
        return;
      }
      throw new RetryableHistoricalError(
        `R2 object '${key}' exists without a D1 manifest`,
        30,
        'storage_r2'
      );
    }
    const fetched = await fetchHistoricalRows(env, message, pace);
    if (fetched.rows.length === 0) {
      await env.DB.prepare(
        `UPDATE historical_data_tasks SET status='gap',coverage_state='no_data',failure_class='no_data',last_error='Provider returned no data' WHERE id=?`
      )
        .bind(message.taskId)
        .run();
      await refreshHistoricalCampaign(env, message.campaignId);
      return;
    }
    const rows = closedPartition
      ? dedupeHistoricalRows(fetched.rows, message.dataset)
      : mergeHistoricalRows(existingRows, fetched.rows, message.dataset);
    const body = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    const checksum = await sha256(body);
    const compressed = await new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer();
    await env.OHLCV_ARCHIVE.put(key, compressed, {
      httpMetadata: {
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip',
        cacheControl: closedPartition
          ? 'public, max-age=31536000, immutable'
          : 'private, max-age=300',
      },
      customMetadata: {
        checksum,
        dataset: message.dataset,
        rows: String(rows.length),
        taskId: message.taskId,
        coverageState: fetched.coverageState,
      },
    });
    await commitHistoricalManifest(
      env,
      message,
      key,
      rows,
      checksum,
      fetched.coverageState,
      fetched.gapSummary,
      closedPartition
    );
    await populateRollups(env, message, rows);
    await recordHistoricalProviderSuccess(env, message.provider);
    await refreshHistoricalCampaign(env, message.campaignId);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const failureClass = classifyHistoricalFailure(error);
    const terminal =
      error instanceof ValidationError ||
      failureClass === 'validation' ||
      attempts >= MAX_ATTEMPTS ||
      Date.now() - firstAttempt * 1000 >= MAX_AGE_MS;
    const retryAfter =
      error instanceof ExchangeError && typeof error.details?.retryAfterSeconds === 'number'
        ? Math.max(1, Math.min(1800, Math.ceil(error.details.retryAfterSeconds)))
        : 0;
    const delay = Math.max(
      retryAfter,
      1,
      Math.ceil(
        Math.random() *
          Math.min(
            failureClass === 'provider_rate_limit' ? 1800 : 300,
            (failureClass === 'provider_rate_limit' ? 30 : 10) * 2 ** Math.max(0, attempts - 1)
          )
      )
    );
    if (failureClass.startsWith('provider_'))
      await recordHistoricalProviderFailure(
        env,
        message.provider,
        failureClass,
        messageText,
        delay
      );
    await env.DB.prepare(
      `UPDATE historical_data_tasks SET status=?,coverage_state=?,failure_class=?,last_error=?,next_attempt_at=? WHERE id=?`
    )
      .bind(
        terminal ? 'failed' : 'pending',
        terminal
          ? failureClass.startsWith('provider_')
            ? 'provider_unavailable'
            : 'partial'
          : 'retrying',
        failureClass,
        messageText.slice(0, 1000),
        terminal ? null : Math.floor(Date.now() / 1000) + delay,
        message.taskId
      )
      .run();
    await refreshHistoricalCampaign(env, message.campaignId);
    if (terminal) throw new TerminalHistoricalError(messageText);
    throw new RetryableHistoricalError(messageText, delay, failureClass);
  }
}

interface HistoricalManifestReference {
  checksum: string;
  row_count: number;
  coverage_state?: string;
  finalized_at?: number | null;
}

export function isClosedHistoricalPartition(startTime: number, now = Date.now()): boolean {
  const partition = new Date(startTime);
  const current = new Date(now);
  const partitionMonth = Date.UTC(partition.getUTCFullYear(), partition.getUTCMonth(), 1);
  const currentMonth = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1);
  return partitionMonth < currentMonth;
}

export function mergeHistoricalRows(
  existing: Row[],
  incoming: Row[],
  dataset: HistoricalDataset
): Row[] {
  return dedupeHistoricalRows([...existing, ...incoming], dataset);
}

async function validateHistoricalArchiveMetadata(
  env: Env,
  key: string,
  manifest: HistoricalManifestReference
) {
  const head = await env.OHLCV_ARCHIVE.head(key);
  if (
    !head ||
    head.customMetadata?.checksum !== manifest.checksum ||
    head.customMetadata?.rows !== String(manifest.row_count)
  ) {
    throw new RetryableHistoricalError(
      `R2 metadata for '${key}' does not match its D1 manifest`,
      30,
      'storage_r2'
    );
  }
  return head;
}

async function readValidatedHistoricalArchive(
  env: Env,
  key: string,
  manifest: HistoricalManifestReference
): Promise<{ rows: Row[]; compressed: ArrayBuffer; object: R2ObjectBody }> {
  const object = await env.OHLCV_ARCHIVE.get(key);
  if (!object) {
    throw new RetryableHistoricalError(
      `R2 object '${key}' is missing for its D1 manifest`,
      30,
      'storage_r2'
    );
  }
  if (
    object.customMetadata?.checksum !== manifest.checksum ||
    object.customMetadata?.rows !== String(manifest.row_count)
  ) {
    throw new RetryableHistoricalError(
      `R2 metadata for '${key}' does not match its D1 manifest`,
      30,
      'storage_r2'
    );
  }
  const compressed = await object.arrayBuffer();
  let body: string;
  try {
    body = await new Response(
      new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'))
    ).text();
  } catch {
    throw new RetryableHistoricalError(`R2 object '${key}' is not valid gzip`, 30, 'storage_r2');
  }
  return {
    rows: await validateHistoricalArchiveBody(body, manifest, key),
    compressed,
    object,
  };
}

export async function validateHistoricalArchiveBody(
  body: string,
  manifest: HistoricalManifestReference,
  key = 'archive'
): Promise<Row[]> {
  const lines = body.split('\n').filter(Boolean);
  if (
    (await sha256(body)) !== manifest.checksum ||
    lines.length !== manifest.row_count ||
    !validHistoricalLines(lines)
  ) {
    throw new RetryableHistoricalError(
      `R2 object '${key}' failed checksum, row-count, or NDJSON validation`,
      30,
      'storage_r2'
    );
  }
  return lines.map((line) => JSON.parse(line) as Row);
}

async function readRecoverableHistoricalArchive(
  env: Env,
  key: string,
  taskId: string
): Promise<{ rows: Row[]; checksum: string; coverageState: 'complete' | 'partial' } | null> {
  const object = await env.OHLCV_ARCHIVE.get(key);
  if (!object || object.customMetadata?.taskId !== taskId) return null;
  const checksum = object.customMetadata.checksum;
  const rowCount = Number(object.customMetadata.rows);
  const coverageState = object.customMetadata.coverageState;
  if (
    !checksum ||
    !Number.isInteger(rowCount) ||
    rowCount < 1 ||
    (coverageState !== 'complete' && coverageState !== 'partial')
  )
    return null;
  const compressed = await object.arrayBuffer();
  let body: string;
  try {
    body = await new Response(
      new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'))
    ).text();
  } catch {
    return null;
  }
  return {
    rows: await validateHistoricalArchiveBody(body, { checksum, row_count: rowCount }, key),
    checksum,
    coverageState,
  };
}

async function commitHistoricalManifest(
  env: Env,
  message: HistoricalBackfillQueueMessage,
  key: string,
  rows: Row[],
  checksum: string,
  coverageState: 'complete' | 'partial',
  gapSummary: Record<string, unknown>,
  closedPartition: boolean
): Promise<void> {
  const first = rows[0]!.t;
  const last = rows.at(-1)!.t;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO historical_data_manifests (object_key,task_id,dataset,provider,exchange,entity,market_type,resolution,first_timestamp,last_timestamp,row_count,checksum,coverage_state,gap_summary_json,provenance_json,finalized_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(object_key) DO UPDATE SET task_id=excluded.task_id,row_count=excluded.row_count,checksum=excluded.checksum,first_timestamp=excluded.first_timestamp,last_timestamp=excluded.last_timestamp,coverage_state=excluded.coverage_state,gap_summary_json=excluded.gap_summary_json,provenance_json=excluded.provenance_json,finalized_at=excluded.finalized_at`
    ).bind(
      key,
      message.taskId,
      message.dataset,
      message.provider,
      message.exchange ?? null,
      message.entity,
      message.marketType ?? null,
      message.resolution,
      first,
      last,
      rows.length,
      checksum,
      coverageState,
      JSON.stringify(gapSummary),
      JSON.stringify({
        provider: message.provider,
        nativeUnitsPreserved: true,
        model: message.dataset === 'funding_basis' ? 'execution-cost-adjusted-v1' : null,
        executionCostBps: message.dataset === 'funding_basis' ? 12 : null,
        inputs: message.dataset === 'funding_basis' ? ['funding_rate', 'ohlcv'] : null,
      }),
      closedPartition ? Math.floor(Date.now() / 1000) : null
    ),
    env.DB.prepare(
      `UPDATE historical_data_tasks SET status='complete',coverage_state=?,object_key=?,row_count=?,failure_class=NULL,last_error=NULL WHERE id=?`
    ).bind(coverageState, key, rows.length, message.taskId),
  ]);
}

async function finalizeHistoricalManifest(
  env: Env,
  key: string,
  manifest: HistoricalManifestReference
): Promise<void> {
  const archive = await readValidatedHistoricalArchive(env, key, manifest);
  await env.OHLCV_ARCHIVE.put(key, archive.compressed, {
    httpMetadata: {
      ...archive.object.httpMetadata,
      contentType: 'application/x-ndjson',
      contentEncoding: 'gzip',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      ...archive.object.customMetadata,
      checksum: manifest.checksum,
      rows: String(manifest.row_count),
    },
  });
  await env.DB.prepare(
    `UPDATE historical_data_manifests SET finalized_at=unixepoch()
     WHERE object_key=? AND finalized_at IS NULL`
  )
    .bind(key)
    .run();
}

async function fetchHistoricalRows(
  env: Env,
  message: HistoricalBackfillQueueMessage,
  pace?: () => Promise<void>
): Promise<HistoricalFetchResult> {
  const rows: Row[] = [];
  if (message.dataset === 'funding_rate') {
    let cursor = message.startTime;
    while (cursor <= message.endTime) {
      await pace?.();
      const page = await ccxtService.fetchFundingHistoryBackfillPage(
        message.provider,
        message.entity,
        cursor,
        200
      );
      const valid = normalizeRows(page, message.startTime, message.endTime);
      rows.push(...valid);
      const last = valid.at(-1)?.t;
      if (!last || page.length === 0 || last < cursor) break;
      cursor = last + 1;
    }
    return complete(dedupeHistoricalRows(rows, message.dataset));
  }
  if (message.dataset === 'open_interest') {
    let cursor = message.startTime;
    while (cursor <= message.endTime) {
      await pace?.();
      const page = await ccxtService.fetchOpenInterestHistoryBackfillPage(
        message.provider,
        message.entity,
        message.resolution,
        cursor,
        200
      );
      const valid = normalizeRows(page, message.startTime, message.endTime);
      rows.push(...valid);
      const last = valid.at(-1)?.t;
      if (!last || page.length === 0 || last < cursor) break;
      cursor = last + 1;
    }
    return complete(dedupeHistoricalRows(rows, message.dataset));
  }
  if (message.dataset === 'trade_aggregate') {
    let cursor = message.startTime;
    const trades: Row[] = [];
    const rawLimit = 200_000;
    while (cursor <= message.endTime && trades.length < rawLimit) {
      await pace?.();
      const page = await ccxtService.fetchTradesBackfillPage(
        message.provider,
        message.entity,
        message.marketType ?? 'spot',
        cursor,
        1000
      );
      const valid = normalizeRows(page, message.startTime, message.endTime);
      trades.push(...valid);
      const last = valid.at(-1)?.t;
      if (!last || page.length === 0 || last < cursor) break;
      cursor = last + 1;
    }
    const capped = trades.length >= rawLimit && cursor <= message.endTime;
    return {
      rows: aggregateHistoricalTrades(trades),
      coverageState: capped ? 'partial' : 'complete',
      gapSummary: capped
        ? { reason: 'raw_trade_safety_limit', rawRows: trades.length, coveredThrough: cursor - 1 }
        : {},
    };
  }
  if (message.dataset === 'options_volatility') {
    await pace?.();
    return complete(
      (
        await fetchOptionsVolatilityBackfill(
          message.entity as 'BTC' | 'ETH',
          message.startTime,
          message.endTime
        )
      )
        .filter((row) => row.timestamp >= message.startTime && row.timestamp <= message.endTime)
        .map((row) => ({ t: row.timestamp, o: row.open, h: row.high, l: row.low, c: row.close }))
    );
  }
  if (message.dataset === 'macro') {
    await pace?.();
    return complete(
      (
        await fetchMacroHistoryBackfill(
          message.entity as 'btcDominance' | 'stablecoinSupplyUsd' | 'fearGreedIndex',
          message.startTime,
          message.endTime
        )
      )
        .filter((row) => row.observedAt >= message.startTime && row.observedAt <= message.endTime)
        .map((row) => ({ t: row.observedAt, value: row.value }))
    );
  }
  if (message.dataset === 'etf_flow') {
    await pace?.();
    return complete(
      (await fetchEtfFlowsBackfill(message.entity as 'BTC' | 'ETH'))
        .map((row) => ({ t: Date.parse(`${row.date}T00:00:00Z`), ...row }))
        .filter((row) => row.t >= message.startTime && row.t <= message.endTime)
    );
  }
  if (message.dataset === 'market_catalog' && message.exchange) {
    const markets = await ccxtService.fetchMarketCatalogBackfill(message.exchange, pace);
    const observedAt = dailyObservationTimestamp(message.startTime);
    return complete(
      markets.map((market) => ({
        t: observedAt,
        ...market,
      }))
    );
  }
  if (message.dataset === 'funding_basis')
    return complete(await deriveFundingBasisRows(env, message));
  throw new TerminalHistoricalError(
    `Dataset '${message.dataset}' has no historical provider adapter`
  );
}

export function dailyObservationTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export async function readHistoricalData(
  env: Env,
  query: {
    dataset: HistoricalDataset;
    exchange?: string;
    entity: string;
    marketType?: string;
    resolution: string;
    since: number;
    until: number;
    limit: number;
  }
) {
  const result = await env.DB.prepare(
    `SELECT object_key FROM historical_data_manifests WHERE dataset=? AND entity=? AND resolution=? AND coverage_state IN ('complete','partial') AND (? IS NULL OR exchange=?) AND (? IS NULL OR market_type=?) AND last_timestamp>=? AND first_timestamp<=? ORDER BY first_timestamp ASC LIMIT 100`
  )
    .bind(
      query.dataset,
      query.entity,
      query.resolution,
      query.exchange ?? null,
      query.exchange ?? null,
      query.marketType ?? null,
      query.marketType ?? null,
      query.since,
      query.until
    )
    .all<{ object_key: string }>();
  const rows: Row[] = [];
  for (const manifest of result.results) {
    const object = await env.OHLCV_ARCHIVE.get(manifest.object_key);
    if (!object) continue;
    const text = await new Response(
      object.body.pipeThrough(new DecompressionStream('gzip'))
    ).text();
    for (const line of text.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as Row;
      if (row.t >= query.since && row.t <= query.until) rows.push(row);
    }
  }
  return {
    rows: dedupeHistoricalRows(rows, query.dataset).slice(0, query.limit),
    archiveObjects: result.results.map((row) => row.object_key),
    missingArchive: result.results.length === 0,
  };
}

export async function getHistoricalCampaign(env: Env, id: string) {
  await refreshHistoricalCampaign(env, id);
  const campaign = await env.DB.prepare(`SELECT * FROM historical_data_campaigns WHERE id=?`)
    .bind(id)
    .first();
  if (!campaign) throw new Error(`Historical campaign '${id}' not found`);
  const components = await env.DB.prepare(
    `SELECT * FROM historical_data_components WHERE campaign_id=? ORDER BY dataset,provider,resolution,id`
  )
    .bind(id)
    .all();
  const retries = await env.DB.prepare(
    `SELECT id,dataset,provider,entity,attempts,next_attempt_at,failure_class,last_error FROM historical_data_tasks WHERE campaign_id=? AND status IN ('pending','failed','gap') ORDER BY next_attempt_at LIMIT 200`
  )
    .bind(id)
    .all();
  return { campaign, components: components.results, retries: retries.results };
}

export async function setHistoricalCampaignState(env: Env, id: string, action: CampaignAction) {
  if (action === 'pause')
    await env.DB.prepare(
      `UPDATE historical_data_campaigns SET status='paused' WHERE id=? AND status='running'`
    )
      .bind(id)
      .run();
  if (action === 'cancel') {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE historical_data_campaigns SET status='cancelled' WHERE id=? AND status NOT IN ('complete','complete_with_gaps','cancelled')`
      ).bind(id),
      env.DB.prepare(
        `UPDATE historical_data_tasks SET status='cancelled' WHERE campaign_id=? AND status IN ('pending','running')`
      ).bind(id),
      env.DB.prepare(
        `UPDATE historical_data_components SET status='cancelled'
         WHERE campaign_id=? AND status IN ('planned','running')`
      ).bind(id),
    ]);
  }
  if (action === 'resume')
    await env.DB.prepare(
      `UPDATE historical_data_campaigns SET status='running' WHERE id=? AND status='paused'`
    )
      .bind(id)
      .run();
  if (action === 'retry-gaps') {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE historical_data_campaigns SET status='running' WHERE id=? AND status IN ('complete_with_gaps','failed','running')`
      ).bind(id),
      env.DB.prepare(
        `UPDATE historical_data_tasks SET status='pending',coverage_state='planned',failure_class=NULL,last_error=NULL,next_attempt_at=NULL WHERE campaign_id=? AND status IN ('gap','failed') AND failure_class<>'validation'`
      ).bind(id),
    ]);
    await env.DB.prepare(
      `UPDATE historical_data_components SET status='planned'
       WHERE campaign_id=? AND EXISTS (SELECT 1 FROM historical_data_tasks t
         WHERE t.component_id=historical_data_components.id AND t.status='pending')`
    )
      .bind(id)
      .run();
    await activateNextHistoricalComponents(env, id);
  }
  if (action === 'resume' || action === 'retry-gaps') await enqueueHistoricalTasks(env, id);
  return getHistoricalCampaign(env, id);
}

export async function enqueueHistoricalTasks(env: Env, campaignId: string) {
  const campaign = await env.DB.prepare(`SELECT status FROM historical_data_campaigns WHERE id=?`)
    .bind(campaignId)
    .first<{ status: string }>();
  if (campaign?.status !== 'running') return 0;
  const result = await env.DB.prepare(
    `SELECT t.* FROM historical_data_tasks t JOIN historical_data_components c ON c.id=t.component_id
     WHERE t.campaign_id=? AND t.status='pending' AND c.status='running'
       AND (t.next_attempt_at IS NULL OR t.next_attempt_at<=unixepoch()) LIMIT 500`
  )
    .bind(campaignId)
    .all<Record<string, unknown>>();
  const messages = result.results.map(
    (row): HistoricalBackfillQueueMessage => ({
      kind: 'history-backfill',
      campaignId,
      componentId: String(row.component_id),
      taskId: String(row.id),
      dataset: String(row.dataset) as HistoricalDataset,
      provider: String(row.provider),
      exchange: row.exchange ? (String(row.exchange) as SupportedExchange) : undefined,
      entity: String(row.entity),
      marketType: row.market_type ? (String(row.market_type) as 'spot' | 'perp') : undefined,
      resolution: String(row.resolution),
      startTime: Number(row.start_time),
      endTime: Number(row.end_time),
    })
  );
  if (messages.length) {
    const leases = messages.map((message) =>
      env.DB.prepare(
        `UPDATE historical_data_tasks SET next_attempt_at=unixepoch()+3600
         WHERE id=? AND status='pending'`
      ).bind(message.taskId)
    );
    for (let index = 0; index < leases.length; index += 50)
      await env.DB.batch(leases.slice(index, index + 50));
  }
  try {
    for (let index = 0; index < messages.length; index += 100)
      await env.BACKFILL_QUEUE.sendBatch(
        messages.slice(index, index + 100).map((body) => ({ body }))
      );
  } catch (error) {
    await clearHistoricalQueueLeases(
      env,
      messages.map((message) => message.taskId)
    );
    throw error;
  }
  return messages.length;
}

async function clearHistoricalQueueLeases(env: Env, taskIds: string[]) {
  const statements = taskIds.map((id) =>
    env.DB.prepare(
      `UPDATE historical_data_tasks SET next_attempt_at=NULL WHERE id=? AND status='pending'`
    ).bind(id)
  );
  for (let index = 0; index < statements.length; index += 50)
    await env.DB.batch(statements.slice(index, index + 50));
}

export async function advanceHistoricalCampaigns(env: Env) {
  const result = await env.DB.prepare(
    `SELECT id FROM historical_data_campaigns WHERE status='running' ORDER BY updated_at LIMIT 20`
  ).all<{ id: string }>();
  let enqueued = 0;
  for (const row of result.results) {
    enqueued += await enqueueHistoricalTasks(env, row.id);
    await refreshHistoricalCampaign(env, row.id);
  }
  return { campaigns: result.results.length, enqueued };
}

export async function ensureDailyHistoricalRefresh(env: Env, now = Date.now()) {
  const date = new Date(now);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const refreshDate = new Date(dayStart).toISOString().slice(0, 10);
  const existing = await env.DB.prepare(
    `SELECT * FROM historical_daily_refresh_runs WHERE refresh_date=?`
  )
    .bind(refreshDate)
    .first<DailyRefreshRunRow>();
  if (existing) return getHistoricalRefreshStatus(env, refreshDate);

  const taskBudget = positiveIntegerConfig(
    env.HISTORY_DAILY_TASK_BUDGET,
    DEFAULT_DAILY_TASK_BUDGET
  );
  const attemptBudget = positiveIntegerConfig(
    env.HISTORY_DAILY_ATTEMPT_BUDGET,
    DEFAULT_DAILY_ATTEMPT_BUDGET
  );
  const claimed = await env.DB.prepare(
    `INSERT OR IGNORE INTO historical_daily_refresh_runs
       (refresh_date,status,task_budget,attempt_budget)
     VALUES (?,'planning',?,?)`
  )
    .bind(refreshDate, taskBudget, attemptBudget)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return getHistoricalRefreshStatus(env, refreshDate);

  const request: HistoricalCampaignRequest = {
    datasets: ['macro', 'etf_flow', 'market_catalog'],
    startTime: dayStart,
    cutoffTime: now,
  };
  try {
    const plan = await planHistoricalCampaign(request);
    if (!dailyRefreshWithinTaskBudget(plan.estimatedTasks, taskBudget)) {
      const error = `Daily refresh requires ${plan.estimatedTasks} tasks but its budget is ${taskBudget}`;
      await env.DB.prepare(
        `UPDATE historical_daily_refresh_runs
         SET status='blocked_budget',tasks_planned=?,last_error=? WHERE refresh_date=?`
      )
        .bind(plan.estimatedTasks, error, refreshDate)
        .run();
      throw new Error(error);
    }
    const providerGaps = await dailyProviderGaps(env, plan.tasks, now);
    await env.DB.prepare(
      `UPDATE historical_daily_refresh_runs SET excluded_providers_json=? WHERE refresh_date=?`
    )
      .bind(JSON.stringify([...providerGaps.keys()].sort()), refreshDate)
      .run();
    await createHistoricalCampaign(env, request, {
      plan,
      dailyRefreshDate: refreshDate,
      providerGaps,
    });
    return getHistoricalRefreshStatus(env, refreshDate);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE historical_data_tasks SET status='cancelled',next_attempt_at=NULL
         WHERE campaign_id=(SELECT campaign_id FROM historical_daily_refresh_runs WHERE refresh_date=?)
           AND status IN ('pending','running')`
      ).bind(refreshDate),
      env.DB.prepare(
        `UPDATE historical_data_components SET status='failed',gap_reason=?
         WHERE campaign_id=(SELECT campaign_id FROM historical_daily_refresh_runs WHERE refresh_date=?)
           AND status IN ('planned','running')`
      ).bind(message, refreshDate),
      env.DB.prepare(
        `UPDATE historical_data_campaigns SET status='failed'
         WHERE id=(SELECT campaign_id FROM historical_daily_refresh_runs WHERE refresh_date=?)
           AND status NOT IN ('complete','complete_with_gaps','cancelled')`
      ).bind(refreshDate),
      env.DB.prepare(
        `UPDATE historical_daily_refresh_runs
         SET status=CASE WHEN status='blocked_budget' THEN status ELSE 'failed' END,last_error=?
         WHERE refresh_date=?`
      ).bind(message, refreshDate),
    ]);
    throw error;
  }
}

export async function getHistoricalRefreshStatus(env: Env, refreshDate?: string) {
  const run = refreshDate
    ? await env.DB.prepare(`SELECT * FROM historical_daily_refresh_runs WHERE refresh_date=?`)
        .bind(refreshDate)
        .first<DailyRefreshRunRow>()
    : await env.DB.prepare(
        `SELECT * FROM historical_daily_refresh_runs ORDER BY refresh_date DESC LIMIT 1`
      ).first<DailyRefreshRunRow>();
  const cooldowns = await env.DB.prepare(
    `SELECT provider,consecutive_failures,failure_class,cooldown_until,last_error,updated_at
     FROM historical_provider_cooldowns ORDER BY provider`
  ).all<ProviderCooldownRow>();
  return {
    run: run ? mapDailyRefreshRun(run) : null,
    cooldowns: cooldowns.results,
    configuredExclusions: configuredDailyProviderExclusions(env),
  };
}

export async function finalizeClosedHistoricalPartitions(
  env: Env,
  now = Date.now(),
  limit = FINALIZATION_BATCH_SIZE
) {
  const currentMonth = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
  const manifests = await env.DB.prepare(
    `SELECT object_key,checksum,row_count
     FROM historical_data_manifests
     WHERE finalized_at IS NULL AND last_timestamp<?
     ORDER BY last_timestamp,object_key LIMIT ?`
  )
    .bind(currentMonth, Math.max(1, Math.min(100, limit)))
    .all<{ object_key: string; checksum: string; row_count: number }>();
  const finalized: string[] = [];
  const invalid: Array<{ objectKey: string; reason: string }> = [];
  for (const manifest of manifests.results) {
    try {
      await finalizeHistoricalManifest(env, manifest.object_key, manifest);
      finalized.push(manifest.object_key);
    } catch (error) {
      invalid.push({
        objectKey: manifest.object_key,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { finalized, invalid, remaining: manifests.results.length === limit };
}

export async function verifyCompletedDailyHistoricalRefreshes(env: Env) {
  const runs = await env.DB.prepare(
    `SELECT refresh_date,campaign_id FROM historical_daily_refresh_runs
     WHERE status IN ('complete','complete_with_gaps')
       AND verification_status='pending' AND campaign_id IS NOT NULL
     ORDER BY refresh_date LIMIT 5`
  ).all<{ refresh_date: string; campaign_id: string }>();
  const verified: Array<{ refreshDate: string; invalid: number }> = [];
  for (const run of runs.results) {
    const result = await verifyHistoricalCampaignPage(env, run.campaign_id, null, 250);
    const passed = result.done && result.invalid.length === 0;
    await env.DB.prepare(
      `UPDATE historical_daily_refresh_runs
       SET verification_status=?,verification_summary_json=? WHERE refresh_date=?`
    )
      .bind(
        passed ? 'passed' : 'failed',
        JSON.stringify({
          checked: result.checked.length,
          invalid: result.invalid,
          completePage: result.done,
          verifiedAt: Date.now(),
        }),
        run.refresh_date
      )
      .run();
    verified.push({ refreshDate: run.refresh_date, invalid: result.invalid.length });
  }
  return verified;
}

export async function claimDailyHistoricalAttempt(
  env: Env,
  message: HistoricalBackfillQueueMessage
): Promise<boolean> {
  const run = await env.DB.prepare(
    `SELECT refresh_date FROM historical_daily_refresh_runs WHERE campaign_id=?`
  )
    .bind(message.campaignId)
    .first<{ refresh_date: string }>();
  if (!run) return true;
  const result = await env.DB.prepare(
    `UPDATE historical_daily_refresh_runs
     SET attempts_used=attempts_used+1
     WHERE campaign_id=? AND status='running' AND attempts_used<attempt_budget`
  )
    .bind(message.campaignId)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    const budget = await env.DB.prepare(
      `SELECT attempts_used,attempt_budget FROM historical_daily_refresh_runs WHERE campaign_id=?`
    )
      .bind(message.campaignId)
      .first<{ attempts_used: number; attempt_budget: number }>();
    if (budget && budget.attempts_used >= budget.attempt_budget) {
      await env.DB.prepare(
        `UPDATE historical_data_tasks
         SET status='gap',coverage_state='daily_budget_exhausted',
             failure_class='daily_budget_exhausted',next_attempt_at=NULL,
             last_error='Daily historical refresh attempt budget exhausted'
         WHERE campaign_id=? AND id<>? AND status='pending'`
      )
        .bind(message.campaignId, message.taskId)
        .run();
      await refreshHistoricalCampaign(env, message.campaignId);
    }
    return true;
  }
  await env.DB.prepare(
    `UPDATE historical_data_tasks
     SET status='gap',coverage_state='daily_budget_exhausted',
         failure_class='daily_budget_exhausted',next_attempt_at=NULL,
         last_error='Daily historical refresh attempt budget exhausted'
     WHERE id=? AND status IN ('pending','running')`
  )
    .bind(message.taskId)
    .run();
  await refreshHistoricalCampaign(env, message.campaignId);
  return false;
}

async function dailyProviderGaps(
  env: Env,
  tasks: PlannedTask[],
  now: number
): Promise<Map<string, string>> {
  const providers = [...new Set(tasks.map((task) => task.provider))];
  const gaps = new Map<string, string>();
  for (const provider of configuredDailyProviderExclusions(env))
    if (providers.includes(provider))
      gaps.set(provider, 'Provider is excluded from scheduled historical refreshes');
  const persisted = await env.DB.prepare(
    `SELECT provider,cooldown_until FROM historical_provider_cooldowns
     WHERE cooldown_until>?`
  )
    .bind(Math.floor(now / 1000))
    .all<{ provider: string; cooldown_until: number }>();
  for (const row of persisted.results)
    if (providers.includes(row.provider))
      gaps.set(
        row.provider,
        `Provider cooldown is active until ${new Date(row.cooldown_until * 1000).toISOString()}`
      );
  if (env.BACKFILL_COORDINATOR) {
    await Promise.all(
      providers.map(async (provider) => {
        if (gaps.has(provider)) return;
        try {
          const id = env.BACKFILL_COORDINATOR!.idFromName(provider);
          const response = await env
            .BACKFILL_COORDINATOR!.get(id)
            .fetch('https://coordinator/health');
          if (!response.ok) return;
          const state = (await response.json()) as { openUntil?: number };
          if (typeof state.openUntil === 'number' && state.openUntil > now)
            gaps.set(
              provider,
              `Provider coordinator circuit is open until ${new Date(state.openUntil).toISOString()}`
            );
        } catch {
          // A health probe failure must not turn a healthy provider into a declared gap.
        }
      })
    );
  }
  return gaps;
}

function configuredDailyProviderExclusions(env: Env): string[] {
  return [
    ...new Set(
      (env.HISTORY_DAILY_EXCLUDED_PROVIDERS ?? '')
        .split(',')
        .map((provider) => provider.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].sort();
}

function positiveIntegerConfig(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function dailyRefreshWithinTaskBudget(plannedTasks: number, taskBudget: number): boolean {
  return plannedTasks >= 0 && taskBudget > 0 && plannedTasks <= taskBudget;
}

function mapDailyRefreshRun(row: DailyRefreshRunRow) {
  return {
    refreshDate: row.refresh_date,
    campaignId: row.campaign_id,
    status: row.status,
    taskBudget: row.task_budget,
    attemptBudget: row.attempt_budget,
    tasksPlanned: row.tasks_planned,
    attemptsUsed: row.attempts_used,
    excludedProviders: safeJsonArray(row.excluded_providers_json),
    verificationStatus: row.verification_status,
    verificationSummary: safeJsonObject(row.verification_summary_json),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function recordHistoricalProviderSuccess(env: Env, provider: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO historical_provider_cooldowns
       (provider,consecutive_failures,failure_class,cooldown_until,last_error)
     VALUES (?,0,NULL,0,NULL)
     ON CONFLICT(provider) DO UPDATE SET
       consecutive_failures=0,failure_class=NULL,cooldown_until=0,last_error=NULL`
  )
    .bind(provider)
    .run();
}

async function recordHistoricalProviderFailure(
  env: Env,
  provider: string,
  failureClass: string,
  error: string,
  delaySeconds: number
): Promise<void> {
  const current = await env.DB.prepare(
    `SELECT consecutive_failures FROM historical_provider_cooldowns WHERE provider=?`
  )
    .bind(provider)
    .first<{ consecutive_failures: number }>();
  const failures = (current?.consecutive_failures ?? 0) + 1;
  const cooldownUntil =
    failures >= PROVIDER_COOLDOWN_FAILURES
      ? Math.floor(Date.now() / 1000) + Math.max(PROVIDER_COOLDOWN_SECONDS, delaySeconds)
      : 0;
  await env.DB.prepare(
    `INSERT INTO historical_provider_cooldowns
       (provider,consecutive_failures,failure_class,cooldown_until,last_error)
     VALUES (?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET
       consecutive_failures=excluded.consecutive_failures,
       failure_class=excluded.failure_class,
       cooldown_until=excluded.cooldown_until,
       last_error=excluded.last_error`
  )
    .bind(provider, failures, failureClass, cooldownUntil, error.slice(0, 1000))
    .run();
}

export async function verifyHistoricalCampaignPage(
  env: Env,
  campaignId: string,
  cursor: string | null,
  limit: number
) {
  const result = await env.DB.prepare(
    `SELECT object_key,checksum,row_count FROM historical_data_manifests WHERE object_key IN (SELECT object_key FROM historical_data_tasks WHERE campaign_id=? AND object_key IS NOT NULL) AND (? IS NULL OR object_key>?) ORDER BY object_key LIMIT ?`
  )
    .bind(campaignId, cursor, cursor, limit)
    .all<{ object_key: string; checksum: string; row_count: number }>();
  const checked: string[] = [];
  const invalid: Array<{ objectKey: string; reason: string }> = [];
  for (const [index, row] of result.results.entries()) {
    const head = await env.OHLCV_ARCHIVE.head(row.object_key);
    if (
      !head ||
      head.customMetadata?.checksum !== row.checksum ||
      head.customMetadata?.rows !== String(row.row_count)
    )
      invalid.push({ objectKey: row.object_key, reason: 'R2 metadata or object is missing' });
    else if (index === 0 || checksumSample(row.object_key)) {
      const object = await env.OHLCV_ARCHIVE.get(row.object_key);
      if (!object) {
        invalid.push({
          objectKey: row.object_key,
          reason: 'R2 object disappeared during verification',
        });
        continue;
      }
      const body = await new Response(
        object.body.pipeThrough(new DecompressionStream('gzip'))
      ).text();
      const lines = body.split('\n').filter(Boolean);
      const validRows = validHistoricalLines(lines);
      if ((await sha256(body)) !== row.checksum || lines.length !== row.row_count || !validRows)
        invalid.push({
          objectKey: row.object_key,
          reason: 'Full checksum, row count, or NDJSON validation failed',
        });
      else checked.push(row.object_key);
    } else checked.push(row.object_key);
  }
  const verification = {
    checked,
    invalid,
    nextCursor: result.results.at(-1)?.object_key ?? null,
    done: result.results.length < limit,
  };
  if (verification.done) {
    const run = await env.DB.prepare(
      `SELECT refresh_date FROM historical_daily_refresh_runs WHERE campaign_id=?`
    )
      .bind(campaignId)
      .first<{ refresh_date: string }>();
    if (run)
      await env.DB.prepare(
        `UPDATE historical_daily_refresh_runs
         SET verification_status=?,verification_summary_json=? WHERE refresh_date=?`
      )
        .bind(
          invalid.length === 0 ? 'passed' : 'failed',
          JSON.stringify({ checked: checked.length, invalid, verifiedAt: Date.now() }),
          run.refresh_date
        )
        .run();
  }
  return verification;
}

function checksumSample(value: string): boolean {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 100 === 0;
}

function validHistoricalLines(lines: string[]): boolean {
  try {
    return lines.every((line) => {
      const value = JSON.parse(line) as { t?: unknown };
      return typeof value.t === 'number' && Number.isFinite(value.t);
    });
  } catch {
    return false;
  }
}

async function refreshHistoricalCampaign(env: Env, campaignId: string) {
  await env.DB.prepare(
    `UPDATE historical_data_components SET completed_tasks=(SELECT COUNT(*) FROM historical_data_tasks t WHERE t.component_id=historical_data_components.id AND t.status='complete'),gap_tasks=(SELECT COUNT(*) FROM historical_data_tasks t WHERE t.component_id=historical_data_components.id AND t.status IN ('gap','failed')),status=CASE WHEN status IN ('cancelled','planned') THEN status WHEN (SELECT COUNT(*) FROM historical_data_tasks t WHERE t.component_id=historical_data_components.id AND t.status IN ('pending','running'))>0 THEN 'running' WHEN (SELECT COUNT(*) FROM historical_data_tasks t WHERE t.component_id=historical_data_components.id AND t.status IN ('gap','failed'))>0 THEN 'gap' ELSE 'complete' END WHERE campaign_id=?`
  )
    .bind(campaignId)
    .run();
  await activateNextHistoricalComponents(env, campaignId);
  await env.DB.prepare(
    `UPDATE historical_data_campaigns SET completed_components=(SELECT COUNT(*) FROM historical_data_components WHERE campaign_id=? AND status='complete'),gap_components=(SELECT COUNT(*) FROM historical_data_components WHERE campaign_id=? AND status IN ('gap','failed')),status=CASE WHEN status IN ('paused','cancelled') THEN status WHEN (SELECT COUNT(*) FROM historical_data_components WHERE campaign_id=? AND status IN ('planned','running'))>0 THEN 'running' WHEN (SELECT COUNT(*) FROM historical_data_components WHERE campaign_id=? AND status IN ('gap','failed'))>0 THEN 'complete_with_gaps' ELSE 'complete' END WHERE id=?`
  )
    .bind(campaignId, campaignId, campaignId, campaignId, campaignId)
    .run();
  await env.DB.prepare(
    `UPDATE historical_daily_refresh_runs
     SET status=COALESCE(
       (SELECT CASE status
          WHEN 'complete' THEN 'complete'
          WHEN 'complete_with_gaps' THEN 'complete_with_gaps'
          WHEN 'failed' THEN 'failed'
          WHEN 'cancelled' THEN 'failed'
          ELSE 'running'
        END FROM historical_data_campaigns WHERE id=?),
       status
     )
     WHERE campaign_id=? AND status IN ('running','complete','complete_with_gaps')`
  )
    .bind(campaignId, campaignId)
    .run();
}

async function activateNextHistoricalComponents(env: Env, campaignId: string) {
  const providers = await env.DB.prepare(
    `SELECT DISTINCT provider FROM historical_data_components
     WHERE campaign_id=? AND status='planned'`
  )
    .bind(campaignId)
    .all<{ provider: string }>();
  for (const { provider } of providers.results) {
    const active = await env.DB.prepare(
      `SELECT 1 FROM historical_data_components
       WHERE campaign_id=? AND provider=? AND status='running' LIMIT 1`
    )
      .bind(campaignId, provider)
      .first();
    if (active) continue;
    const next = await env.DB.prepare(
      `SELECT id FROM historical_data_components
       WHERE campaign_id=? AND provider=? AND status='planned' ORDER BY created_at,id LIMIT 1`
    )
      .bind(campaignId, provider)
      .first<{ id: string }>();
    if (next)
      await env.DB.prepare(
        `UPDATE historical_data_components SET status='running' WHERE id=? AND status='planned'`
      )
        .bind(next.id)
        .run();
  }
}

async function populateRollups(env: Env, message: HistoricalBackfillQueueMessage, rows: Row[]) {
  if (message.dataset === 'market_catalog' && message.exchange) {
    const statements = rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO exchange_catalog (exchange,symbol,type,base,quote,active,first_seen_at,last_seen_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(exchange,symbol,type) DO UPDATE SET base=excluded.base,quote=excluded.quote,
           active=excluded.active,last_seen_at=excluded.last_seen_at`
      ).bind(
        message.exchange,
        String(row.symbol),
        String(row.type),
        String(row.base),
        String(row.quote),
        row.active === false ? 0 : 1,
        Math.floor(row.t / 1000),
        Math.floor(row.t / 1000)
      )
    );
    for (let index = 0; index < statements.length; index += 50)
      await env.DB.batch(statements.slice(index, index + 50));
    return;
  }
  if (message.dataset === 'funding_basis') {
    const statements = rows.slice(-20_000).map((row) => {
      const bucket = Math.floor(row.t / HOUR);
      const exchange = `${row.longExchange}:${row.shortExchange}`;
      return env.DB.prepare(
        `INSERT INTO derived_metric_rollups (id,metric,exchange,symbol,market_type,bucket_start,bucket_seconds,value_json,provenance_json,sample_count,source_fresh_at) VALUES (?,'funding_basis',?,?,'perp',?,3600,?,?,1,?) ON CONFLICT(metric,exchange,symbol,market_type,bucket_seconds,bucket_start) DO UPDATE SET value_json=excluded.value_json,provenance_json=excluded.provenance_json,source_fresh_at=excluded.source_fresh_at`
      ).bind(
        `basis:${row.asset}:${exchange}:${bucket}`,
        exchange,
        row.asset,
        bucket,
        JSON.stringify(row),
        JSON.stringify({
          model: 'execution-cost-adjusted-v1',
          executionCostBps: 12,
          source: 'historical-archive',
        }),
        Math.floor(row.t / 1000)
      );
    });
    for (let index = 0; index < statements.length; index += 50)
      await env.DB.batch(statements.slice(index, index + 50));
    return;
  }
  if (message.dataset !== 'open_interest') return;
  const statements = rows.slice(-20_000).flatMap((row) => {
    const value = Number(row.openInterestUsd ?? row.openInterest);
    if (!Number.isFinite(value)) return [];
    const seconds = message.resolution === '5m' ? 300 : 3600;
    const bucket = Math.floor(row.t / 1000 / seconds) * seconds;
    return [
      env.DB.prepare(
        `INSERT INTO derived_metric_rollups (id,metric,exchange,symbol,market_type,bucket_start,bucket_seconds,value_json,provenance_json,sample_count,source_fresh_at) VALUES (?,'open_interest_usd',?,?,'perp',?,?,?,?,1,?) ON CONFLICT(metric,exchange,symbol,market_type,bucket_seconds,bucket_start) DO UPDATE SET value_json=excluded.value_json,provenance_json=excluded.provenance_json,source_fresh_at=excluded.source_fresh_at`
      ).bind(
        `oi:${message.exchange}:${message.entity}:${seconds}:${bucket}`,
        message.exchange,
        message.entity,
        bucket,
        seconds,
        JSON.stringify({ value, observedAt: row.t }),
        JSON.stringify({ provider: message.provider, source: 'historical-archive' }),
        Math.floor(row.t / 1000)
      ),
    ];
  });
  for (let index = 0; index < statements.length; index += 50)
    await env.DB.batch(statements.slice(index, index + 50));
}

export function aggregateHistoricalTrades(trades: Row[]): Row[] {
  const buckets = new Map<number, { rows: Row[] }>();
  for (const trade of trades) {
    const bucket = Math.floor(trade.t / HOUR) * HOUR;
    const value = buckets.get(bucket) ?? { rows: [] };
    value.rows.push(trade);
    buckets.set(bucket, value);
  }
  return [...buckets]
    .sort(([a], [b]) => a - b)
    .map(([t, value]) => {
      let buyBase = 0,
        sellBase = 0,
        buyQuote = 0,
        sellQuote = 0,
        weighted = 0,
        base = 0;
      const prices: number[] = [];
      for (const row of value.rows) {
        const price = Number(row.price),
          amount = Number(row.amount),
          cost = Number(row.cost ?? price * amount);
        if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
        prices.push(price);
        base += amount;
        weighted += price * amount;
        if (row.side === 'buy') {
          buyBase += amount;
          buyQuote += cost;
        } else {
          sellBase += amount;
          sellQuote += cost;
        }
      }
      return {
        t,
        count: value.rows.length,
        buyBaseVolume: buyBase,
        sellBaseVolume: sellBase,
        buyQuoteVolume: buyQuote,
        sellQuoteVolume: sellQuote,
        vwap: base ? weighted / base : null,
        high: prices.length ? Math.max(...prices) : null,
        low: prices.length ? Math.min(...prices) : null,
        firstPrice: Number(value.rows[0]?.price),
        lastPrice: Number(value.rows.at(-1)?.price),
      };
    });
}

async function deriveFundingBasisRows(
  env: Env,
  message: HistoricalBackfillQueueMessage
): Promise<Row[]> {
  const manifests = await env.DB.prepare(
    `SELECT object_key,provider,entity FROM historical_data_manifests
     WHERE dataset='funding_rate' AND coverage_state='complete'
       AND last_timestamp>=? AND first_timestamp<=? ORDER BY first_timestamp`
  )
    .bind(message.startTime, message.endTime)
    .all<{
      object_key: string;
      provider: string;
      entity: string;
    }>();
  const buckets = new Map<
    string,
    Array<{
      exchange: string;
      rate: number;
      markPrice: number | null;
      priceSource: 'funding_mark_price' | 'ohlcv_1h' | 'unavailable';
    }>
  >();
  const priceMaps = new Map<string, Map<number, number>>();
  for (const manifest of manifests.results) {
    const priceKey = `${manifest.provider}:${manifest.entity}`;
    if (priceMaps.has(priceKey)) continue;
    const archive = await readArchivedOhlcv(
      env,
      manifest.provider,
      manifest.entity,
      'perp',
      '1h',
      message.startTime,
      message.endTime
    );
    priceMaps.set(
      priceKey,
      new Map(
        archive.candles.map((candle) => [Math.floor(candle.timestamp / HOUR) * HOUR, candle.close])
      )
    );
  }
  for (const manifest of manifests.results) {
    const object = await env.OHLCV_ARCHIVE.get(manifest.object_key);
    if (!object) continue;
    const text = await new Response(
      object.body.pipeThrough(new DecompressionStream('gzip'))
    ).text();
    for (const line of text.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const timestamp = Number(row.t);
      const rate = Number(row.rate);
      if (!Number.isFinite(timestamp) || !Number.isFinite(rate)) continue;
      const key = `${Math.floor(timestamp / HOUR) * HOUR}:${baseAsset(manifest.entity)}`;
      const group = buckets.get(key) ?? [];
      const nativeMark = finiteNumber(row.markPrice);
      const archiveMark = priceMaps
        .get(`${manifest.provider}:${manifest.entity}`)
        ?.get(Math.floor(timestamp / HOUR) * HOUR);
      group.push({
        exchange: manifest.provider,
        rate,
        markPrice: nativeMark ?? archiveMark ?? null,
        priceSource: nativeMark ? 'funding_mark_price' : archiveMark ? 'ohlcv_1h' : 'unavailable',
      });
      buckets.set(key, group);
    }
  }
  return [...buckets]
    .flatMap(([key, values]): Row[] => {
      if (values.length < 2) return [];
      const [timestampText, asset] = key.split(':');
      if (message.entity !== '*' && asset !== message.entity) return [];
      const sorted = [...values].sort((a, b) => a.rate - b.rate);
      const long = sorted[0]!;
      const short = sorted.at(-1)!;
      const gross = (short.rate - long.rate) * 3 * 365 * 100;
      const basis =
        long.markPrice && short.markPrice
          ? ((short.markPrice - long.markPrice) / ((short.markPrice + long.markPrice) / 2)) * 100
          : 0;
      const net = gross - 0.12 - Math.abs(basis);
      return net > 0
        ? [
            {
              t: Number(timestampText),
              asset,
              longExchange: long.exchange,
              shortExchange: short.exchange,
              longFundingRate: long.rate,
              shortFundingRate: short.rate,
              basisPercent: basis,
              grossAnnualizedYield: gross,
              netAnnualizedYield: net,
              estimatedExecutionCostBps: 12,
              priceSources: [long.priceSource, short.priceSource],
            },
          ]
        : [];
    })
    .sort((a, b) => a.t - b.t);
}

function baseAsset(symbol: string): string {
  const separated = symbol.split('-')[0];
  if (separated && separated !== symbol) return separated;
  return symbol.replace(/\.P$/i, '').replace(/(USDT|USDC|USD|KRW)$/i, '');
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function selectedAssets(request: HistoricalCampaignRequest, defaults: string[]): string[] {
  if (!request.assets?.length) return defaults;
  const allowed = new Set(defaults);
  return [...new Set(request.assets.map((asset) => asset.trim().toUpperCase()))].filter((asset) =>
    allowed.has(asset)
  );
}
function normalizeRows(rows: Array<Record<string, unknown>>, start: number, end: number): Row[] {
  return rows.flatMap((row) => {
    const t = Number(row.t);
    return Number.isFinite(t) && t >= start && t <= end ? [{ ...row, t } as Row] : [];
  });
}
function complete(rows: Row[]): HistoricalFetchResult {
  return { rows, coverageState: 'complete', gapSummary: {} };
}
export function dedupeHistoricalRows(rows: Row[], dataset: HistoricalDataset): Row[] {
  return [
    ...new Map(
      [...rows].sort((a, b) => a.t - b.t).map((row) => [rowIdentity(row, dataset), row])
    ).values(),
  ];
}
function rowIdentity(row: Row, dataset: HistoricalDataset): string {
  if (dataset === 'market_catalog') return `${row.t}:${row.type}:${row.symbol}`;
  if (dataset === 'funding_basis')
    return `${row.t}:${row.asset}:${row.longExchange}:${row.shortExchange}`;
  if (dataset === 'etf_flow') return `${row.t}:${row.asset ?? ''}`;
  return String(row.t);
}
async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export function historicalObjectKey(message: HistoricalBackfillQueueMessage) {
  const date = new Date(message.startTime);
  const parts = [
    `history/v1/dataset=${message.dataset}`,
    `provider=${encodeURIComponent(message.provider)}`,
  ];
  if (message.exchange) parts.push(`exchange=${message.exchange}`);
  if (message.marketType) parts.push(`type=${message.marketType}`);
  parts.push(
    `resolution=${message.resolution}`,
    `entity=${encodeURIComponent(message.entity)}`,
    `year=${date.getUTCFullYear()}`,
    `month=${String(date.getUTCMonth() + 1).padStart(2, '0')}.ndjson.gz`
  );
  return parts.join('/');
}
