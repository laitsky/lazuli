import type { FundingArbitrageOpportunity, SupportedExchange } from '@lazuli/shared';
import type { Env } from '../types';

const FIVE_MINUTES_SECONDS = 300;
const ONE_HOUR_SECONDS = 3_600;
const ONE_DAY_SECONDS = 86_400;

export interface OpenInterestObservation {
  exchange: SupportedExchange;
  symbol: string;
  marketType: 'perp';
  openInterestUsd: number;
  observedAt: number;
  provider: string;
  sourceTimestamp: number;
}

export interface OpenInterestChanges {
  change5mPercent: number | null;
  change1hPercent: number | null;
  change24hPercent: number | null;
  currentOpenInterestUsd: number;
  observedAt: number;
}

export interface FundingBasisHistoryPoint {
  asset: string;
  longExchange: SupportedExchange;
  shortExchange: SupportedExchange;
  basisPercent: number;
  grossAnnualizedYield: number;
  netAnnualizedYield: number;
  estimatedExecutionCostBps: number;
  observedAt: number;
}

interface RollupRow {
  exchange: string;
  symbol: string;
  bucket_start: number;
  value_json: string;
}

/**
 * Persist bounded restart state for actual exchange OI observations. Five-minute
 * buckets retain short-window deltas; hourly buckets make 24-hour recovery cheap.
 */
export async function persistOpenInterestObservation(
  env: Env,
  observation: OpenInterestObservation
): Promise<void> {
  if (!env.DB || !Number.isFinite(observation.openInterestUsd) || observation.openInterestUsd < 0) {
    return;
  }
  await env.DB.batch(
    [FIVE_MINUTES_SECONDS, ONE_HOUR_SECONDS].map((bucketSeconds) => {
      const bucketStart = Math.floor(observation.observedAt / 1000 / bucketSeconds) * bucketSeconds;
      const value = {
        value: observation.openInterestUsd,
        observedAt: observation.observedAt,
        sourceTimestamp: observation.sourceTimestamp,
      };
      return env.DB.prepare(
        `INSERT INTO derived_metric_rollups
          (id, metric, exchange, symbol, market_type, bucket_start, bucket_seconds,
           value_json, provenance_json, sample_count, source_fresh_at)
         VALUES (?, 'open_interest_usd', ?, ?, 'perp', ?, ?, ?, ?, 1, ?)
         ON CONFLICT(metric, exchange, symbol, market_type, bucket_seconds, bucket_start)
         DO UPDATE SET
           value_json = excluded.value_json,
           provenance_json = excluded.provenance_json,
           sample_count = derived_metric_rollups.sample_count + 1,
           source_fresh_at = excluded.source_fresh_at,
           updated_at = unixepoch()`
      ).bind(
        `oi:${observation.exchange}:${observation.symbol}:${bucketSeconds}:${bucketStart}`,
        observation.exchange,
        observation.symbol,
        bucketStart,
        bucketSeconds,
        JSON.stringify(value),
        JSON.stringify({ provider: observation.provider, model: 'observed-open-interest' }),
        Math.floor(observation.sourceTimestamp / 1000)
      );
    })
  );
}

/** Derive 5m/1h/24h changes from actual persisted observations, never OI share. */
export async function loadOpenInterestChanges(
  env: Env,
  exchange: SupportedExchange,
  symbol: string,
  now = Date.now()
): Promise<OpenInterestChanges | null> {
  if (!env.DB) return null;
  const since = Math.floor(now / 1000) - ONE_DAY_SECONDS - ONE_HOUR_SECONDS;
  const result = await env.DB.prepare(
    `SELECT exchange, symbol, bucket_start, value_json
     FROM derived_metric_rollups
     WHERE metric = 'open_interest_usd'
       AND exchange = ? AND symbol = ? AND market_type = 'perp'
       AND bucket_seconds = ? AND bucket_start >= ?
     ORDER BY bucket_start ASC`
  )
    .bind(exchange, symbol, FIVE_MINUTES_SECONDS, since)
    .all<RollupRow>();
  return calculateOpenInterestChanges(result.results ?? [], now);
}

/** Load all requested symbols with one bounded D1 range scan for dashboard use. */
export async function loadOpenInterestChangesForMarkets(
  env: Env,
  markets: Array<{ exchange: SupportedExchange; symbol: string }>,
  now = Date.now()
): Promise<Map<string, OpenInterestChanges>> {
  const output = new Map<string, OpenInterestChanges>();
  if (!env.DB || markets.length === 0) return output;
  const exchanges = Array.from(new Set(markets.map((market) => market.exchange)));
  const requested = new Set(markets.map((market) => `${market.exchange}:${market.symbol}`));
  const since = Math.floor(now / 1000) - ONE_DAY_SECONDS - ONE_HOUR_SECONDS;
  const result = await env.DB.prepare(
    `SELECT exchange, symbol, bucket_start, value_json
     FROM derived_metric_rollups
     WHERE metric = 'open_interest_usd' AND market_type = 'perp'
       AND bucket_seconds = ? AND bucket_start >= ?
       AND exchange IN (${exchanges.map(() => '?').join(',')})
     ORDER BY bucket_start ASC LIMIT 20000`
  )
    .bind(FIVE_MINUTES_SECONDS, since, ...exchanges)
    .all<RollupRow>();
  const grouped = new Map<string, RollupRow[]>();
  for (const row of result.results ?? []) {
    const key = `${row.exchange}:${row.symbol}`;
    if (!requested.has(key)) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }
  for (const [key, rows] of grouped) {
    const changes = calculateOpenInterestChanges(rows, now);
    if (changes) output.set(key, changes);
  }
  return output;
}

export function calculateOpenInterestChanges(
  rows: Array<Pick<RollupRow, 'bucket_start' | 'value_json'>>,
  now = Date.now()
): OpenInterestChanges | null {
  const observations = rows
    .flatMap((row) => {
      try {
        const value = JSON.parse(row.value_json) as { value?: unknown; observedAt?: unknown };
        return typeof value.value === 'number' && Number.isFinite(value.value)
          ? [
              {
                bucketStart: row.bucket_start,
                value: value.value,
                observedAt: Number(value.observedAt),
              },
            ]
          : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.bucketStart - right.bucketStart);
  const current = observations.at(-1);
  if (!current) return null;

  const change = (windowSeconds: number): number | null => {
    const target = Math.floor(now / 1000) - windowSeconds;
    const baseline = [...observations].reverse().find((item) => item.bucketStart <= target);
    if (!baseline || baseline.value <= 0) return null;
    return ((current.value - baseline.value) / baseline.value) * 100;
  };

  return {
    currentOpenInterestUsd: current.value,
    observedAt: Number.isFinite(current.observedAt)
      ? current.observedAt
      : current.bucketStart * 1000,
    change5mPercent: change(FIVE_MINUTES_SECONDS),
    change1hPercent: change(ONE_HOUR_SECONDS),
    change24hPercent: change(ONE_DAY_SECONDS),
  };
}

/** Store one hourly, idempotent basis/cost snapshot for each arbitrage pair. */
export async function persistFundingBasisHistory(
  env: Env,
  opportunities: FundingArbitrageOpportunity[],
  observedAt = Date.now()
): Promise<void> {
  if (!env.DB || opportunities.length === 0) return;
  const bucketStart = Math.floor(observedAt / 1000 / ONE_HOUR_SECONDS) * ONE_HOUR_SECONDS;
  await env.DB.batch(
    opportunities.slice(0, 200).map((item) =>
      env.DB.prepare(
        `INSERT INTO derived_metric_rollups
          (id, metric, exchange, symbol, market_type, bucket_start, bucket_seconds,
           value_json, provenance_json, sample_count, source_fresh_at)
         VALUES (?, 'funding_basis', ?, ?, 'perp', ?, ?, ?, ?, 1, ?)
         ON CONFLICT(metric, exchange, symbol, market_type, bucket_seconds, bucket_start)
         DO UPDATE SET value_json = excluded.value_json,
           provenance_json = excluded.provenance_json,
           sample_count = derived_metric_rollups.sample_count + 1,
           source_fresh_at = excluded.source_fresh_at,
           updated_at = unixepoch()`
      ).bind(
        `basis:${item.asset}:${item.longExchange}:${item.shortExchange}:${bucketStart}`,
        `${item.longExchange}:${item.shortExchange}`,
        item.asset,
        bucketStart,
        ONE_HOUR_SECONDS,
        JSON.stringify(item),
        JSON.stringify({ model: 'execution-cost-adjusted-funding-basis', source: 'live-funding' }),
        Math.floor(observedAt / 1000)
      )
    )
  );
}

export async function loadFundingBasisHistory(
  env: Env,
  asset: string,
  since: number,
  until: number
): Promise<FundingBasisHistoryPoint[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare(
    `SELECT exchange, symbol, bucket_start, value_json
     FROM derived_metric_rollups
     WHERE metric = 'funding_basis' AND symbol = ? AND bucket_seconds = ?
       AND bucket_start BETWEEN ? AND ?
     ORDER BY bucket_start ASC`
  )
    .bind(asset.toUpperCase(), ONE_HOUR_SECONDS, Math.floor(since / 1000), Math.floor(until / 1000))
    .all<RollupRow>();
  return (result.results ?? []).flatMap((row) => {
    try {
      const value = JSON.parse(row.value_json) as FundingArbitrageOpportunity;
      const [longExchange, shortExchange] = row.exchange.split(':') as [
        SupportedExchange,
        SupportedExchange,
      ];
      return [
        {
          asset: row.symbol,
          longExchange,
          shortExchange,
          basisPercent: value.basisPercent,
          grossAnnualizedYield: value.grossAnnualizedYield,
          netAnnualizedYield: value.netAnnualizedYield,
          estimatedExecutionCostBps: value.estimatedExecutionCostBps,
          observedAt: row.bucket_start * 1000,
        },
      ];
    } catch {
      return [];
    }
  });
}
