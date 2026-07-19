import type { Env, Timeframe } from '../types';
import {
  BACKFILL_EXCHANGE_CAPABILITIES,
  createBackfillJob,
  DEFAULT_BACKFILL_START,
  DEFAULT_BACKFILL_SYMBOL_LIMIT,
  DEFAULT_BACKFILL_TIMEFRAMES,
  MAX_BACKFILL_TASKS,
  prepareBackfillUniverse,
  splitMonths,
  SUPPORTED_BACKFILL_EXCHANGES,
  type BackfillJobRequest,
} from './backfillService';

type CampaignStatus =
  | 'planned'
  | 'running'
  | 'paused'
  | 'complete'
  | 'complete_with_gaps'
  | 'failed'
  | 'cancelled';

export interface BackfillCampaignRequest {
  dryRun?: boolean;
  exchanges?: string[];
  symbols?: string[];
  types?: Array<'spot' | 'perp'>;
  timeframes?: Timeframe[];
  startTime?: number;
  cutoffTime?: number;
  maxSymbolsPerExchange?: number;
}

interface ComponentPlan {
  id: string;
  exchange: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  request: BackfillJobRequest;
  status: 'planned' | 'gap';
  gapReason: string | null;
}

interface ComponentRow {
  id: string;
  campaign_id: string;
  exchange: string;
  type: 'spot' | 'perp';
  timeframe: Timeframe;
  request_json: string;
  status: string;
  job_id: string | null;
}

export function lastClosedUtcMonthEnd(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - 1;
}

export async function planBackfillCampaign(request: BackfillCampaignRequest): Promise<{
  startTime: number;
  cutoffTime: number;
  components: ComponentPlan[];
  frozenUniverse: Record<string, string[]>;
  estimatedTasks: number;
  discoveryGaps: Array<{ exchange: string; type: string; error: string }>;
}> {
  const startTime = request.startTime ?? DEFAULT_BACKFILL_START;
  const cutoffTime = request.cutoffTime ?? lastClosedUtcMonthEnd();
  if (!Number.isFinite(startTime) || !Number.isFinite(cutoffTime) || startTime >= cutoffTime) {
    throw new Error('Campaign requires a valid startTime before the last closed-month cutoff');
  }
  const exchanges = request.exchanges?.length
    ? request.exchanges
    : [...SUPPORTED_BACKFILL_EXCHANGES];
  const timeframes = request.timeframes?.length
    ? request.timeframes
    : [...DEFAULT_BACKFILL_TIMEFRAMES];
  const symbolLimit = request.maxSymbolsPerExchange ?? DEFAULT_BACKFILL_SYMBOL_LIMIT;
  const frozenUniverse: Record<string, string[]> = {};
  const components: ComponentPlan[] = [];
  const discoveryGaps: Array<{ exchange: string; type: string; error: string }> = [];
  let estimatedTasks = 0;

  for (const exchange of exchanges) {
    const supportedTypes = BACKFILL_EXCHANGE_CAPABILITIES[exchange];
    if (!supportedTypes) throw new Error(`Unsupported exchange '${exchange}'`);
    const types = request.types?.length ? request.types : supportedTypes;
    for (const type of types) {
      if (!supportedTypes.includes(type)) {
        throw new Error(`Exchange '${exchange}' does not support: ${type}`);
      }
      let symbols: string[] = [];
      let discoveryError: string | null = null;
      try {
        const universe = await prepareBackfillUniverse({
          exchanges: [exchange],
          symbols: request.symbols,
          types: [type],
          timeframes: [timeframes[0] ?? '1h'],
          startTime,
          endTime: cutoffTime,
          maxSymbolsPerExchange: symbolLimit,
        });
        symbols = universe.symbolsByExchangeType[`${exchange}:${type}`] ?? [];
        frozenUniverse[`${exchange}:${type}`] = symbols;
      } catch (error) {
        discoveryError = error instanceof Error ? error.message : String(error);
        discoveryGaps.push({ exchange, type, error: discoveryError });
        frozenUniverse[`${exchange}:${type}`] = [];
      }

      for (const timeframe of timeframes) {
        if (discoveryError || symbols.length === 0) {
          components.push({
            id: componentId(exchange, type, timeframe, startTime, cutoffTime),
            exchange,
            type,
            timeframe,
            startTime,
            endTime: cutoffTime,
            request: {
              exchanges: [exchange],
              types: [type],
              timeframes: [timeframe],
              startTime,
              endTime: cutoffTime,
              maxSymbolsPerExchange: symbolLimit,
            },
            status: 'gap',
            gapReason: discoveryError ?? 'No active symbols discovered',
          });
          continue;
        }

        for (const window of partitionCampaignMonths(startTime, cutoffTime, symbols.length)) {
          const windowStart = window.start;
          const windowEnd = window.end;
          estimatedTasks += window.monthCount * symbols.length;
          components.push({
            id: componentId(exchange, type, timeframe, windowStart, windowEnd),
            exchange,
            type,
            timeframe,
            startTime: windowStart,
            endTime: windowEnd,
            request: {
              exchanges: [exchange],
              types: [type],
              timeframes: [timeframe],
              symbols,
              startTime: windowStart,
              endTime: windowEnd,
              maxSymbolsPerExchange: symbolLimit,
            },
            status: 'planned',
            gapReason: null,
          });
        }
      }
    }
  }

  return { startTime, cutoffTime, components, frozenUniverse, estimatedTasks, discoveryGaps };
}

export function partitionCampaignMonths(
  startTime: number,
  cutoffTime: number,
  symbolCount: number
): Array<{ start: number; end: number; monthCount: number }> {
  if (symbolCount < 1) return [];
  const months = splitMonths(startTime, cutoffTime);
  const monthsPerComponent = Math.max(1, Math.floor(MAX_BACKFILL_TASKS / symbolCount));
  const windows: Array<{ start: number; end: number; monthCount: number }> = [];
  for (let index = 0; index < months.length; index += monthsPerComponent) {
    const chunk = months.slice(index, index + monthsPerComponent);
    windows.push({
      start: chunk[0]!.start,
      end: chunk[chunk.length - 1]!.end,
      monthCount: chunk.length,
    });
  }
  return windows;
}

export async function createBackfillCampaign(
  env: Env,
  request: BackfillCampaignRequest
): Promise<Record<string, unknown>> {
  const plan = await planBackfillCampaign(request);
  if (request.dryRun) return { dryRun: true, ...plan };

  const campaignId = `bfc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO backfill_campaigns
      (id, status, start_time, cutoff_time, requested_config_json, frozen_universe_json,
       total_components, completed_components, gap_components, created_at, updated_at)
     VALUES (?, 'running', ?, ?, ?, ?, ?, 0, ?, unixepoch(), unixepoch())`
  )
    .bind(
      campaignId,
      plan.startTime,
      plan.cutoffTime,
      JSON.stringify(request),
      JSON.stringify(plan.frozenUniverse),
      plan.components.length,
      plan.components.filter((component) => component.status === 'gap').length
    )
    .run();

  for (let index = 0; index < plan.components.length; index += 100) {
    await env.DB.batch(
      plan.components.slice(index, index + 100).map((component) =>
        env.DB.prepare(
          `INSERT INTO backfill_campaign_components
            (id, campaign_id, exchange, type, timeframe, start_time, end_time, request_json,
             status, gap_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
        ).bind(
          `${campaignId}:${component.id}`,
          campaignId,
          component.exchange,
          component.type,
          component.timeframe,
          component.startTime,
          component.endTime,
          JSON.stringify(component.request),
          component.status,
          component.gapReason
        )
      )
    );
  }
  await advanceBackfillCampaign(env, campaignId);
  return getBackfillCampaign(env, campaignId);
}

export async function advanceBackfillCampaigns(env: Env): Promise<void> {
  const campaigns = await env.DB.prepare(
    `SELECT id FROM backfill_campaigns WHERE status = 'running' ORDER BY created_at ASC LIMIT 20`
  ).all<{ id: string }>();
  for (const campaign of campaigns.results) {
    await advanceBackfillCampaign(env, campaign.id);
  }
}

export async function advanceBackfillCampaign(env: Env, campaignId: string): Promise<void> {
  await refreshComponents(env, campaignId);
  const campaign = await env.DB.prepare(`SELECT status FROM backfill_campaigns WHERE id = ?`)
    .bind(campaignId)
    .first<{ status: CampaignStatus }>();
  if (!campaign || campaign.status !== 'running') return;

  const running = await env.DB.prepare(
    `SELECT DISTINCT exchange FROM backfill_campaign_components
     WHERE campaign_id = ? AND status = 'running'`
  )
    .bind(campaignId)
    .all<{ exchange: string }>();
  const busy = new Set(running.results.map((row) => row.exchange));
  const planned = await env.DB.prepare(
    `SELECT id, campaign_id, exchange, type, timeframe, request_json, status, job_id
     FROM backfill_campaign_components
     WHERE campaign_id = ? AND status = 'planned'
     ORDER BY exchange, type, timeframe, start_time`
  )
    .bind(campaignId)
    .all<ComponentRow>();

  for (const component of planned.results) {
    if (busy.has(component.exchange)) continue;
    busy.add(component.exchange);
    try {
      const request = JSON.parse(component.request_json) as BackfillJobRequest;
      const result = await createBackfillJob(env, request);
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE backfill_jobs SET campaign_id = ?, campaign_component_id = ? WHERE id = ?`
        ).bind(campaignId, component.id, result.jobId),
        env.DB.prepare(
          `UPDATE backfill_campaign_components
           SET status = 'running', job_id = ?, gap_reason = NULL, updated_at = unixepoch()
           WHERE id = ? AND status = 'planned'`
        ).bind(result.jobId, component.id),
      ]);
    } catch (error) {
      await env.DB.prepare(
        `UPDATE backfill_campaign_components
         SET status = 'gap', gap_reason = ?, updated_at = unixepoch() WHERE id = ?`
      )
        .bind(error instanceof Error ? error.message : String(error), component.id)
        .run();
    }
  }
  await refreshCampaignStatus(env, campaignId);
}

export async function getBackfillCampaign(
  env: Env,
  campaignId: string
): Promise<Record<string, unknown>> {
  await refreshComponents(env, campaignId);
  const campaign = await env.DB.prepare(`SELECT * FROM backfill_campaigns WHERE id = ?`)
    .bind(campaignId)
    .first();
  if (!campaign) throw new Error(`Backfill campaign '${campaignId}' not found`);
  const components = await env.DB.prepare(
    `SELECT id, exchange, type, timeframe, start_time, end_time, status, job_id, gap_reason,
            updated_at
     FROM backfill_campaign_components WHERE campaign_id = ? ORDER BY exchange, type, timeframe`
  )
    .bind(campaignId)
    .all();
  return {
    campaign,
    components: components.results,
    providerCircuits: await providerCircuits(env),
  };
}

export async function verifyBackfillCampaignPage(
  env: Env,
  campaignId: string,
  cursor: string | null,
  limit = 100
): Promise<Record<string, unknown>> {
  const boundedLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const rows = await env.DB.prepare(
    `SELECT t.id, t.object_key, t.row_count, t.coverage_state,
            m.checksum, m.first_timestamp, m.last_timestamp
     FROM backfill_tasks t
     JOIN backfill_jobs j ON j.id = t.job_id
     LEFT JOIN r2_ohlcv_manifests m ON m.object_key = t.object_key
     WHERE j.campaign_id = ? AND t.status = 'complete' AND t.object_key IS NOT NULL
       AND t.id > ?
     ORDER BY t.id ASC LIMIT ?`
  )
    .bind(campaignId, cursor ?? '', boundedLimit)
    .all<{
      id: string;
      object_key: string;
      row_count: number;
      coverage_state: string;
      checksum: string | null;
      first_timestamp: number | null;
      last_timestamp: number | null;
    }>();

  const checked = await Promise.all(
    rows.results.map(async (row) => {
      const head = await env.OHLCV_ARCHIVE.head(row.object_key);
      const metadataChecksum = head?.customMetadata?.checksum ?? null;
      let sampledChecksum: string | null = null;
      const sampled = stablePercent(row.id) === 0;
      if (sampled && head && row.checksum) {
        const object = await env.OHLCV_ARCHIVE.get(row.object_key);
        if (object) sampledChecksum = await sha256Hex(await readArchiveText(object));
      }
      return {
        ...row,
        exists: Boolean(head),
        metadataChecksum,
        sampled,
        sampledChecksum,
        valid:
          Boolean(head) &&
          Boolean(row.checksum) &&
          metadataChecksum === row.checksum &&
          (!sampled || sampledChecksum === row.checksum),
      };
    })
  );
  const nextCursor = rows.results[rows.results.length - 1]?.id ?? null;
  return {
    campaignId,
    checked,
    invalid: checked.filter((row) => !row.valid),
    nextCursor,
    done: rows.results.length < boundedLimit,
  };
}

export async function setBackfillCampaignState(
  env: Env,
  campaignId: string,
  action: 'pause' | 'resume' | 'cancel' | 'retry-gaps'
): Promise<Record<string, unknown>> {
  if (action === 'pause') {
    await env.DB.prepare(`UPDATE backfill_campaigns SET status = 'paused' WHERE id = ?`)
      .bind(campaignId)
      .run();
  } else if (action === 'resume') {
    await env.DB.prepare(
      `UPDATE backfill_campaigns SET status = 'running'
       WHERE id = ? AND status IN ('paused', 'planned')`
    )
      .bind(campaignId)
      .run();
    await advanceBackfillCampaign(env, campaignId);
  } else if (action === 'retry-gaps') {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE backfill_campaign_components
         SET status = 'planned', job_id = NULL, gap_reason = NULL
         WHERE campaign_id = ? AND status = 'gap'`
      ).bind(campaignId),
      env.DB.prepare(
        `UPDATE backfill_campaigns SET status = 'running', gap_components = 0 WHERE id = ?`
      ).bind(campaignId),
    ]);
    await advanceBackfillCampaign(env, campaignId);
  } else {
    await env.DB.batch([
      env.DB.prepare(`UPDATE backfill_campaigns SET status = 'cancelled' WHERE id = ?`).bind(
        campaignId
      ),
      env.DB.prepare(
        `UPDATE backfill_campaign_components SET status = 'cancelled'
         WHERE campaign_id = ? AND status IN ('planned', 'running')`
      ).bind(campaignId),
      env.DB.prepare(
        `UPDATE backfill_tasks SET status = 'cancelled'
         WHERE job_id IN (SELECT id FROM backfill_jobs WHERE campaign_id = ?)
           AND status IN ('pending', 'running')`
      ).bind(campaignId),
      env.DB.prepare(
        `UPDATE backfill_jobs SET status = 'cancelled', updated_at = unixepoch()
         WHERE campaign_id = ? AND status IN ('creating', 'queued', 'running')`
      ).bind(campaignId),
    ]);
  }
  return getBackfillCampaign(env, campaignId);
}

async function refreshComponents(env: Env, campaignId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE backfill_campaign_components
     SET status = 'complete', gap_reason = NULL, updated_at = unixepoch()
     WHERE campaign_id = ? AND status = 'running'
       AND job_id IN (SELECT id FROM backfill_jobs WHERE status = 'complete')
       AND NOT EXISTS (
         SELECT 1 FROM backfill_tasks
         WHERE job_id = backfill_campaign_components.job_id
           AND coverage_state != 'complete'
       )`
  )
    .bind(campaignId)
    .run();
  await env.DB.prepare(
    `UPDATE backfill_campaign_components
     SET status = 'gap',
         gap_reason = 'One or more archive partitions have incomplete coverage',
         updated_at = unixepoch()
     WHERE campaign_id = ? AND status = 'running'
       AND job_id IN (SELECT id FROM backfill_jobs WHERE status = 'complete')
       AND EXISTS (
         SELECT 1 FROM backfill_tasks
         WHERE job_id = backfill_campaign_components.job_id
           AND coverage_state != 'complete'
       )`
  )
    .bind(campaignId)
    .run();
  await env.DB.prepare(
    `UPDATE backfill_campaign_components
     SET status = 'gap',
         gap_reason = COALESCE(
           (SELECT last_error FROM backfill_tasks
            WHERE job_id = backfill_campaign_components.job_id AND status = 'failed'
            ORDER BY updated_at DESC LIMIT 1),
           'Backfill job failed'
         ),
         updated_at = unixepoch()
     WHERE campaign_id = ? AND status = 'running'
       AND job_id IN (SELECT id FROM backfill_jobs WHERE status = 'failed')`
  )
    .bind(campaignId)
    .run();
  await refreshCampaignStatus(env, campaignId);
}

async function refreshCampaignStatus(env: Env, campaignId: string): Promise<void> {
  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM backfill_campaign_components
     WHERE campaign_id = ? GROUP BY status`
  )
    .bind(campaignId)
    .all<{ status: string; count: number }>();
  const map = new Map(counts.results.map((row) => [row.status, Number(row.count)]));
  const complete = map.get('complete') ?? 0;
  const gaps = map.get('gap') ?? 0;
  const active = (map.get('planned') ?? 0) + (map.get('running') ?? 0);
  const existing = await env.DB.prepare(`SELECT status FROM backfill_campaigns WHERE id = ?`)
    .bind(campaignId)
    .first<{ status: CampaignStatus }>();
  const terminalStatus = active === 0 ? (gaps > 0 ? 'complete_with_gaps' : 'complete') : null;
  await env.DB.prepare(
    `UPDATE backfill_campaigns
     SET completed_components = ?, gap_components = ?,
         status = CASE WHEN ? IS NOT NULL AND status NOT IN ('paused', 'cancelled') THEN ? ELSE status END
     WHERE id = ?`
  )
    .bind(complete, gaps, terminalStatus, terminalStatus, campaignId)
    .run();
  if (!existing) throw new Error(`Backfill campaign '${campaignId}' not found`);
}

async function providerCircuits(env: Env): Promise<Record<string, unknown>> {
  if (!env.BACKFILL_COORDINATOR) return {};
  const entries = await Promise.all(
    SUPPORTED_BACKFILL_EXCHANGES.map(async (exchange) => {
      try {
        const id = env.BACKFILL_COORDINATOR!.idFromName(exchange);
        const response = await env
          .BACKFILL_COORDINATOR!.get(id)
          .fetch('https://coordinator/health');
        return [exchange, await response.json()] as const;
      } catch (error) {
        return [
          exchange,
          { error: error instanceof Error ? error.message : String(error) },
        ] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

function componentId(
  exchange: string,
  type: string,
  timeframe: string,
  startTime: number,
  endTime: number
): string {
  return `${exchange}:${type}:${timeframe}:${startTime}:${endTime}`;
}

async function readArchiveText(object: R2ObjectBody): Promise<string> {
  if (object.httpMetadata?.contentEncoding === 'gzip') {
    return new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return object.text();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stablePercent(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}
