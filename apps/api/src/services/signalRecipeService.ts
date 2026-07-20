import type {
  Opportunity,
  OpportunityEvidence,
  OpportunityHorizon,
  SignalCalibration,
  SignalRecipe,
  SignalRecipeCondition,
  SignalRecipePreview,
  SignalRecipeUniverse,
} from '@lazuli/shared';
import type { Env } from '../types';
import { enqueueAlertDeliveries } from './notificationDeliveryService';
import { calibrationForExposure } from './convictionEngineService';

export interface SignalRecipeInput {
  name: string;
  universe: SignalRecipeUniverse;
  horizon: OpportunityHorizon;
  conditions: SignalRecipeCondition[];
  minScore?: number;
  cooldownSeconds?: number;
  deliveryChannelIds?: string[];
  active?: boolean;
}

export interface SignalRecipeUpdate {
  active?: boolean;
  deliveryChannelIds?: string[];
  cooldownSeconds?: number;
}

interface SignalRecipeRow {
  id: string;
  root_id: string;
  user_id: string;
  name: string;
  version: number;
  universe_json: string;
  horizon: OpportunityHorizon;
  conditions_json: string;
  min_score: number;
  cooldown_seconds: number;
  delivery_channel_ids_json: string;
  active: number;
  preview_json: string;
  created_at: number;
  updated_at: number;
}

interface PreviewOutcomeRow {
  opportunity_json: string;
  net_return_percent: number | null;
  max_adverse_excursion_percent: number | null;
  won: number | null;
  coverage_state: string;
  created_at: number;
}

const SUPPORTED_METRICS = new Set<SignalRecipeCondition['metric']>([
  'price_return',
  'range_position',
  'volume_percentile',
  'volume_ratio',
  'rsi',
  'cvd_delta',
  'open_interest',
  'open_interest_change',
  'funding_rate',
  'funding_percentile',
  'liquidation_imbalance',
  'basis',
  'price_spread',
  'etf_flow',
  'iv_rank',
  'options_skew',
  'institutional_regime',
]);
const SUPPORTED_OPERATORS = new Set<SignalRecipeCondition['operator']>([
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
]);
const INSTITUTIONAL_REGIMES = new Set([
  'spot-led',
  'etf-led',
  'options-led',
  'leverage-led',
  'fragile',
  'mixed',
]);

export function validateSignalRecipeInput(input: SignalRecipeInput): SignalRecipeInput {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new Error('name must contain 2 to 80 characters');
  }
  if (!['1h', '6h', '24h'].includes(input.horizon)) {
    throw new Error('horizon must be 1h, 6h, or 24h');
  }
  if (input.conditions.length < 1 || input.conditions.length > 5) {
    throw new Error('conditions must contain between 1 and 5 AND rules');
  }
  const conditionIds = new Set<string>();
  const conditions = input.conditions.map((condition, index) => {
    if (!SUPPORTED_METRICS.has(condition.metric)) {
      throw new Error(`conditions[${index}].metric is unsupported`);
    }
    if (!SUPPORTED_OPERATORS.has(condition.operator)) {
      throw new Error(`conditions[${index}].operator is unsupported`);
    }
    if (condition.window !== input.horizon) {
      throw new Error(`conditions[${index}].window must match the recipe horizon`);
    }
    if (
      (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) &&
      (typeof condition.value !== 'string' || condition.value.trim().length === 0)
    ) {
      throw new Error(`conditions[${index}].value must be a finite number or non-empty string`);
    }
    if (typeof condition.value === 'string' && condition.operator !== 'eq') {
      throw new Error(`conditions[${index}].operator must be eq for text values`);
    }
    if (condition.metric === 'institutional_regime' && typeof condition.value !== 'string') {
      throw new Error(`conditions[${index}].value must be text for institutional_regime`);
    }
    if (
      condition.metric === 'institutional_regime' &&
      typeof condition.value === 'string' &&
      !INSTITUTIONAL_REGIMES.has(condition.value.trim().toLowerCase())
    ) {
      throw new Error(`conditions[${index}].value is not a supported institutional regime`);
    }
    const id = condition.id.trim() || `condition-${index + 1}`;
    if (conditionIds.has(id)) throw new Error('condition ids must be unique');
    conditionIds.add(id);
    return {
      ...condition,
      id,
      value:
        typeof condition.value === 'string'
          ? condition.metric === 'institutional_regime'
            ? condition.value.trim().toLowerCase()
            : condition.value.trim()
          : condition.value,
    };
  });
  if (!['watchlist', 'exchange', 'top-liquid'].includes(input.universe.kind)) {
    throw new Error('universe.kind is unsupported');
  }
  if (!['spot', 'perp', 'both'].includes(input.universe.marketType)) {
    throw new Error('universe.marketType is unsupported');
  }
  if (input.universe.symbols.length > 100) {
    throw new Error('universe.symbols may contain at most 100 symbols');
  }
  const symbols = Array.from(
    new Set(input.universe.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))
  );
  if (input.universe.kind === 'watchlist' && symbols.length === 0) {
    throw new Error('watchlist recipes require at least one symbol');
  }
  const minScore = boundedNumber(input.minScore ?? 60, 0, 100, 'minScore');
  const cooldownSeconds = Math.round(
    boundedNumber(input.cooldownSeconds ?? 3600, 60, 7 * 24 * 3600, 'cooldownSeconds')
  );
  const deliveryChannelIds = sanitizeIds(input.deliveryChannelIds ?? [], 20);
  return {
    name,
    universe: { ...input.universe, symbols },
    horizon: input.horizon,
    conditions,
    minScore,
    cooldownSeconds,
    deliveryChannelIds,
    active: input.active === true,
  };
}

export async function listSignalRecipes(env: Env, userId: string): Promise<SignalRecipe[]> {
  const { results } = await env.DB.prepare(
    `SELECT recipes.*
     FROM signal_recipes recipes
     INNER JOIN (
       SELECT root_id, MAX(version) AS latest_version
       FROM signal_recipes
       WHERE user_id = ?
       GROUP BY root_id
     ) latest ON latest.root_id = recipes.root_id AND latest.latest_version = recipes.version
     WHERE recipes.user_id = ?
     ORDER BY recipes.updated_at DESC
     LIMIT 100`
  )
    .bind(userId, userId)
    .all<SignalRecipeRow>();
  return results.map(mapSignalRecipe);
}

export async function createSignalRecipe(
  env: Env,
  userId: string,
  rawInput: SignalRecipeInput,
  idempotencyKey: string | null = null
): Promise<SignalRecipe> {
  const existing = idempotencyKey
    ? await readSignalRecipeByIdempotencyKey(env, userId, idempotencyKey)
    : null;
  if (existing) return existing;
  const input = validateSignalRecipeInput(rawInput);
  const id = `recipe_${crypto.randomUUID()}`;
  const preview = await buildSignalRecipePreview(env, input);
  assertActivationHasPreview(input.active === true, preview);
  try {
    await insertSignalRecipe(env, userId, id, id, 1, input, preview, idempotencyKey);
  } catch (error) {
    const raced = idempotencyKey
      ? await readSignalRecipeByIdempotencyKey(env, userId, idempotencyKey)
      : null;
    if (raced) return raced;
    throw error;
  }
  return (await readSignalRecipe(env, userId, id))!;
}

export async function createSignalRecipeVersion(
  env: Env,
  userId: string,
  id: string,
  rawInput: SignalRecipeInput,
  idempotencyKey: string | null = null
): Promise<SignalRecipe | null> {
  const existing = idempotencyKey
    ? await readSignalRecipeByIdempotencyKey(env, userId, idempotencyKey)
    : null;
  if (existing) return existing;
  const input = validateSignalRecipeInput(rawInput);
  const current = await readLatestSignalRecipe(env, userId, id);
  if (!current) return null;
  const versionId = `recipe_${crypto.randomUUID()}`;
  const preview = await buildSignalRecipePreview(env, input);
  assertActivationHasPreview(input.active === true, preview);
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE signal_recipes SET active = 0 WHERE user_id = ? AND root_id = ?`).bind(
        userId,
        current.rootId
      ),
      signalRecipeInsertStatement(
        env,
        userId,
        versionId,
        current.rootId,
        current.version + 1,
        input,
        preview,
        idempotencyKey
      ),
    ]);
  } catch (error) {
    const raced = idempotencyKey
      ? await readSignalRecipeByIdempotencyKey(env, userId, idempotencyKey)
      : null;
    if (raced) return raced;
    throw error;
  }
  return (await readSignalRecipe(env, userId, versionId))!;
}

export async function updateSignalRecipe(
  env: Env,
  userId: string,
  id: string,
  update: SignalRecipeUpdate
): Promise<SignalRecipe | null> {
  const current = await readLatestSignalRecipe(env, userId, id);
  if (!current) return null;
  const active = update.active ?? current.active;
  if (active && current.preview.status === 'unavailable') {
    throw new Error('activation requires an available historical preview');
  }
  const channelIds =
    update.deliveryChannelIds === undefined
      ? current.deliveryChannelIds
      : sanitizeIds(update.deliveryChannelIds, 20);
  const cooldown =
    update.cooldownSeconds === undefined
      ? current.cooldownSeconds
      : Math.round(boundedNumber(update.cooldownSeconds, 60, 7 * 24 * 3600, 'cooldownSeconds'));
  await env.DB.prepare(
    `UPDATE signal_recipes
     SET active = ?, delivery_channel_ids_json = ?, cooldown_seconds = ?, updated_at = unixepoch()
     WHERE id = ? AND user_id = ?`
  )
    .bind(active ? 1 : 0, JSON.stringify(channelIds), cooldown, current.id, userId)
    .run();
  return readSignalRecipe(env, userId, current.id);
}

export async function deleteSignalRecipe(
  env: Env,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const current = await readLatestSignalRecipe(env, userId, id);
  if (!current) return { deleted: false };
  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM signal_recipe_matches WHERE user_id = ? AND recipe_root_id = ?`
    ).bind(userId, current.rootId),
    env.DB.prepare(`DELETE FROM signal_recipes WHERE user_id = ? AND root_id = ?`).bind(
      userId,
      current.rootId
    ),
  ]);
  return { deleted: (results[1]?.meta.changes ?? 0) > 0 };
}

export async function evaluateActiveSignalRecipes(
  env: Env,
  opportunities: Opportunity[]
): Promise<{ evaluated: number; matched: number }> {
  if (opportunities.length === 0) return { evaluated: 0, matched: 0 };
  const { results } = await env.DB.prepare(
    `SELECT * FROM signal_recipes WHERE active = 1 ORDER BY updated_at ASC LIMIT 1000`
  ).all<SignalRecipeRow>();
  let evaluated = 0;
  let matched = 0;
  for (const row of results) {
    const recipe = mapSignalRecipe(row);
    for (const opportunity of opportunities) {
      evaluated += 1;
      const match = matchesSignalRecipe(recipe, opportunity);
      if (!match.matched) continue;
      try {
        if (await persistRecipeMatch(env, recipe, opportunity, match.passed)) matched += 1;
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            module: 'signal-recipes',
            msg: 'recipe match dispatch failed',
            recipeId: recipe.id,
            opportunityId: opportunity.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }
  }
  return { evaluated, matched };
}

export function matchesSignalRecipe(
  recipe: Pick<SignalRecipe, 'active' | 'horizon' | 'minScore' | 'universe' | 'conditions'>,
  opportunity: Opportunity
): { matched: boolean; passed: OpportunityEvidence[] } {
  if (
    !recipe.active ||
    opportunity.horizon !== recipe.horizon ||
    opportunity.score < recipe.minScore
  ) {
    return { matched: false, passed: [] };
  }
  if (
    recipe.universe.marketType !== 'both' &&
    recipe.universe.marketType !== opportunity.marketType
  ) {
    return { matched: false, passed: [] };
  }
  if (recipe.universe.exchange !== 'all' && recipe.universe.exchange !== opportunity.exchange) {
    return { matched: false, passed: [] };
  }
  if (
    recipe.universe.symbols.length > 0 &&
    !recipe.universe.symbols.some((symbol) => sameSymbol(symbol, opportunity.symbol))
  ) {
    return { matched: false, passed: [] };
  }
  if (recipe.universe.kind === 'top-liquid') {
    const liquidity = opportunity.evidence.find((item) => item.metric === 'volume_percentile');
    if ((liquidity?.normalizedValue ?? -1) < 80) return { matched: false, passed: [] };
  }
  const passed: OpportunityEvidence[] = [];
  for (const condition of recipe.conditions) {
    const evidence = opportunity.evidence.find((item) => item.metric === condition.metric);
    if (!evidence || evidence.freshness === 'missing' || !compare(evidence.value, condition)) {
      return { matched: false, passed: [] };
    }
    passed.push(evidence);
  }
  return { matched: true, passed };
}

async function buildSignalRecipePreview(
  env: Env,
  input: SignalRecipeInput
): Promise<SignalRecipePreview> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT events.opportunity_json, outcomes.net_return_percent,
              outcomes.max_adverse_excursion_percent, outcomes.won,
              outcomes.coverage_state, outcomes.created_at
       FROM opportunity_outcomes outcomes
       INNER JOIN opportunity_events events ON events.id = outcomes.opportunity_id
       WHERE outcomes.horizon = ?
       ORDER BY outcomes.created_at DESC
       LIMIT 1000`
    )
      .bind(input.horizon)
      .all<PreviewOutcomeRow>();
    const previewRecipe: Pick<
      SignalRecipe,
      'active' | 'horizon' | 'minScore' | 'universe' | 'conditions'
    > = {
      universe: input.universe,
      horizon: input.horizon,
      conditions: input.conditions,
      minScore: input.minScore ?? 60,
      active: true,
    };
    const matched = results.filter((row) => {
      try {
        return matchesSignalRecipe(previewRecipe, JSON.parse(row.opportunity_json) as Opportunity)
          .matched;
      } catch {
        return false;
      }
    });
    const complete = matched.filter(
      (row) => row.coverage_state === 'complete' && row.net_return_percent !== null
    );
    const returns = complete
      .map((row) => row.net_return_percent)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const adverse = complete
      .map((row) => row.max_adverse_excursion_percent)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const sampleSize = returns.length;
    const calibrated = sampleSize >= 100;
    const hitRate = calibrated ? complete.filter((row) => row.won === 1).length / sampleSize : null;
    const calibration: SignalCalibration = {
      status: calibrated ? 'calibrated' : 'experimental',
      sampleSize,
      coveragePercent: matched.length > 0 ? (complete.length / matched.length) * 100 : 0,
      probability: hitRate,
      hitRate,
      medianReturnPercent: calibrated ? quantile(returns, 0.5) : null,
      lowerReturnPercent: calibrated ? quantile(returns, 0.1) : null,
      upperReturnPercent: calibrated ? quantile(returns, 0.9) : null,
      medianAdverseExcursionPercent: calibrated ? quantile(adverse, 0.5) : null,
      regime: 'all-regimes',
      methodology: calibrated
        ? 'Walk-forward opportunity outcomes net of recorded fees, funding, and slippage.'
        : 'Probability hidden until 100 comparable out-of-sample outcomes exist.',
    };
    const costs = matched
      .map((row) => {
        try {
          return (JSON.parse(row.opportunity_json) as Opportunity).estimatedCosts.totalBps;
        } catch {
          return null;
        }
      })
      .filter((value): value is number => value !== null && Number.isFinite(value))
      .sort((left, right) => left - right);
    const first = matched.at(-1)?.created_at ?? null;
    const last = matched[0]?.created_at ?? null;
    const weeks = first && last && last > first ? Math.max(1, (last - first) / (7 * 86400)) : null;
    const exposedCalibration = calibrationForExposure(env, calibration);
    return {
      status: calibrated ? 'ready' : 'insufficient-data',
      sampleSize,
      coveragePercent: matched.length > 0 ? (complete.length / matched.length) * 100 : 0,
      estimatedMatchesPerWeek: weeks ? matched.length / weeks : null,
      estimatedCostBps: quantile(costs, 0.5),
      calibration: exposedCalibration,
      warnings: calibrated
        ? exposedCalibration.status === 'calibrated'
          ? []
          : ['Probability remains hidden while the Conviction Engine runs in shadow mode.']
        : ['The recipe can monitor experimental setups, but no probability will be shown yet.'],
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'signal-recipes',
        msg: 'historical recipe preview unavailable',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return {
      status: 'unavailable',
      sampleSize: 0,
      coveragePercent: 0,
      estimatedMatchesPerWeek: null,
      estimatedCostBps: null,
      calibration: unavailableCalibration(),
      warnings: [
        'Historical preview is temporarily unavailable. Keep the recipe inactive and retry.',
      ],
    };
  }
}

async function persistRecipeMatch(
  env: Env,
  recipe: SignalRecipe,
  opportunity: Opportunity,
  passed: OpportunityEvidence[]
): Promise<boolean> {
  const matchToken = stableToken(`${recipe.id}:${opportunity.id}`);
  const matchId = `recipe_match_${matchToken}`;
  const eventId = `recipe_alert_${matchToken}`;
  const alertId = stableInteger(`${recipe.id}:${opportunity.id}`);
  const staleEvidence = opportunity.evidence
    .filter((item) => item.freshness === 'stale')
    .map((item) => item.label);
  const payload = {
    eventId,
    kind: 'signal-recipe-match',
    recipe: { id: recipe.id, rootId: recipe.rootId, name: recipe.name, version: recipe.version },
    opportunity,
    passedConditions: passed.map((item) => ({
      metric: item.metric,
      value: item.value,
      freshness: item.freshness,
      summary: item.summary,
    })),
    staleEvidence,
    invalidation: opportunity.invalidation,
    matchedAt: Date.now(),
  };
  const topic = `recipes:user:${recipe.userId}`;
  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO signal_recipe_matches
      (id, recipe_id, recipe_root_id, user_id, opportunity_id, alert_event_id,
       matched_conditions_json, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, unixepoch()
     WHERE NOT EXISTS (
       SELECT 1 FROM signal_recipe_matches
       WHERE recipe_root_id = ? AND created_at > unixepoch() - ?
     )`
  )
    .bind(
      matchId,
      recipe.id,
      recipe.rootId,
      recipe.userId,
      opportunity.id,
      eventId,
      JSON.stringify(payload.passedConditions),
      recipe.rootId,
      recipe.cooldownSeconds
    )
    .run();
  if ((insert.meta.changes ?? 0) !== 1) return false;
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO alert_events
        (id, alert_id, user_id, symbol, exchange, trigger_price, target_price, condition,
         status, topic, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, unixepoch())`
    )
      .bind(
        eventId,
        alertId,
        recipe.userId,
        opportunity.symbol,
        opportunity.exchange,
        opportunity.trigger.price ?? 0,
        opportunity.invalidation.price ?? opportunity.trigger.price ?? 0,
        opportunity.direction === 'short' ? 'below' : 'above',
        topic,
        JSON.stringify(payload)
      )
      .run();
  } catch (error) {
    await deleteFailedRecipeMatch(env, matchId, eventId);
    throw error;
  }
  const [publishResult, queueResult] = await Promise.allSettled([
    publishRealtime(env, topic, payload, eventId),
    enqueueAlertDeliveries(env, eventId, recipe.userId, recipe.deliveryChannelIds),
  ]);
  const published = publishResult.status === 'fulfilled' && publishResult.value;
  const queued = queueResult.status === 'fulfilled' ? queueResult.value : 0;
  const durableAttempts =
    queueResult.status === 'rejected'
      ? ((
          await env.DB.prepare(
            `SELECT COUNT(*) AS count
             FROM notification_delivery_attempts WHERE alert_event_id = ?`
          )
            .bind(eventId)
            .first<{ count: number }>()
        )?.count ?? 0)
      : 0;
  const delivered = published || queued > 0 || durableAttempts > 0;
  await env.DB.prepare(`UPDATE alert_events SET status = ? WHERE id = ?`)
    .bind(delivered ? 'published' : 'failed', eventId)
    .run();
  if (!delivered) {
    await deleteFailedRecipeMatch(env, matchId, eventId);
    const reasons = [publishResult, queueResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      );
    throw new Error(
      reasons.length > 0
        ? `Signal recipe dispatch failed: ${reasons.join('; ')}`
        : 'Signal recipe has no available delivery path'
    );
  }
  return true;
}

async function deleteFailedRecipeMatch(env: Env, matchId: string, eventId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM signal_recipe_matches WHERE id = ?`).bind(matchId),
    env.DB.prepare(
      `DELETE FROM alert_events
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM notification_delivery_attempts WHERE alert_event_id = ?
       )`
    ).bind(eventId, eventId),
  ]);
}

async function publishRealtime(
  env: Env,
  topic: string,
  payload: object,
  batchId: string
): Promise<boolean> {
  if (!env.REALTIME_HUB || !env.ADMIN_API_KEY) return false;
  const id = env.REALTIME_HUB.idFromName(topic);
  const url = new URL('https://realtime/publish-batch');
  url.searchParams.set('topic', topic);
  const response = await env.REALTIME_HUB.get(id).fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-API-Key': env.ADMIN_API_KEY },
    body: JSON.stringify({ batchId, events: [payload] }),
  });
  return response.ok;
}

async function insertSignalRecipe(
  env: Env,
  userId: string,
  id: string,
  rootId: string,
  version: number,
  input: SignalRecipeInput,
  preview: SignalRecipePreview,
  idempotencyKey: string | null
): Promise<void> {
  await signalRecipeInsertStatement(
    env,
    userId,
    id,
    rootId,
    version,
    input,
    preview,
    idempotencyKey
  ).run();
}

function signalRecipeInsertStatement(
  env: Env,
  userId: string,
  id: string,
  rootId: string,
  version: number,
  input: SignalRecipeInput,
  preview: SignalRecipePreview,
  idempotencyKey: string | null
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO signal_recipes
      (id, root_id, user_id, name, version, universe_json, horizon, conditions_json,
       min_score, cooldown_seconds, delivery_channel_ids_json, active, preview_json, idempotency_key,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
  ).bind(
    id,
    rootId,
    userId,
    input.name,
    version,
    JSON.stringify(input.universe),
    input.horizon,
    JSON.stringify(input.conditions),
    input.minScore ?? 60,
    input.cooldownSeconds ?? 3600,
    JSON.stringify(input.deliveryChannelIds ?? []),
    input.active ? 1 : 0,
    JSON.stringify(preview),
    idempotencyKey
  );
}

async function readSignalRecipe(
  env: Env,
  userId: string,
  id: string
): Promise<SignalRecipe | null> {
  const row = await env.DB.prepare(`SELECT * FROM signal_recipes WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<SignalRecipeRow>();
  return row ? mapSignalRecipe(row) : null;
}

async function readSignalRecipeByIdempotencyKey(
  env: Env,
  userId: string,
  idempotencyKey: string
): Promise<SignalRecipe | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM signal_recipes WHERE user_id = ? AND idempotency_key = ? LIMIT 1`
  )
    .bind(userId, idempotencyKey)
    .first<SignalRecipeRow>();
  return row ? mapSignalRecipe(row) : null;
}

async function readLatestSignalRecipe(
  env: Env,
  userId: string,
  id: string
): Promise<SignalRecipe | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM signal_recipes
     WHERE user_id = ? AND root_id = (
       SELECT root_id FROM signal_recipes WHERE user_id = ? AND (id = ? OR root_id = ?) LIMIT 1
     )
     ORDER BY version DESC LIMIT 1`
  )
    .bind(userId, userId, id, id)
    .first<SignalRecipeRow>();
  return row ? mapSignalRecipe(row) : null;
}

function mapSignalRecipe(row: SignalRecipeRow): SignalRecipe {
  return {
    id: row.id,
    rootId: row.root_id,
    userId: row.user_id,
    name: row.name,
    version: row.version,
    universe: JSON.parse(row.universe_json) as SignalRecipeUniverse,
    horizon: row.horizon,
    conditions: JSON.parse(row.conditions_json) as SignalRecipeCondition[],
    minScore: row.min_score,
    cooldownSeconds: row.cooldown_seconds,
    deliveryChannelIds: JSON.parse(row.delivery_channel_ids_json) as string[],
    active: row.active === 1,
    preview: JSON.parse(row.preview_json) as SignalRecipePreview,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function compare(value: OpportunityEvidence['value'], condition: SignalRecipeCondition): boolean {
  if (typeof condition.value === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (condition.operator === 'gt') return value > condition.value;
    if (condition.operator === 'gte') return value >= condition.value;
    if (condition.operator === 'lt') return value < condition.value;
    if (condition.operator === 'lte') return value <= condition.value;
    return Math.abs(value - condition.value) <= Number.EPSILON * Math.max(1, Math.abs(value));
  }
  if (condition.operator !== 'eq') return false;
  return String(value).toLowerCase() === condition.value.toLowerCase();
}

function sameSymbol(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/P$/, '');
  return normalize(left) === normalize(right);
}

function sanitizeIds(values: string[], limit: number): string[] {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => /^[a-zA-Z0-9_-]{1,120}$/.test(value))
    )
  ).slice(0, limit);
}

function boundedNumber(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function quantile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const index = (values.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = values[lower] ?? values[0]!;
  const upperValue = values[upper] ?? values.at(-1)!;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function stableInteger(value: string): number {
  let primary = 2166136261;
  let secondary = 5381;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619);
    secondary = Math.imul(secondary, 33) ^ code;
  }
  return (primary >>> 0) * 1_000_000 + ((secondary >>> 0) % 1_000_000);
}

function stableToken(value: string): string {
  let primary = 2166136261;
  let secondary = 5381;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619);
    secondary = Math.imul(secondary, 33) ^ code;
  }
  return `${(primary >>> 0).toString(36)}${(secondary >>> 0).toString(36)}`;
}

function assertActivationHasPreview(active: boolean, preview: SignalRecipePreview): void {
  if (active && preview.status === 'unavailable') {
    throw new Error('activation requires an available historical preview');
  }
}

function unavailableCalibration(): SignalCalibration {
  return {
    status: 'insufficient-data',
    sampleSize: 0,
    probability: null,
    hitRate: null,
    medianReturnPercent: null,
    lowerReturnPercent: null,
    upperReturnPercent: null,
    medianAdverseExcursionPercent: null,
    regime: 'unavailable',
    methodology: 'Historical outcome storage is unavailable.',
  };
}
