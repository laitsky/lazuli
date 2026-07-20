import type {
  FundingArbitrageOpportunity,
  FundingRateData,
  InstitutionalConfluenceResponse,
  MarketReplay,
  MarketReplaySeries,
  OHLCV,
  Opportunity,
  OpportunityDirection,
  OpportunityEvidence,
  OpportunityHorizon,
  OpportunityKind,
  OpportunityListResponse,
  OpportunityMetric,
  PriceArbitrageOpportunity,
  SignalCalibration,
  SupportedExchange,
  Ticker,
} from '@lazuli/shared';
import type { Env } from '../types';

export const CONVICTION_MODEL_ID = 'lazuli-conviction-v1' as const;
export const CALIBRATION_SAMPLE_MINIMUM = 100;

const LIVE_MAX_AGE_MS = 2 * 60_000;
const STALE_MAX_AGE_MS = 15 * 60_000;
const DEFAULT_FEE_BPS = 10;

export interface BuildConvictionInput {
  exchange: SupportedExchange;
  marketType: 'spot' | 'perp';
  tickers: Ticker[];
  fundingRates?: FundingRateData[];
  priceArbitrage?: PriceArbitrageOpportunity[];
  fundingArbitrage?: FundingArbitrageOpportunity[];
  institutional?: InstitutionalConfluenceResponse[];
  horizon?: OpportunityHorizon;
  limit?: number;
  now?: number;
}

interface OutcomeRow {
  net_return_percent: number | null;
  max_adverse_excursion_percent: number | null;
  won: number | null;
  coverage_state: 'complete' | 'partial' | 'failed';
}

interface OpportunityRow {
  opportunity_json: string;
}

interface ReplayRow {
  replay_json: string;
  object_key: string | null;
}

interface CalibrationArtifactRow {
  id?: string;
  calibration_json: string;
}

interface CalibrationGroupRow {
  kind: OpportunityKind;
  exchange: SupportedExchange | 'cross';
  market_type: 'spot' | 'perp';
  horizon: OpportunityHorizon;
  regime: string;
}

interface DerivedRollupRow {
  metric: string;
  bucket_start: number;
  bucket_seconds: number;
  value_json: string;
  provenance_json: string;
  source_fresh_at: number | null;
}

interface PendingOutcomeRow {
  opportunity_id: string;
  exchange: SupportedExchange | 'cross';
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: OpportunityDirection;
  horizon: OpportunityHorizon;
  entry_price: number | null;
  fee_bps: number;
  funding_bps: number;
  slippage_bps: number;
  created_at: number;
}

export function buildConvictionOpportunities(input: BuildConvictionInput): OpportunityListResponse {
  const now = input.now ?? Date.now();
  const horizon = input.horizon ?? '6h';
  const limit = clamp(Math.floor(input.limit ?? 12), 1, 50);
  const validTickers = input.tickers.filter(
    (ticker) =>
      ticker.type === input.marketType &&
      ticker.last !== null &&
      ticker.last > 0 &&
      ticker.percentage24h !== null &&
      Number.isFinite(ticker.percentage24h) &&
      (ticker.quoteVolume24h ?? 0) >= 1_000_000
  );
  const changeValues = validTickers.map((ticker) => Math.abs(ticker.percentage24h ?? 0));
  const volumeValues = validTickers.map((ticker) => Math.max(0, ticker.quoteVolume24h ?? 0));
  const openInterestValues = validTickers
    .map((ticker) => ticker.openInterest)
    .filter((value): value is number => value !== null && value !== undefined && value >= 0);
  const fundingByAsset = new Map(
    (input.fundingRates ?? []).map((rate) => [canonicalAsset(rate.baseAsset || rate.symbol), rate])
  );

  const tickerItems = validTickers
    .map((ticker) =>
      buildTickerOpportunity({
        ticker,
        exchange: input.exchange,
        horizon,
        now,
        changePercentile: percentileRank(changeValues, Math.abs(ticker.percentage24h ?? 0)),
        volumePercentile: percentileRank(volumeValues, ticker.quoteVolume24h ?? 0),
        openInterestPercentile:
          ticker.openInterest === null || ticker.openInterest === undefined
            ? null
            : percentileRank(openInterestValues, ticker.openInterest),
        funding: fundingByAsset.get(canonicalAsset(ticker.symbol)) ?? null,
      })
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(limit, 16));

  const priceArbitrageItems = (input.priceArbitrage ?? []).map((item) =>
    buildPriceArbitrageOpportunity(item, horizon, now)
  );
  const fundingArbitrageItems = (input.fundingArbitrage ?? []).map((item) =>
    buildFundingArbitrageOpportunity(item, horizon, now)
  );
  const institutionalItems = (input.institutional ?? []).map((item) =>
    buildInstitutionalOpportunity(input.exchange, item, horizon, now)
  );

  const items = [
    ...tickerItems,
    ...priceArbitrageItems,
    ...fundingArbitrageItems,
    ...institutionalItems,
  ]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    items,
    count: items.length,
    generatedAt: now,
    sourceHealth: {
      status: validTickers.length > 0 ? 'live' : 'unavailable',
      sources: [
        {
          name: `${input.exchange}:tickers`,
          status: validTickers.length > 0 ? 'live' : 'unavailable',
          itemCount: validTickers.length,
          message:
            validTickers.length > 0 ? null : 'No eligible ticker observations were available',
        },
      ],
    },
    model: {
      id: CONVICTION_MODEL_ID,
      explainable: true,
      probabilitySampleMinimum: CALIBRATION_SAMPLE_MINIMUM,
    },
  };
}

export async function hydrateOpportunityCalibrations(
  env: Pick<Env, 'DB' | 'CONVICTION_PROBABILITIES_ENABLED'>,
  response: OpportunityListResponse
): Promise<OpportunityListResponse> {
  if (!env.DB || response.items.length === 0) return response;
  const artifactIds = Array.from(
    new Set(response.items.map((opportunity) => calibrationArtifactId(opportunity)))
  );
  const artifacts = new Map<string, SignalCalibration>();
  try {
    const placeholders = artifactIds.map(() => '?').join(', ');
    const cutoff = Math.floor(
      Math.min(...response.items.map((opportunity) => opportunity.createdAt)) / 1000
    );
    const { results } = await env.DB.prepare(
      `SELECT id, calibration_json
       FROM signal_calibration_artifacts
       WHERE id IN (${placeholders}) AND built_at <= ?`
    )
      .bind(...artifactIds, cutoff)
      .all<CalibrationArtifactRow>();
    for (const row of results) {
      try {
        if (row.id) artifacts.set(row.id, JSON.parse(row.calibration_json) as SignalCalibration);
      } catch {
        // The bounded outcome query below is the safe fallback for malformed artifacts.
      }
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'conviction-engine',
        msg: 'batch calibration artifact lookup unavailable',
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
  const items = await Promise.all(
    response.items.map(async (opportunity) => {
      try {
        const stored = artifacts.get(calibrationArtifactId(opportunity));
        const calibration = calibrationForExposure(
          env,
          stored ?? (await readCalibration(env, opportunity))
        );
        return applyCalibration(opportunity, calibration);
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            module: 'conviction-engine',
            msg: 'calibration lookup unavailable',
            opportunityId: opportunity.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return opportunity;
      }
    })
  );
  return { ...response, items };
}

export function enrichOpportunityOpenInterest(
  response: OpportunityListResponse,
  changes: Map<
    string,
    {
      change1hPercent: number | null;
      currentOpenInterestUsd: number;
      observedAt: number;
    }
  >,
  now = Date.now()
): OpportunityListResponse {
  const items = response.items
    .map((opportunity) => {
      if (opportunity.exchange === 'cross' || opportunity.marketType !== 'perp') return opportunity;
      const observation = changes.get(`${opportunity.exchange}:${opportunity.symbol}`);
      if (!observation || observation.change1hPercent === null) return opportunity;
      const value = observation.change1hPercent;
      const expanding = value > 0.25;
      const contracting = value < -0.25;
      const contribution: OpportunityEvidence['contribution'] = expanding
        ? opportunity.direction === 'long'
          ? 'bullish'
          : opportunity.direction === 'short'
            ? 'bearish'
            : 'neutral'
        : contracting
          ? opportunity.direction === 'long'
            ? 'bearish'
            : opportunity.direction === 'short'
              ? 'bullish'
              : 'neutral'
          : 'neutral';
      const freshness = evidenceFreshness(observation.observedAt, now);
      const evidence = [
        ...opportunity.evidence.filter((item) => item.metric !== 'open_interest_change'),
        evidenceItem({
          id: 'open-interest-change-1h',
          metric: 'open_interest_change',
          label: '1h open-interest change',
          value,
          unit: 'percent',
          normalizedValue: clamp(50 + value * 8, 0, 100),
          contribution,
          weight: 0.1,
          summary: `Observed open interest changed ${signed(value)} over one hour; current OI is ${compactUsd(observation.currentOpenInterestUsd)}.`,
          source: `${opportunity.exchange}:observed-open-interest`,
          observedAt: observation.observedAt,
          freshness,
        }),
      ];
      const aligns = evidenceSupportsDirection(contribution, opportunity.direction);
      const opposes = evidenceOpposesDirection(contribution, opportunity.direction);
      const scoreAdjustment = freshness === 'stale' ? -5 : aligns ? 4 : opposes ? -4 : 0;
      return {
        ...opportunity,
        score: clamp(opportunity.score + scoreAdjustment, 5, 98),
        evidence,
        provenance: provenanceFromEvidence(evidence, now),
      };
    })
    .sort((left, right) => right.score - left.score);
  return { ...response, items, count: items.length };
}

export async function persistOpportunities(
  env: Pick<Env, 'DB'>,
  opportunities: Opportunity[]
): Promise<Opportunity[]> {
  if (!env.DB || opportunities.length === 0) return opportunities;
  try {
    await env.DB.batch(
      opportunities.flatMap((opportunity) => [
        env.DB.prepare(
          `INSERT OR IGNORE INTO opportunity_events
            (id, kind, exchange, symbol, market_type, direction, horizon, regime, score,
             opportunity_json, calibration_id, replay_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          opportunity.id,
          opportunity.kind,
          opportunity.exchange,
          opportunity.symbol,
          opportunity.marketType,
          opportunity.direction,
          opportunity.horizon,
          opportunity.calibration.regime,
          opportunity.score,
          JSON.stringify(opportunity),
          calibrationArtifactId(opportunity),
          opportunity.replayId,
          Math.floor(opportunity.createdAt / 1000),
          Math.floor(opportunity.expiresAt / 1000)
        ),
        env.DB.prepare(
          `INSERT OR IGNORE INTO opportunity_outcomes
            (opportunity_id, kind, exchange, symbol, market_type, direction, horizon,
             regime, entry_price, fee_bps, funding_bps, slippage_bps,
             coverage_state, failure_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          opportunity.id,
          opportunity.kind,
          opportunity.exchange,
          opportunity.symbol,
          opportunity.marketType,
          opportunity.direction,
          opportunity.horizon,
          opportunity.calibration.regime,
          opportunity.trigger.price,
          opportunity.estimatedCosts.feeBps,
          opportunity.estimatedCosts.fundingBps,
          opportunity.estimatedCosts.slippageBps,
          opportunity.exchange === 'cross' ||
            opportunity.direction === 'neutral' ||
            opportunity.trigger.price === null
            ? 'failed'
            : 'pending',
          opportunity.exchange === 'cross'
            ? 'Paired cross-exchange execution coverage is not available'
            : opportunity.direction === 'neutral'
              ? 'Neutral opportunities do not have a directional outcome label'
              : opportunity.trigger.price === null
                ? 'The opportunity has no executable entry price'
                : null,
          Math.floor(opportunity.createdAt / 1000),
          Math.floor(opportunity.createdAt / 1000)
        ),
      ])
    );
    const placeholders = opportunities.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, opportunity_json FROM opportunity_events WHERE id IN (${placeholders})`
    )
      .bind(...opportunities.map((opportunity) => opportunity.id))
      .all<{ id: string; opportunity_json: string }>();
    const canonical = new Map(
      results.flatMap((row) => {
        try {
          return [[row.id, JSON.parse(row.opportunity_json) as Opportunity] as const];
        } catch {
          return [];
        }
      })
    );
    return opportunities.map((opportunity) => {
      const stored = canonical.get(opportunity.id);
      return stored ? applyCalibration(stored, opportunity.calibration) : opportunity;
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'conviction-engine',
        msg: 'opportunity persistence unavailable',
        count: opportunities.length,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return opportunities;
  }
}

export interface OutcomeCandleCoverage {
  complete: boolean;
  covered: OHLCV[];
  reason: string | null;
}

/**
 * Requires both ends of the walk-forward window and at least 80% of expected
 * candles. This prevents a provider's short partial response from being
 * mislabeled as a complete out-of-sample result.
 */
export function validateOutcomeCandleCoverage(
  candles: OHLCV[],
  startTime: number,
  endTime: number,
  timeframeMs: number
): OutcomeCandleCoverage {
  const covered = candles
    .filter((candle) => candle.timestamp >= startTime && candle.timestamp <= endTime)
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0 || endTime <= startTime) {
    return { complete: false, covered, reason: 'Walk-forward coverage window is invalid' };
  }
  const expected = Math.floor((endTime - startTime) / timeframeMs) + 1;
  const minimum = Math.max(2, Math.ceil(expected * 0.8));
  if (covered.length < minimum) {
    return {
      complete: false,
      covered,
      reason: `Walk-forward coverage is incomplete (${covered.length}/${expected} candles)`,
    };
  }
  if ((covered[0]?.timestamp ?? Infinity) > startTime + timeframeMs) {
    return {
      complete: false,
      covered,
      reason: 'Walk-forward coverage is missing the entry window',
    };
  }
  if ((covered.at(-1)?.timestamp ?? -Infinity) < endTime - timeframeMs) {
    return { complete: false, covered, reason: 'Walk-forward coverage is missing the exit window' };
  }
  return { complete: true, covered, reason: null };
}

export async function readOpportunityEvent(
  env: Pick<Env, 'DB' | 'CONVICTION_PROBABILITIES_ENABLED'>,
  id: string
): Promise<Opportunity | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT opportunity_json FROM opportunity_events WHERE id = ? LIMIT 1`
  )
    .bind(id)
    .first<OpportunityRow>();
  if (!row) return null;
  const parsed = JSON.parse(row.opportunity_json) as Opportunity;
  try {
    return applyCalibration(
      parsed,
      calibrationForExposure(env, await readCalibration(env, parsed))
    );
  } catch {
    return parsed;
  }
}

export async function readRecentOpportunityEvents(
  env: Pick<Env, 'DB' | 'CONVICTION_PROBABILITIES_ENABLED'>,
  input: {
    exchange: SupportedExchange;
    marketType: 'spot' | 'perp';
    horizon: OpportunityHorizon;
    kind: OpportunityKind;
    limit?: number;
    now?: number;
  }
): Promise<Opportunity[]> {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT opportunity_json
     FROM opportunity_events
     WHERE exchange = ? AND market_type = ? AND horizon = ? AND kind = ? AND expires_at > ?
     ORDER BY score DESC, created_at DESC
     LIMIT ?`
  )
    .bind(
      input.exchange,
      input.marketType,
      input.horizon,
      input.kind,
      Math.floor((input.now ?? Date.now()) / 1000),
      Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)))
    )
    .all<OpportunityRow>();
  return results.flatMap((row) => {
    try {
      return [JSON.parse(row.opportunity_json) as Opportunity];
    } catch {
      return [];
    }
  });
}

export async function enqueueDueOpportunityOutcomes(
  env: Pick<Env, 'DB' | 'BACKFILL_QUEUE'>,
  now = Date.now(),
  limit = 250
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT opportunity_id
     FROM opportunity_outcomes
     WHERE coverage_state = 'pending'
       AND direction IN ('long', 'short')
       AND exchange <> 'cross'
       AND (last_enqueued_at IS NULL OR last_enqueued_at <= ? - 900)
       AND created_at + CASE horizon WHEN '1h' THEN 3600 WHEN '6h' THEN 21600 ELSE 86400 END <= ?
     ORDER BY created_at ASC
     LIMIT ?`
  )
    .bind(
      Math.floor(now / 1000),
      Math.floor(now / 1000),
      Math.max(1, Math.min(1000, Math.floor(limit)))
    )
    .all<{ opportunity_id: string }>();
  let enqueued = 0;
  for (const row of results) {
    const claim = await env.DB.prepare(
      `UPDATE opportunity_outcomes
       SET last_enqueued_at = ?
       WHERE opportunity_id = ? AND coverage_state = 'pending'
         AND (last_enqueued_at IS NULL OR last_enqueued_at <= ? - 900)`
    )
      .bind(Math.floor(now / 1000), row.opportunity_id, Math.floor(now / 1000))
      .run();
    if ((claim.meta.changes ?? 0) < 1) continue;
    try {
      await env.BACKFILL_QUEUE.send({
        kind: 'opportunity-outcome',
        opportunityId: row.opportunity_id,
      });
      enqueued += 1;
    } catch (error) {
      await env.DB.prepare(
        `UPDATE opportunity_outcomes SET last_enqueued_at = NULL
         WHERE opportunity_id = ? AND coverage_state = 'pending' AND last_enqueued_at = ?`
      )
        .bind(row.opportunity_id, Math.floor(now / 1000))
        .run();
      throw error;
    }
  }
  return enqueued;
}

export async function readPendingOpportunityOutcome(
  env: Pick<Env, 'DB'>,
  id: string
): Promise<PendingOutcomeRow | null> {
  return env.DB.prepare(
    `SELECT opportunity_id, exchange, symbol, market_type, direction, horizon, entry_price,
            fee_bps, funding_bps, slippage_bps, created_at
     FROM opportunity_outcomes
     WHERE opportunity_id = ? AND coverage_state = 'pending'
     LIMIT 1`
  )
    .bind(id)
    .first<PendingOutcomeRow>();
}

export async function resolveOpportunityOutcome(
  env: Pick<Env, 'DB'>,
  outcome: PendingOutcomeRow,
  exitPrice: number,
  resolvedAt = Date.now(),
  excursion?: { high: number; low: number }
): Promise<boolean> {
  if (
    outcome.entry_price === null ||
    outcome.entry_price <= 0 ||
    !Number.isFinite(exitPrice) ||
    exitPrice <= 0 ||
    (outcome.direction !== 'long' && outcome.direction !== 'short') ||
    !excursion ||
    !Number.isFinite(excursion.high) ||
    !Number.isFinite(excursion.low)
  ) {
    return false;
  }
  const directionalReturn =
    ((exitPrice - outcome.entry_price) / outcome.entry_price) *
    100 *
    (outcome.direction === 'short' ? -1 : 1);
  const costPercent = (outcome.fee_bps + outcome.funding_bps + outcome.slippage_bps) / 100;
  const netReturn = directionalReturn - costPercent;
  const favorableExcursion =
    outcome.direction === 'long'
      ? ((excursion.high - outcome.entry_price) / outcome.entry_price) * 100
      : ((outcome.entry_price - excursion.low) / outcome.entry_price) * 100;
  const adverseExcursion =
    outcome.direction === 'long'
      ? ((outcome.entry_price - excursion.low) / outcome.entry_price) * 100
      : ((excursion.high - outcome.entry_price) / outcome.entry_price) * 100;
  const result = await env.DB.prepare(
    `UPDATE opportunity_outcomes
     SET exit_price = ?, gross_return_percent = ?, net_return_percent = ?,
         max_favorable_excursion_percent = ?, max_adverse_excursion_percent = ?,
         won = ?, coverage_state = 'complete', resolved_at = ?, updated_at = ?
     WHERE opportunity_id = ? AND coverage_state = 'pending'`
  )
    .bind(
      exitPrice,
      round(directionalReturn, 6),
      round(netReturn, 6),
      round(Math.max(0, favorableExcursion), 6),
      round(Math.max(0, adverseExcursion), 6),
      netReturn > 0 ? 1 : 0,
      Math.floor(resolvedAt / 1000),
      Math.floor(resolvedAt / 1000),
      outcome.opportunity_id
    )
    .run();
  return (result.meta.changes ?? 0) >= 1;
}

export async function markOpportunityOutcomeCoverageFailure(
  env: Pick<Env, 'DB'>,
  id: string,
  reason: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE opportunity_outcomes
     SET coverage_state = 'failed', failure_reason = ?, resolved_at = unixepoch(),
         updated_at = unixepoch()
     WHERE opportunity_id = ? AND coverage_state = 'pending'`
  )
    .bind(reason.slice(0, 500), id)
    .run();
}

export async function buildMarketReplay(
  env: Pick<Env, 'DB'>,
  opportunity: Opportunity,
  window: MarketReplay['window'] = '6h',
  candles: OHLCV[] = []
): Promise<MarketReplay> {
  const series = await readReplaySeries(env, opportunity, window, candles);
  const uncertainty = replayUncertainty(opportunity, series);
  return {
    id: opportunity.replayId ?? replayId(opportunity.id),
    opportunityId: opportunity.id,
    exchange: opportunity.exchange,
    symbol: opportunity.symbol,
    marketType: opportunity.marketType,
    direction: opportunity.direction,
    horizon: opportunity.horizon,
    window,
    triggerAt: opportunity.createdAt,
    title: `Why ${displaySymbol(opportunity.symbol)} moved`,
    narrative: deterministicReplayNarrative(opportunity),
    uncertainty,
    series,
    provenance: opportunity.provenance,
    createdAt: Date.now(),
    expiresAt: null,
  };
}

export function marketReplayNeedsRefresh(
  replay: MarketReplay,
  now = Date.now(),
  refreshAfterMs = 5 * 60_000
): boolean {
  if (replay.exchange === 'cross' || now - replay.createdAt < refreshAfterMs) return false;
  const windowMs =
    replay.window === '1h'
      ? 60 * 60_000
      : replay.window === '6h'
        ? 6 * 60 * 60_000
        : 24 * 60 * 60_000;
  const expectedEnd = replay.triggerAt + windowMs / 2;
  const lastPricePoint = replay.series
    .find((series) => series.metric === 'price')
    ?.points.at(-1)?.timestamp;
  return lastPricePoint === undefined || lastPricePoint < expectedEnd - windowMs / 20;
}

export async function persistMarketReplay(
  env: Pick<Env, 'DB' | 'OHLCV_ARCHIVE'>,
  replay: MarketReplay
): Promise<void> {
  if (!env.DB) return;
  const objectKey = `conviction/replays/${encodeURIComponent(replay.id)}/${replay.window}.json`;
  const payload = JSON.stringify(replay);
  try {
    await env.OHLCV_ARCHIVE?.put(objectKey, payload, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { opportunityId: replay.opportunityId, model: CONVICTION_MODEL_ID },
    });
    await env.DB.prepare(
      `INSERT INTO market_replays
        (id, opportunity_id, exchange, symbol, market_type, window, replay_json, object_key,
         created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         window = excluded.window,
         replay_json = excluded.replay_json,
         object_key = excluded.object_key,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`
    )
      .bind(
        replay.id,
        replay.opportunityId,
        replay.exchange,
        replay.symbol,
        replay.marketType,
        replay.window,
        payload,
        objectKey,
        Math.floor(replay.createdAt / 1000),
        replay.expiresAt ? Math.floor(replay.expiresAt / 1000) : null
      )
      .run();
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'conviction-engine',
        msg: 'replay persistence unavailable',
        replayId: replay.id,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export async function readMarketReplay(
  env: Pick<Env, 'DB' | 'OHLCV_ARCHIVE'>,
  id: string,
  window?: MarketReplay['window']
): Promise<MarketReplay | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT replay_json, object_key
     FROM market_replays
     WHERE id = ? AND (? IS NULL OR window = ?)
     ORDER BY CASE window WHEN '6h' THEN 0 WHEN '1h' THEN 1 ELSE 2 END, created_at DESC
     LIMIT 1`
  )
    .bind(id, window ?? null, window ?? null)
    .first<ReplayRow>();
  if (!row) return null;
  if (row.object_key && env.OHLCV_ARCHIVE) {
    try {
      const object = await env.OHLCV_ARCHIVE.get(row.object_key);
      if (object) return (await object.json()) as MarketReplay;
    } catch {
      // D1 keeps a compact complete fallback for R2 outages.
    }
  }
  return JSON.parse(row.replay_json) as MarketReplay;
}

export function applyCalibration(
  opportunity: Opportunity,
  calibration: SignalCalibration
): Opportunity {
  if (calibration.status !== 'calibrated') {
    return { ...opportunity, calibration };
  }
  return {
    ...opportunity,
    calibration,
    expectedMove: {
      lowerPercent: calibration.lowerReturnPercent,
      medianPercent: calibration.medianReturnPercent,
      upperPercent: calibration.upperReturnPercent,
    },
  };
}

export function calibrationForExposure(
  env: Pick<Env, 'CONVICTION_PROBABILITIES_ENABLED'>,
  calibration: SignalCalibration
): SignalCalibration {
  if (env.CONVICTION_PROBABILITIES_ENABLED === 'true' || calibration.status !== 'calibrated') {
    return calibration;
  }
  return {
    ...calibration,
    status: 'experimental',
    probability: null,
    hitRate: null,
    methodology: `Shadow mode: calibrated statistics are retained but hidden until the probability release gate is enabled. ${calibration.methodology}`,
  };
}

function buildTickerOpportunity(input: {
  ticker: Ticker;
  exchange: SupportedExchange;
  horizon: OpportunityHorizon;
  now: number;
  changePercentile: number;
  volumePercentile: number;
  openInterestPercentile: number | null;
  funding: FundingRateData | null;
}): Opportunity {
  const { ticker, now } = input;
  const change = ticker.percentage24h ?? 0;
  const initialDirection: Exclude<OpportunityDirection, 'neutral'> = change >= 0 ? 'long' : 'short';
  const rangePosition = priceRangePosition(ticker);
  const isExhausted =
    Math.abs(change) >= 12 && rangePosition !== null && rangePosition > 0.2 && rangePosition < 0.8;
  const direction: Exclude<OpportunityDirection, 'neutral'> = isExhausted
    ? initialDirection === 'long'
      ? 'short'
      : 'long'
    : initialDirection;
  const kind: OpportunityKind = isExhausted
    ? 'mean-reversion'
    : Math.abs(change) >= 8 &&
        rangePosition !== null &&
        (rangePosition >= 0.9 || rangePosition <= 0.1)
      ? 'breakout'
      : 'momentum';
  const rangeAlignment =
    rangePosition === null
      ? 50
      : direction === 'long'
        ? rangePosition * 100
        : (1 - rangePosition) * 100;
  const timestamp = normalizedTimestamp(ticker.timestamp, now);
  const freshness = evidenceFreshness(timestamp, now);
  const evidence: OpportunityEvidence[] = [
    evidenceItem({
      id: 'return-24h',
      metric: 'price_return',
      label: '24h return',
      value: change,
      unit: 'percent',
      normalizedValue: input.changePercentile,
      contribution: change > 0 ? 'bullish' : change < 0 ? 'bearish' : 'neutral',
      weight: 0.45,
      summary: `${displaySymbol(ticker.symbol)} moved ${signed(change)} over 24 hours.`,
      source: `${input.exchange}:ticker`,
      observedAt: timestamp,
      freshness,
    }),
    evidenceItem({
      id: 'volume-percentile',
      metric: 'volume_percentile',
      label: 'Relative liquidity',
      value: ticker.quoteVolume24h,
      unit: 'usd',
      normalizedValue: input.volumePercentile,
      contribution: 'neutral',
      weight: 0.3,
      summary: `Volume ranks in the ${Math.round(input.volumePercentile)}th percentile of the scanned universe.`,
      source: `${input.exchange}:ticker`,
      observedAt: timestamp,
      freshness,
    }),
    evidenceItem({
      id: 'range-position',
      metric: 'range_position',
      label: '24h range position',
      value: rangePosition === null ? null : rangePosition * 100,
      unit: 'percent',
      normalizedValue: rangePosition === null ? null : rangePosition * 100,
      contribution:
        rangePosition === null
          ? 'neutral'
          : rangePosition >= 0.6
            ? 'bullish'
            : rangePosition <= 0.4
              ? 'bearish'
              : 'neutral',
      weight: 0.15,
      summary:
        rangePosition === null
          ? 'The current range position is unavailable.'
          : `Price is at ${Math.round(rangePosition * 100)}% of its 24h range.`,
      source: `${input.exchange}:ticker`,
      observedAt: timestamp,
      freshness: rangePosition === null ? 'missing' : freshness,
    }),
  ];

  if (
    input.openInterestPercentile !== null &&
    ticker.openInterest !== null &&
    ticker.openInterest !== undefined
  ) {
    evidence.push(
      evidenceItem({
        id: 'open-interest',
        metric: 'open_interest',
        label: 'Open interest',
        value: ticker.openInterest,
        unit: 'usd',
        normalizedValue: input.openInterestPercentile,
        contribution: 'neutral',
        weight: 0.05,
        summary: `Open interest ranks in the ${Math.round(input.openInterestPercentile)}th percentile.`,
        source: `${input.exchange}:ticker`,
        observedAt: timestamp,
        freshness,
      })
    );
  }

  if (input.funding) {
    const rate = input.funding.fundingRatePercent;
    evidence.push(
      evidenceItem({
        id: 'funding-rate',
        metric: 'funding_rate',
        label: 'Perpetual funding',
        value: rate,
        unit: 'percent',
        normalizedValue: clamp(50 + rate * 500, 0, 100),
        contribution: rate > 0.01 ? 'bearish' : rate < -0.01 ? 'bullish' : 'neutral',
        weight: 0.05,
        summary:
          rate > 0.01
            ? 'Positive funding makes crowded longs a risk.'
            : rate < -0.01
              ? 'Negative funding makes crowded shorts a potential catalyst.'
              : 'Funding is close to neutral.',
        source: `${input.funding.exchange}:funding`,
        observedAt: normalizedTimestamp(input.funding.timestamp, now),
        freshness: evidenceFreshness(normalizedTimestamp(input.funding.timestamp, now), now),
      })
    );
  }

  const coverage = evidence.filter((item) => item.freshness !== 'missing').length / evidence.length;
  const stalePenalty = evidence.some((item) => item.freshness === 'stale') ? 12 : 0;
  const fundingAlignment = input.funding
    ? direction === 'long'
      ? clamp(50 - input.funding.fundingRatePercent * 500, 0, 100)
      : clamp(50 + input.funding.fundingRatePercent * 500, 0, 100)
    : 50;
  const rawScore =
    input.changePercentile * 0.4 +
    input.volumePercentile * 0.28 +
    rangeAlignment * 0.17 +
    fundingAlignment * 0.05 +
    coverage * 100 * 0.1 -
    stalePenalty;
  const score = clamp(Math.round(rawScore), 5, 98);
  const last = ticker.last!;
  const stopDistance = clamp(Math.abs(change) * 0.0025, 0.01, 0.04);
  const signedMove = direction === 'short' ? -1 : 1;
  const medianMove = Math.max(0.5, Math.min(8, Math.abs(change) * 0.25)) * signedMove;
  const slippageBps = Math.round(clamp(18 - input.volumePercentile * 0.14, 2, 18));
  const fundingBps = input.funding ? Math.abs(input.funding.fundingRatePercent) * 100 : 0;
  const id = opportunityId(kind, input.exchange, ticker.symbol, ticker.type, input.horizon, now);
  return {
    id,
    kind,
    exchange: input.exchange,
    symbol: ticker.symbol,
    marketType: ticker.type,
    direction,
    horizon: input.horizon,
    score,
    title: `${displaySymbol(ticker.symbol)} ${kindLabel(kind)}`,
    thesis:
      kind === 'mean-reversion'
        ? `The 24h move is extended, but price no longer holds the range extreme; this is a contrarian setup.`
        : `Directional price strength, range position, and relative liquidity align for a ${input.horizon} setup.`,
    trigger: {
      description:
        direction === 'long'
          ? 'Enter only after price holds above the current breakout area or reclaims VWAP.'
          : 'Enter only after price rejects the current range or loses VWAP support.',
      price: last,
    },
    invalidation: {
      description:
        direction === 'long'
          ? 'The thesis fails below the current volatility-adjusted support.'
          : 'The thesis fails above the current volatility-adjusted resistance.',
      price: direction === 'long' ? last * (1 - stopDistance) : last * (1 + stopDistance),
    },
    expectedMove: {
      lowerPercent: medianMove * 0.5,
      medianPercent: medianMove,
      upperPercent: medianMove * 1.75,
    },
    estimatedCosts: {
      totalBps: round(DEFAULT_FEE_BPS + slippageBps + fundingBps, 2),
      feeBps: DEFAULT_FEE_BPS,
      slippageBps,
      fundingBps: round(fundingBps, 2),
    },
    evidence,
    calibration: experimentalCalibration(marketRegime(ticker)),
    provenance: provenanceFromEvidence(evidence, now),
    workspaceHref: `/workspace?exchange=${input.exchange}&symbol=${encodeURIComponent(ticker.symbol)}&type=${ticker.type}&timeframe=1h&opportunity=${encodeURIComponent(id)}`,
    replayId: replayId(id),
    createdAt: now,
    expiresAt: now + horizonMs(input.horizon),
  };
}

function buildPriceArbitrageOpportunity(
  input: PriceArbitrageOpportunity,
  horizon: OpportunityHorizon,
  now: number
): Opportunity {
  const observedAt = normalizedTimestamp(input.timestamp, now);
  const score = clamp(Math.round(40 + Math.log10(Math.max(input.spreadBps, 1)) * 18), 15, 96);
  const id = opportunityId('price-arbitrage', 'cross', input.asset, input.marketType, horizon, now);
  const evidence = [
    evidenceItem({
      id: 'price-spread',
      metric: 'price_spread',
      label: 'Cross-exchange spread',
      value: input.spreadBps,
      unit: 'score',
      normalizedValue: score,
      contribution: 'neutral',
      weight: 1,
      summary: `Buy ${input.bestBuyExchange} and sell ${input.bestSellExchange} at a ${input.spreadBps.toFixed(1)} bps gross spread.`,
      source: 'cross-exchange:quotes',
      observedAt,
      freshness: evidenceFreshness(observedAt, now),
    }),
  ];
  const feeBps = 20;
  const slippageBps = 8;
  const netPercent = Math.max(0, (input.spreadBps - feeBps - slippageBps) / 100);
  return {
    id,
    kind: 'price-arbitrage',
    exchange: 'cross',
    symbol: input.asset,
    marketType: input.marketType,
    direction: 'neutral',
    horizon,
    score,
    title: `${input.asset} cross-exchange spread`,
    thesis: `A live quote discrepancy exists between ${input.bestBuyExchange} and ${input.bestSellExchange}; execution costs and transfer constraints determine whether it is tradable.`,
    trigger: {
      description: 'Both executable quotes must remain live after fees and slippage.',
      price: input.buyPrice,
    },
    invalidation: {
      description: 'The net spread closes below estimated costs.',
      price: input.sellPrice,
    },
    expectedMove: {
      lowerPercent: 0,
      medianPercent: netPercent,
      upperPercent: input.spreadBps / 100,
    },
    estimatedCosts: { totalBps: feeBps + slippageBps, feeBps, slippageBps, fundingBps: 0 },
    evidence,
    calibration: experimentalCalibration('cross-exchange'),
    provenance: provenanceFromEvidence(evidence, now),
    workspaceHref: `/price-arbitrage?type=${input.marketType}&quote=${encodeURIComponent(input.quoteCurrency)}`,
    replayId: replayId(id),
    createdAt: now,
    expiresAt: now + 15 * 60_000,
  };
}

function buildFundingArbitrageOpportunity(
  input: FundingArbitrageOpportunity,
  horizon: OpportunityHorizon,
  now: number
): Opportunity {
  const score = clamp(
    Math.round(35 + Math.log10(Math.max(Math.abs(input.netAnnualizedYield), 1)) * 18),
    15,
    input.confidence === 'high' ? 94 : input.confidence === 'medium' ? 84 : 72
  );
  const id = opportunityId('funding-arbitrage', 'cross', input.asset, 'perp', horizon, now);
  const evidence = [
    evidenceItem({
      id: 'funding-carry',
      metric: 'funding_rate',
      label: 'Net annualized carry',
      value: input.netAnnualizedYield,
      unit: 'percent',
      normalizedValue: score,
      contribution: 'neutral',
      weight: 0.7,
      summary: `${input.longExchange} versus ${input.shortExchange} produces ${input.netAnnualizedYield.toFixed(2)}% estimated net annualized carry.`,
      source: 'cross-exchange:funding',
      observedAt: now,
      freshness: 'live',
    }),
    evidenceItem({
      id: 'basis',
      metric: 'basis',
      label: 'Cross-exchange basis',
      value: input.basisPercent,
      unit: 'percent',
      normalizedValue: clamp(50 - Math.abs(input.basisPercent) * 50, 0, 100),
      contribution: Math.abs(input.basisPercent) > 0.5 ? 'bearish' : 'neutral',
      weight: 0.3,
      summary: `Current basis is ${input.basisPercent.toFixed(3)}%; convergence can dominate funding income.`,
      source: 'cross-exchange:funding',
      observedAt: now,
      freshness: 'live',
    }),
  ];
  return {
    id,
    kind: 'funding-arbitrage',
    exchange: 'cross',
    symbol: input.asset,
    marketType: 'perp',
    direction: 'neutral',
    horizon,
    score,
    title: `${input.asset} funding carry`,
    thesis: `The funding differential pays a hedged long/short position, subject to basis convergence and execution constraints.`,
    trigger: {
      description: 'Activate only while net carry remains positive after basis and costs.',
      price: null,
    },
    invalidation: {
      description:
        'Exit when funding flips, basis expands, or borrow/execution costs erase the carry.',
      price: null,
    },
    expectedMove: {
      lowerPercent: null,
      medianPercent: input.netAnnualizedYield / 365,
      upperPercent: null,
    },
    estimatedCosts: {
      totalBps: input.estimatedExecutionCostBps,
      feeBps: Math.min(input.estimatedExecutionCostBps, 20),
      slippageBps: Math.max(0, input.estimatedExecutionCostBps - 20),
      fundingBps: 0,
    },
    evidence,
    calibration: experimentalCalibration('cross-exchange'),
    provenance: provenanceFromEvidence(evidence, now),
    workspaceHref: '/funding-arbitrage',
    replayId: replayId(id),
    createdAt: now,
    expiresAt: now + 8 * 60 * 60_000,
  };
}

function buildInstitutionalOpportunity(
  exchange: SupportedExchange,
  input: InstitutionalConfluenceResponse,
  horizon: OpportunityHorizon,
  now: number
): Opportunity {
  const direction: OpportunityDirection =
    input.regimeScore >= 56 ? 'long' : input.regimeScore <= 44 ? 'short' : 'neutral';
  const score = clamp(
    Math.round(40 + Math.abs(input.regimeScore - 50) * 0.8 + input.confidence * 0.2),
    20,
    95
  );
  const symbol = `${input.asset}-USDT`;
  const id = opportunityId('institutional', exchange, symbol, 'spot', horizon, now);
  const signalEvidence = input.signals.map((signal) => {
    const metric = institutionalMetric(signal.id);
    return evidenceItem({
      id: signal.id,
      metric,
      label: signal.label,
      value: parseInstitutionalEvidenceValue(metric, signal.value),
      unit: metric === 'etf_flow' ? 'usd' : metric === 'institutional_regime' ? 'text' : 'percent',
      normalizedValue: signal.score,
      contribution:
        signal.direction === 'bullish'
          ? 'bullish'
          : signal.direction === 'bearish' || signal.direction === 'risk'
            ? 'bearish'
            : 'neutral',
      weight: 1 / Math.max(1, input.signals.length),
      summary: signal.explanation,
      source: 'institutional:confluence',
      observedAt: input.timestamp,
      freshness: signal.fresh ? evidenceFreshness(input.timestamp, now) : 'stale',
    });
  });
  const optionsSignal = input.signals.find((signal) => signal.id === 'optionsSkew');
  const ivRankMatch = optionsSignal?.explanation.match(/IV rank\s+([\d.]+)/i);
  const evidence = [
    ...signalEvidence,
    evidenceItem({
      id: 'institutional-regime',
      metric: 'institutional_regime',
      label: 'Institutional regime',
      value: input.regime,
      unit: 'text',
      normalizedValue: input.regimeScore,
      contribution:
        direction === 'long' ? 'bullish' : direction === 'short' ? 'bearish' : 'neutral',
      weight: 0.12,
      summary: input.summary,
      source: 'institutional:confluence',
      observedAt: input.timestamp,
      freshness: evidenceFreshness(input.timestamp, now),
    }),
    ...(ivRankMatch
      ? [
          evidenceItem({
            id: 'institutional-iv-rank',
            metric: 'iv_rank',
            label: 'Options IV rank',
            value: Number(ivRankMatch[1]),
            unit: 'score',
            normalizedValue: Number(ivRankMatch[1]),
            contribution: 'neutral',
            weight: 0.05,
            summary: `Observed options IV rank is ${ivRankMatch[1]}.`,
            source: 'institutional:options-volatility',
            observedAt: input.timestamp,
            freshness: optionsSignal?.fresh ? evidenceFreshness(input.timestamp, now) : 'stale',
          }),
        ]
      : []),
  ];
  return {
    id,
    kind: 'institutional',
    exchange,
    symbol,
    marketType: 'spot',
    direction,
    horizon,
    score,
    title: `${input.asset} ${input.regime} regime`,
    thesis: input.summary,
    trigger: {
      description: 'Use this regime only while a majority of fresh institutional signals agree.',
      price: null,
    },
    invalidation: {
      description:
        'The thesis weakens when provider confidence falls or regime score crosses neutral.',
      price: null,
    },
    expectedMove: { lowerPercent: null, medianPercent: null, upperPercent: null },
    estimatedCosts: { totalBps: 12, feeBps: 10, slippageBps: 2, fundingBps: 0 },
    evidence,
    calibration: experimentalCalibration(input.regime),
    provenance: provenanceFromEvidence(evidence, now),
    workspaceHref: `/workspace?exchange=${exchange}&symbol=${symbol}&type=spot&timeframe=4h&opportunity=${encodeURIComponent(id)}`,
    replayId: replayId(id),
    createdAt: now,
    expiresAt: now + horizonMs(horizon),
  };
}

async function readCalibration(
  env: Pick<Env, 'DB'>,
  opportunity: Opportunity
): Promise<SignalCalibration> {
  const artifact = await env.DB.prepare(
    `SELECT calibration_json
     FROM signal_calibration_artifacts
     WHERE id = ? AND built_at <= ?
     LIMIT 1`
  )
    .bind(calibrationArtifactId(opportunity), Math.floor(opportunity.createdAt / 1000))
    .first<CalibrationArtifactRow>();
  if (artifact) {
    try {
      return JSON.parse(artifact.calibration_json) as SignalCalibration;
    } catch {
      // Fall through to the bounded D1 calculation when an artifact is malformed.
    }
  }
  const { results } = await env.DB.prepare(
    `SELECT net_return_percent, max_adverse_excursion_percent, won, coverage_state
     FROM opportunity_outcomes
     WHERE kind = ? AND exchange = ? AND market_type = ? AND horizon = ?
       AND regime = ?
       AND coverage_state IN ('complete', 'partial', 'failed')
       AND created_at < ?
     ORDER BY resolved_at DESC
     LIMIT 1000`
  )
    .bind(
      opportunity.kind,
      opportunity.exchange,
      opportunity.marketType,
      opportunity.horizon,
      opportunity.calibration.regime,
      Math.floor(opportunity.createdAt / 1000)
    )
    .all<OutcomeRow>();
  return calibrationFromOutcomeRows(
    results,
    opportunity.calibration.regime,
    calibrationArtifactId(opportunity)
  );
}

function calibrationFromOutcomeRows(
  results: OutcomeRow[],
  regime: string,
  artifactId: string
): SignalCalibration {
  if (results.length === 0) return { ...experimentalCalibration(regime), artifactId };
  const completeResults = results.filter(
    (row) => row.coverage_state === 'complete' && row.net_return_percent !== null
  );
  const returns = completeResults
    .map((row) => row.net_return_percent)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const adverse = completeResults
    .map((row) => row.max_adverse_excursion_percent)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const sampleSize = returns.length;
  const hitRate =
    sampleSize > 0 ? completeResults.filter((row) => row.won === 1).length / sampleSize : null;
  const calibrated = sampleSize >= CALIBRATION_SAMPLE_MINIMUM;
  return {
    artifactId,
    status: calibrated ? 'calibrated' : 'experimental',
    sampleSize,
    coveragePercent: (completeResults.length / results.length) * 100,
    probability: calibrated ? hitRate : null,
    hitRate: calibrated ? hitRate : null,
    medianReturnPercent: calibrated ? quantile(returns, 0.5) : null,
    lowerReturnPercent: calibrated ? quantile(returns, 0.1) : null,
    upperReturnPercent: calibrated ? quantile(returns, 0.9) : null,
    medianAdverseExcursionPercent: calibrated ? quantile(adverse, 0.5) : null,
    regime,
    methodology: calibrated
      ? 'Walk-forward outcomes after fees, funding, and slippage; failed coverage is disclosed separately from the return distribution.'
      : `Probability hidden until ${CALIBRATION_SAMPLE_MINIMUM} comparable out-of-sample outcomes exist; failed coverage remains in the coverage denominator.`,
  };
}

export async function rebuildCalibrationArtifacts(
  env: Pick<Env, 'DB' | 'OHLCV_ARCHIVE'>,
  now = Date.now()
): Promise<{ rebuilt: number; failed: number }> {
  const { results: groups } = await env.DB.prepare(
    `SELECT DISTINCT kind, exchange, market_type, horizon, regime
     FROM opportunity_outcomes
     WHERE coverage_state = 'complete' AND net_return_percent IS NOT NULL
     ORDER BY kind, exchange, market_type, horizon, regime
     LIMIT 250`
  ).all<CalibrationGroupRow>();
  let rebuilt = 0;
  let failed = 0;
  for (const group of groups) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT net_return_percent, max_adverse_excursion_percent, won, coverage_state
         FROM opportunity_outcomes
         WHERE kind = ? AND exchange = ? AND market_type = ? AND horizon = ? AND regime = ?
           AND coverage_state IN ('complete', 'partial', 'failed')
           AND resolved_at <= ?
         ORDER BY resolved_at DESC
         LIMIT 1000`
      )
        .bind(
          group.kind,
          group.exchange,
          group.market_type,
          group.horizon,
          group.regime,
          Math.floor(now / 1000)
        )
        .all<OutcomeRow>();
      const id = calibrationArtifactId(group);
      const calibration = calibrationFromOutcomeRows(results, group.regime, id);
      const objectKey = `conviction/calibrations/${encodeURIComponent(id)}.json`;
      await env.OHLCV_ARCHIVE.put(
        objectKey,
        JSON.stringify({
          id,
          builtAt: now,
          calibration,
          returns: results.map((row) => row.net_return_percent),
          adverseExcursions: results.map((row) => row.max_adverse_excursion_percent),
          outcomes: results.map((row) => row.won),
        }),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            model: CONVICTION_MODEL_ID,
            sampleSize: String(calibration.sampleSize),
          },
        }
      );
      await env.DB.prepare(
        `INSERT INTO signal_calibration_artifacts
          (id, kind, exchange, market_type, horizon, regime, sample_size,
           calibration_json, object_key, built_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sample_size = excluded.sample_size,
           calibration_json = excluded.calibration_json,
           object_key = excluded.object_key,
           built_at = excluded.built_at`
      )
        .bind(
          id,
          group.kind,
          group.exchange,
          group.market_type,
          group.horizon,
          group.regime,
          calibration.sampleSize,
          JSON.stringify(calibration),
          objectKey,
          Math.floor(now / 1000)
        )
        .run();
      rebuilt += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        JSON.stringify({
          level: 'warn',
          module: 'conviction-engine',
          msg: 'calibration artifact rebuild failed',
          group,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
  return { rebuilt, failed };
}

async function readReplaySeries(
  env: Pick<Env, 'DB'>,
  opportunity: Opportunity,
  window: MarketReplay['window'],
  candles: OHLCV[]
): Promise<MarketReplaySeries[]> {
  const triggerSeconds = Math.floor(opportunity.createdAt / 1000);
  const windowSeconds = window === '1h' ? 3600 : window === '6h' ? 21_600 : 86_400;
  const start = triggerSeconds - Math.floor(windowSeconds / 2);
  const end = triggerSeconds + Math.floor(windowSeconds / 2);
  const output = new Map<string, MarketReplaySeries>();
  const centeredCandles = candles.filter(
    (candle) => candle.timestamp >= start * 1000 && candle.timestamp <= end * 1000
  );
  if (centeredCandles.length > 0) {
    output.set('price', {
      metric: 'price',
      label: 'Price',
      unit: 'price',
      source: `${opportunity.exchange}:ohlcv`,
      points: centeredCandles.map((candle) => ({
        timestamp: candle.timestamp,
        value: candle.close,
      })),
    });
    output.set('volume_ratio', {
      metric: 'volume_ratio',
      label: 'Base volume',
      unit: 'ratio',
      source: `${opportunity.exchange}:ohlcv`,
      points: centeredCandles.map((candle) => ({
        timestamp: candle.timestamp,
        value: candle.volume,
      })),
    });
  } else if (opportunity.trigger.price !== null) {
    output.set('price', {
      metric: 'price',
      label: 'Trigger price',
      unit: 'price',
      source: `${opportunity.exchange}:ticker`,
      points: [{ timestamp: opportunity.createdAt, value: opportunity.trigger.price }],
    });
  }
  if (env.DB && opportunity.exchange !== 'cross') {
    try {
      const { results } = await env.DB.prepare(
        `SELECT metric, bucket_start, bucket_seconds, value_json, provenance_json, source_fresh_at
         FROM derived_metric_rollups
         WHERE exchange = ? AND symbol = ? AND market_type = ?
           AND bucket_start BETWEEN ? AND ?
         ORDER BY bucket_start ASC
         LIMIT 2000`
      )
        .bind(opportunity.exchange, opportunity.symbol, opportunity.marketType, start, end)
        .all<DerivedRollupRow>();
      for (const row of results) {
        const metric = replayMetric(row.metric);
        if (!metric) continue;
        const value = firstFiniteNumber(JSON.parse(row.value_json) as unknown);
        if (value === null) continue;
        const existing = output.get(metric) ?? {
          metric,
          label: replayMetricLabel(metric),
          unit: replayMetricUnit(metric),
          source: replayProvider(row.provenance_json, row.metric),
          points: [],
        };
        existing.points.push({ timestamp: row.bucket_start * 1000, value });
        output.set(metric, existing);
      }
    } catch {
      // Fall back to the immutable opportunity evidence below.
    }
  }
  for (const item of opportunity.evidence) {
    if (typeof item.value !== 'number' || !Number.isFinite(item.value)) continue;
    const key = item.metric;
    const existing = output.get(key) ?? {
      metric: item.metric,
      label: item.label,
      unit: replayMetricUnit(item.metric),
      source: item.source,
      points: [],
    };
    if (!existing.points.some((point) => point.timestamp === item.observedAt)) {
      existing.points.push({ timestamp: item.observedAt, value: item.value });
    }
    existing.points.sort((left, right) => left.timestamp - right.timestamp);
    output.set(key, existing);
  }
  return [...output.values()];
}

function deterministicReplayNarrative(opportunity: Opportunity): string {
  const price = opportunity.evidence.find((item) => item.metric === 'price_return');
  const oi = opportunity.evidence.find(
    (item) => item.metric === 'open_interest' || item.metric === 'open_interest_change'
  );
  const funding = opportunity.evidence.find((item) => item.metric === 'funding_rate');
  const liquidation = opportunity.evidence.find((item) => item.metric === 'liquidation_imbalance');
  const clauses: string[] = [];
  if (typeof price?.value === 'number') clauses.push(`price moved ${signed(price.value)} over 24h`);
  if (oi) clauses.push(`open-interest evidence was ${oi.contribution}`);
  if (funding) clauses.push(`funding was ${funding.contribution}`);
  if (liquidation) clauses.push(`liquidation pressure was ${liquidation.contribution}`);
  const evidenceClause =
    clauses.length > 0 ? clauses.join(', while ') : 'available evidence was limited';
  return `${opportunity.title}: ${evidenceClause}. The ${opportunity.direction} interpretation is deterministic and remains invalid if ${opportunity.invalidation.description.toLowerCase()}`;
}

function replayUncertainty(opportunity: Opportunity, series: MarketReplaySeries[]): string[] {
  const output: string[] = [];
  const stale = opportunity.evidence
    .filter((item) => item.freshness === 'stale')
    .map((item) => item.label);
  const missing = opportunity.evidence
    .filter((item) => item.freshness === 'missing')
    .map((item) => item.label);
  if (stale.length > 0) output.push(`Stale evidence: ${stale.join(', ')}.`);
  if (missing.length > 0) output.push(`Missing evidence: ${missing.join(', ')}.`);
  if (series.filter((item) => item.points.length >= 3).length < 2) {
    output.push(
      'Historical replay coverage is partial; isolated snapshots are shown where rollups are unavailable.'
    );
  }
  const priceSeries = series.find((item) => item.metric === 'price');
  if (!priceSeries?.points.some((point) => point.timestamp > opportunity.createdAt)) {
    output.push(
      'Post-trigger price coverage is not available yet; this replay will become complete as the horizon resolves.'
    );
  }
  if (opportunity.calibration.status !== 'calibrated') {
    output.push(
      `The setup is experimental until ${CALIBRATION_SAMPLE_MINIMUM} comparable outcomes resolve.`
    );
  }
  return output;
}

function experimentalCalibration(regime = 'unclassified'): SignalCalibration {
  return {
    status: 'experimental',
    sampleSize: 0,
    probability: null,
    hitRate: null,
    medianReturnPercent: null,
    lowerReturnPercent: null,
    upperReturnPercent: null,
    medianAdverseExcursionPercent: null,
    regime,
    methodology: `Probability hidden until ${CALIBRATION_SAMPLE_MINIMUM} comparable out-of-sample outcomes exist.`,
  };
}

function evidenceItem(input: OpportunityEvidence): OpportunityEvidence {
  return {
    ...input,
    normalizedValue:
      input.normalizedValue === null ? null : round(clamp(input.normalizedValue, 0, 100), 2),
    weight: round(clamp(input.weight, 0, 1), 4),
  };
}

function provenanceFromEvidence(
  evidence: OpportunityEvidence[],
  now: number
): Opportunity['provenance'] {
  return [...new Map(evidence.map((item) => [item.source, item])).values()].map((item) => ({
    source: item.source,
    quality:
      item.freshness === 'live'
        ? 'live'
        : item.freshness === 'fresh'
          ? 'snapshot'
          : item.freshness === 'stale'
            ? 'stale'
            : 'missing',
    observedAt: item.freshness === 'missing' ? null : item.observedAt,
    ageMs: item.freshness === 'missing' ? null : Math.max(0, now - item.observedAt),
  }));
}

function priceRangePosition(ticker: Ticker): number | null {
  if (
    ticker.last === null ||
    ticker.low24h === null ||
    ticker.high24h === null ||
    ticker.high24h <= ticker.low24h
  ) {
    return null;
  }
  return clamp((ticker.last - ticker.low24h) / (ticker.high24h - ticker.low24h), 0, 1);
}

function marketRegime(ticker: Ticker): string {
  const change = ticker.percentage24h ?? 0;
  const range = priceRangePosition(ticker);
  if (Math.abs(change) >= 10) return 'high-volatility';
  if (change >= 3 && (range === null || range >= 0.6)) return 'trend-up';
  if (change <= -3 && (range === null || range <= 0.4)) return 'trend-down';
  return 'range';
}

function percentileRank(values: number[], value: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const candidate of finite) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
  }
  return ((below + equal * 0.5) / finite.length) * 100;
}

function quantile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const index = (values.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = values[lower] ?? values[0]!;
  const upperValue = values[upper] ?? values[values.length - 1]!;
  return round(lowerValue + (upperValue - lowerValue) * (index - lower), 4);
}

function evidenceFreshness(observedAt: number, now: number): OpportunityEvidence['freshness'] {
  const age = Math.max(0, now - observedAt);
  if (age <= LIVE_MAX_AGE_MS) return 'live';
  if (age <= STALE_MAX_AGE_MS) return 'fresh';
  return 'stale';
}

function normalizedTimestamp(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function opportunityId(
  kind: OpportunityKind,
  exchange: SupportedExchange | 'cross',
  symbol: string,
  marketType: 'spot' | 'perp',
  horizon: OpportunityHorizon,
  now: number
): string {
  const bucket = Math.floor(now / (5 * 60_000));
  return `opp:${kind}:${exchange}:${slug(symbol)}:${marketType}:${horizon}:${bucket}`;
}

function calibrationArtifactId(
  value:
    | Opportunity
    | {
        kind: OpportunityKind;
        exchange: SupportedExchange | 'cross';
        market_type: 'spot' | 'perp';
        horizon: OpportunityHorizon;
        regime: string;
      }
): string {
  const marketType = 'marketType' in value ? value.marketType : value.market_type;
  const regime = 'calibration' in value ? value.calibration.regime : value.regime;
  return `calibration:${value.kind}:${value.exchange}:${marketType}:${value.horizon}:${slug(regime)}`;
}

function replayId(opportunityIdValue: string): string {
  return `replay:${opportunityIdValue.replace(/^opp:/, '')}`;
}

function horizonMs(horizon: OpportunityHorizon): number {
  return horizon === '1h' ? 60 * 60_000 : horizon === '6h' ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
}

function canonicalAsset(value: string): string {
  const normalized = value.toUpperCase().replace(/\.P$/, '').replace(/[\/-]/g, '');
  const stripped = normalized.replace(/(USDT|USDC|FDUSD|USD|KRW|BTC|ETH)$/, '');
  return stripped || normalized;
}

function institutionalMetric(
  id: InstitutionalConfluenceResponse['signals'][number]['id']
): OpportunityMetric {
  switch (id) {
    case 'etfDemand':
      return 'etf_flow';
    case 'optionsSkew':
      return 'options_skew';
    case 'perpLeverage':
      return 'funding_rate';
    case 'basisStress':
      return 'basis';
    case 'spotTrend':
      return 'price_return';
    default:
      return 'institutional_regime';
  }
}

function parseInstitutionalEvidenceValue(
  metric: OpportunityMetric,
  value: string
): number | string {
  if (metric === 'institutional_regime') return value;
  const parsed = Number.parseFloat(value.replace(/[^\d.+-]/g, ''));
  if (!Number.isFinite(parsed)) return value;
  if (metric !== 'etf_flow') return parsed;
  const normalized = value.toUpperCase();
  if (normalized.includes('B')) return parsed * 1_000_000_000;
  if (normalized.includes('M')) return parsed * 1_000_000;
  if (normalized.includes('K')) return parsed * 1_000;
  return parsed;
}

function replayMetric(value: string): OpportunityMetric | null {
  const normalized = value.toLowerCase().replace(/-/g, '_');
  if (normalized.includes('funding_basis') || normalized === 'basis') return 'basis';
  if (normalized.includes('funding')) return 'funding_rate';
  if (normalized.includes('open_interest')) return 'open_interest_change';
  if (normalized.includes('cvd') || normalized.includes('trade')) return 'cvd_delta';
  if (normalized.includes('liquidation')) return 'liquidation_imbalance';
  if (normalized.includes('volume')) return 'volume_ratio';
  return null;
}

function replayMetricLabel(metric: OpportunityMetric): string {
  return metric.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function replayMetricUnit(metric: OpportunityMetric): MarketReplaySeries['unit'] {
  if (metric === 'open_interest' || metric === 'etf_flow') return 'usd';
  if (metric === 'cvd_delta' || metric === 'volume_ratio' || metric === 'volume_percentile') {
    return 'ratio';
  }
  if (metric === 'institutional_regime' || metric === 'iv_rank' || metric === 'rsi') return 'score';
  return 'percent';
}

function replayProvider(value: string, fallback: string): string {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed.provider === 'string' ? parsed.provider : fallback;
  } catch {
    return fallback;
  }
}

function firstFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstFiniteNumber(item);
      if (found !== null) return found;
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = firstFiniteNumber(item);
      if (found !== null) return found;
    }
  }
  return null;
}

function kindLabel(kind: OpportunityKind): string {
  return kind === 'mean-reversion'
    ? 'mean-reversion setup'
    : kind === 'breakout'
      ? 'breakout setup'
      : kind === 'momentum'
        ? 'momentum setup'
        : kind.replace(/-/g, ' ');
}

function displaySymbol(symbol: string): string {
  return symbol.replace(/\.P$/, ' PERP').replace(/-/g, '/');
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function compactUsd(value: number): string {
  return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
}

function evidenceSupportsDirection(
  contribution: OpportunityEvidence['contribution'],
  direction: OpportunityDirection
): boolean {
  return (
    (direction === 'long' && contribution === 'bullish') ||
    (direction === 'short' && contribution === 'bearish')
  );
}

function evidenceOpposesDirection(
  contribution: OpportunityEvidence['contribution'],
  direction: OpportunityDirection
): boolean {
  return (
    (direction === 'long' && contribution === 'bearish') ||
    (direction === 'short' && contribution === 'bullish')
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
