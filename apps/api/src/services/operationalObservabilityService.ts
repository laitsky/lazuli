import type { Env } from '../types';
import { sendAlertEmail } from './emailDeliveryService';
import {
  getReleaseControl,
  listReleaseControlAudit,
  listReleaseControls,
} from './releaseControlService';

const BUCKET_SECONDS = 300;
const SAMPLE_RETENTION_SECONDS = 7 * 86_400;
const RUNBOOK_ROOT = 'https://github.com/laitsky/lazuli/blob/main/docs/runbooks';

type Comparison = 'max' | 'min';

interface SloPolicy {
  id: string;
  sli: string;
  comparison: Comparison;
  threshold: number;
  severity: 'page' | 'ticket';
  runbook: string;
  summary: string;
}

const SLO_POLICIES: SloPolicy[] = [
  {
    id: 'api-availability',
    sli: 'api_availability',
    comparison: 'min',
    threshold: 0.999,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/production-rollback.md`,
    summary: 'Public API availability is below 99.9%',
  },
  {
    id: 'ws-availability',
    sli: 'ws_availability',
    comparison: 'min',
    threshold: 0.999,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/realtime-provider-failure.md`,
    summary: 'Public WebSocket availability is below 99.9%',
  },
  {
    id: 'liquidation-latency',
    sli: 'liquidation_latency_p95_ms',
    comparison: 'max',
    threshold: 800,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/realtime-provider-failure.md`,
    summary: 'Primary liquidation latency exceeds 800 ms',
  },
  {
    id: 'provider-health',
    sli: 'provider_health_availability',
    comparison: 'min',
    threshold: 1,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/realtime-provider-failure.md`,
    summary: 'One or more configured provider shards are unavailable',
  },
  {
    id: 'provider-freshness',
    sli: 'provider_freshness_ms',
    comparison: 'max',
    threshold: 120_000,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/realtime-provider-failure.md`,
    summary: 'A provider shard has not received a message for two minutes',
  },
  {
    id: 'realtime-drops',
    sli: 'realtime_event_drops',
    comparison: 'max',
    threshold: 0,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/realtime-provider-failure.md`,
    summary: 'Realtime ingestion dropped an event',
  },
  {
    id: 'realtime-unresolved-gaps',
    sli: 'realtime_unresolved_gaps',
    comparison: 'max',
    threshold: 0,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/realtime-provider-failure.md`,
    summary: 'A realtime sequence gap remains unresolved',
  },
  {
    id: 'alert-evaluation-latency',
    sli: 'alert_evaluation_latency_p95_ms',
    comparison: 'max',
    threshold: 2_000,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/alert-delivery.md`,
    summary: 'Alert evaluation latency exceeds two seconds',
  },
  {
    id: 'alert-dispatch-latency',
    sli: 'alert_dispatch_latency_p95_ms',
    comparison: 'max',
    threshold: 10_000,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/alert-delivery.md`,
    summary: 'Alert dispatch latency exceeds ten seconds',
  },
  {
    id: 'duplicate-alerts',
    sli: 'duplicate_alert_deliveries',
    comparison: 'max',
    threshold: 0,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/alert-delivery-dlq.md`,
    summary: 'A duplicate alert delivery was detected',
  },
  {
    id: 'delivery-dlq-age',
    sli: 'delivery_dlq_age_seconds',
    comparison: 'max',
    threshold: 900,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/alert-delivery-dlq.md`,
    summary: 'An untriaged delivery DLQ item is older than 15 minutes',
  },
  {
    id: 'delivery-queue-lag',
    sli: 'delivery_queue_age_seconds',
    comparison: 'max',
    threshold: 10,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/alert-delivery-dlq.md`,
    summary: 'The oldest queued delivery exceeds the dispatch SLO',
  },
  {
    id: 'd1-availability',
    sli: 'd1_availability',
    comparison: 'min',
    threshold: 1,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/d1-r2-outage.md`,
    summary: 'D1 control-plane telemetry is unavailable',
  },
  {
    id: 'r2-availability',
    sli: 'r2_availability',
    comparison: 'min',
    threshold: 1,
    severity: 'page',
    runbook: `${RUNBOOK_ROOT}/d1-r2-outage.md`,
    summary: 'R2 archive telemetry is unavailable',
  },
  {
    id: 'archive-gaps',
    sli: 'archive_gap_count',
    comparison: 'max',
    threshold: 0,
    severity: 'ticket',
    runbook: `${RUNBOOK_ROOT}/backfill-dlq-recovery.md`,
    summary: 'Archive manifests or backfill tasks report unresolved gaps',
  },
  {
    id: 'telemetry-completeness',
    sli: 'telemetry_completeness',
    comparison: 'min',
    threshold: 0.98,
    severity: 'ticket',
    runbook: `${RUNBOOK_ROOT}/production-rollback.md`,
    summary: 'Operational telemetry completeness is below 98%',
  },
];

interface SliRow {
  bucket_start: number;
  sli: string;
  dimension_key: string;
  value: number | null;
  good_count: number;
  total_count: number;
  completeness: number;
  source: string;
  details_json: string;
}

interface IncidentRow {
  id: string;
  policy_id: string;
  dedupe_key: string;
  state: 'open' | 'acknowledged' | 'resolved';
  severity: 'page' | 'ticket';
  owner: string;
  runbook_url: string;
  summary: string;
  observed_value: number | null;
  threshold_value: number | null;
  details_json: string;
  opened_at: number;
  last_observed_at: number;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  resolved_at: number | null;
  resolution: string | null;
}

export function sloBreached(value: number, comparison: Comparison, threshold: number): boolean {
  return comparison === 'max' ? value > threshold : value < threshold;
}

export function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

export async function recordOperationalSli(
  env: Pick<Env, 'DB'>,
  input: {
    sli: string;
    value: number;
    success?: boolean;
    dimensionKey?: string;
    source: string;
    observedAt?: number;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  if (!Number.isFinite(input.value)) return;
  const observedAt = input.observedAt ?? Date.now();
  const observedSeconds = Math.floor(observedAt / 1_000);
  const bucketStart = Math.floor(observedSeconds / BUCKET_SECONDS) * BUCKET_SECONDS;
  const success = input.success === undefined ? null : input.success ? 1 : 0;
  const dimensionKey = input.dimensionKey ?? '';
  const details = JSON.stringify(input.details ?? {});
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO operational_sli_samples
        (id, sli, dimension_key, value, success, source, observed_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      input.sli,
      dimensionKey,
      input.value,
      success,
      input.source,
      observedSeconds,
      details
    ),
    env.DB.prepare(
      `INSERT INTO operational_sli_rollups
        (bucket_start, bucket_seconds, sli, dimension_key, value, good_count, total_count,
         completeness, source, details_json)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT(bucket_start, bucket_seconds, sli, dimension_key) DO UPDATE SET
         value = excluded.value,
         good_count = operational_sli_rollups.good_count + excluded.good_count,
         total_count = operational_sli_rollups.total_count + 1,
         source = excluded.source,
         details_json = excluded.details_json`
    ).bind(
      bucketStart,
      BUCKET_SECONDS,
      input.sli,
      dimensionKey,
      input.value,
      success ?? 0,
      input.source,
      details
    ),
  ]);
}

export async function runOperationalMonitoring(env: Env): Promise<void> {
  await runSyntheticProbes(env);
  await recordDatabaseSlis(env);
  await recordInfrastructureSlis(env);
  await recordTelemetryCompleteness(env);
  await refreshPercentileRollups(env);
  await evaluateSloPolicies(env);
  await env.DB.prepare(`DELETE FROM operational_sli_samples WHERE observed_at < unixepoch() - ?`)
    .bind(SAMPLE_RETENTION_SECONDS)
    .run();
}

export async function getOperationalDashboard(env: Env, minutes = 90): Promise<unknown> {
  const since = Math.floor(Date.now() / 1_000) - Math.max(5, Math.min(10_080, minutes)) * 60;
  const [slis, incidents, checkpoints, deliveries, jobs, product, probes, controls, audit] =
    await Promise.all([
      env.DB.prepare(
        `SELECT * FROM operational_sli_rollups WHERE bucket_start >= ?
         ORDER BY bucket_start ASC, sli ASC, dimension_key ASC`
      )
        .bind(since)
        .all<SliRow>(),
      env.DB.prepare(
        `SELECT * FROM operational_incidents ORDER BY last_observed_at DESC LIMIT 200`
      ).all<IncidentRow>(),
      env.DB.prepare(
        `SELECT provider, exchange, stream, symbol, status, last_error,
                last_exchange_timestamp, updated_at
         FROM ingestion_checkpoints ORDER BY updated_at DESC LIMIT 250`
      ).all(),
      env.DB.prepare(
        `SELECT status, provider, COUNT(*) AS count, MIN(queued_at) AS oldest
         FROM notification_delivery_attempts GROUP BY status, provider`
      ).all(),
      env.DB.prepare(
        `SELECT 'backfill' AS kind, status, COUNT(*) AS count FROM backfill_jobs GROUP BY status
         UNION ALL
         SELECT 'async_backtest' AS kind, status, COUNT(*) AS count
         FROM async_backtest_jobs GROUP BY status`
      ).all(),
      env.DB.prepare(
        `SELECT metric_date, metric, SUM(value) AS value, MIN(completeness) AS completeness
         FROM daily_product_metrics WHERE metric_date >= date('now', '-30 day')
         GROUP BY metric_date, metric ORDER BY metric_date ASC, metric ASC`
      ).all(),
      env.DB.prepare(
        `SELECT probe, target, success, status_code, latency_ms, error_code, observed_at
         FROM synthetic_probe_results WHERE observed_at >= ? ORDER BY observed_at DESC LIMIT 500`
      )
        .bind(since)
        .all(),
      listReleaseControls(env),
      listReleaseControlAudit(env, { limit: 100 }),
    ]);
  return {
    generatedAt: Date.now(),
    window: { minutes, since },
    dashboards: {
      realtime: {
        slis: slis.results.filter(
          (row) =>
            row.sli.includes('ws') ||
            row.sli.includes('liquidation') ||
            row.sli.includes('provider') ||
            row.sli.includes('realtime')
        ),
        checkpoints: checkpoints.results,
      },
      alerts: {
        slis: slis.results.filter(
          (row) => row.sli.includes('alert') || row.sli.includes('delivery')
        ),
        attempts: deliveries.results,
        incidents: incidents.results,
      },
      storageJobs: {
        slis: slis.results.filter(
          (row) =>
            row.sli.includes('storage') ||
            row.sli.includes('queue') ||
            row.sli.includes('d1') ||
            row.sli.includes('r2') ||
            row.sli.includes('archive')
        ),
        jobs: jobs.results,
      },
      product: {
        metrics: product.results,
        slis: slis.results.filter((row) => row.sli.includes('telemetry')),
      },
      release: { controls, audit, probes: probes.results, incidents: incidents.results },
    },
  };
}

export async function listOperationalIncidents(
  env: Pick<Env, 'DB'>,
  state?: 'open' | 'acknowledged' | 'resolved'
): Promise<unknown[]> {
  const result = state
    ? await env.DB.prepare(
        `SELECT * FROM operational_incidents WHERE state = ? ORDER BY last_observed_at DESC LIMIT 250`
      )
        .bind(state)
        .all<IncidentRow>()
    : await env.DB.prepare(
        `SELECT * FROM operational_incidents ORDER BY last_observed_at DESC LIMIT 250`
      ).all<IncidentRow>();
  return result.results.map(mapIncident);
}

export async function transitionOperationalIncident(
  env: Env,
  id: string,
  transition: 'acknowledged' | 'resolved',
  actor: string,
  resolution?: string
): Promise<unknown> {
  const result = await env.DB.prepare(
    transition === 'acknowledged'
      ? `UPDATE operational_incidents SET state = 'acknowledged', acknowledged_at = unixepoch(),
           acknowledged_by = ? WHERE id = ? AND state = 'open'`
      : `UPDATE operational_incidents SET state = 'resolved', resolved_at = unixepoch(),
           resolution = ? WHERE id = ? AND state IN ('open', 'acknowledged')`
  )
    .bind(transition === 'acknowledged' ? actor : (resolution ?? 'operator resolved'), id)
    .run();
  if ((result.meta.changes ?? 0) !== 1)
    throw new Error('Incident is missing or already transitioned');
  const incident = await env.DB.prepare(`SELECT * FROM operational_incidents WHERE id = ?`)
    .bind(id)
    .first<IncidentRow>();
  if (transition === 'resolved' && incident) {
    const policy = SLO_POLICIES.find((candidate) => candidate.id === incident.policy_id);
    if (policy) {
      await deliverIncidentEmail(
        env,
        incident.id,
        policy,
        incident.observed_value ?? 0,
        'resolved'
      );
    }
  }
  return incident ? mapIncident(incident) : null;
}

async function runSyntheticProbes(env: Env): Promise<void> {
  if (!env.PUBLIC_API_BASE_URL) return;
  await probe(env, 'api', new URL('/health', env.PUBLIC_API_BASE_URL));
  const realtime = await getReleaseControl(env, 'realtime');
  if (realtime && realtime.state !== 'off') {
    const topic = realtime.topicAllowlist[0] ?? 'ticker:bybit:btcusdt.p';
    await probe(
      env,
      'ws',
      new URL(`/api/v1/ws?topic=${encodeURIComponent(topic)}`, env.PUBLIC_API_BASE_URL),
      true
    );
  }
}

async function probe(env: Env, name: 'api' | 'ws', target: URL, websocket = false): Promise<void> {
  const startedAt = Date.now();
  let success = false;
  let statusCode: number | null = null;
  let errorCode: string | null = null;
  try {
    const response = await fetch(target, {
      headers: websocket ? { Upgrade: 'websocket' } : undefined,
      signal: AbortSignal.timeout(8_000),
    });
    statusCode = response.status;
    success = websocket ? response.status === 101 && Boolean(response.webSocket) : response.ok;
    if (response.webSocket) {
      response.webSocket.accept();
      response.webSocket.close(1000, 'synthetic probe');
    }
  } catch (error) {
    errorCode = (error instanceof Error ? error.name : 'probe_error').slice(0, 80);
  }
  const latency = Date.now() - startedAt;
  await env.DB.prepare(
    `INSERT INTO synthetic_probe_results
      (id, probe, target, success, status_code, latency_ms, error_code, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`
  )
    .bind(
      crypto.randomUUID(),
      name,
      `${target.origin}${target.pathname}`,
      success ? 1 : 0,
      statusCode,
      latency,
      errorCode
    )
    .run();
  await recordOperationalSli(env, {
    sli: `${name}_availability`,
    value: success ? 1 : 0,
    success,
    source: 'synthetic-probe',
    details: { statusCode, errorCode, latency },
  });
}

async function recordDatabaseSlis(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1_000);
  const delivery = await env.DB.prepare(
    `SELECT
       COALESCE(MAX(CASE WHEN status = 'dead_letter' THEN ? - queued_at END), 0) AS dlq_age,
       COALESCE(MAX(CASE WHEN status IN ('queued', 'retry') THEN ? - queued_at END), 0) AS queue_age,
       COUNT(DISTINCT CASE WHEN status = 'delivered' THEN idempotency_key END) AS delivered_keys,
       COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered_rows
     FROM notification_delivery_attempts`
  )
    .bind(now, now)
    .first<{
      dlq_age: number;
      queue_age: number;
      delivered_keys: number;
      delivered_rows: number;
    }>();
  const duplicateDeliveries = Math.max(
    0,
    Number(delivery?.delivered_rows ?? 0) - Number(delivery?.delivered_keys ?? 0)
  );
  await Promise.all([
    recordOperationalSli(env, {
      sli: 'delivery_dlq_age_seconds',
      value: Number(delivery?.dlq_age ?? 0),
      source: 'd1-control-plane',
    }),
    recordOperationalSli(env, {
      sli: 'delivery_queue_age_seconds',
      value: Number(delivery?.queue_age ?? 0),
      source: 'd1-control-plane',
    }),
    recordOperationalSli(env, {
      sli: 'duplicate_alert_deliveries',
      value: duplicateDeliveries,
      success: duplicateDeliveries === 0,
      source: 'd1-control-plane',
    }),
  ]);
  await recordOperationalSli(env, {
    sli: 'd1_availability',
    value: 1,
    success: true,
    source: 'd1-control-plane',
  });
}

async function recordInfrastructureSlis(env: Env): Promise<void> {
  let r2Available = false;
  try {
    await env.OHLCV_ARCHIVE.list({ limit: 1 });
    r2Available = true;
  } catch (error) {
    console.error('R2 operational probe failed', error);
  }
  await recordOperationalSli(env, {
    sli: 'r2_availability',
    value: r2Available ? 1 : 0,
    success: r2Available,
    source: 'r2-list-probe',
  });

  const gaps = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) +
       COALESCE(SUM(CASE WHEN status = 'complete'
         THEN CAST(COALESCE(json_extract(gap_summary_json, '$.gaps'), 0) AS INTEGER)
         ELSE 0 END), 0) AS count
     FROM r2_ohlcv_manifests`
  ).first<{ count: number }>();
  await recordOperationalSli(env, {
    sli: 'archive_gap_count',
    value: Number(gaps?.count ?? 0),
    source: 'd1-archive-manifests',
  });

  if (!env.INGEST_HEALTH_URL || !env.OPS_READ_SECRET) return;
  let payload: Record<string, unknown> | null = null;
  try {
    const response = await fetch(env.INGEST_HEALTH_URL, {
      headers: { Authorization: `Bearer ${env.OPS_READ_SECRET}` },
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) throw new Error(`ingest health returned ${response.status}`);
    const body = await response.json();
    if (isRecord(body)) payload = body;
  } catch (error) {
    console.error('Ingest operational probe failed', error);
  }
  const providers = Array.isArray(payload?.providers) ? payload.providers.filter(isRecord) : [];
  const ready = payload?.status === 'ready' && providers.length > 0;
  const batching = isRecord(payload?.batching) ? payload.batching : {};
  await Promise.all([
    recordOperationalSli(env, {
      sli: 'provider_health_availability',
      value: ready ? 1 : 0,
      success: ready,
      source: 'ingest-active-health',
      details: { failures: payload?.failures ?? [] },
    }),
    recordOperationalSli(env, {
      sli: 'realtime_event_drops',
      value: finiteNumber(batching.dropped),
      success: finiteNumber(batching.dropped) === 0,
      source: 'ingest-active-health',
    }),
    ...providers.flatMap((provider) => {
      const name = typeof provider.provider === 'string' ? provider.provider : 'unknown';
      return [
        recordOperationalSli(env, {
          sli: 'provider_freshness_ms',
          value: finiteNumber(provider.freshnessMs, 300_000),
          source: 'ingest-active-health',
          dimensionKey: name,
        }),
        recordOperationalSli(env, {
          sli: 'realtime_unresolved_gaps',
          value: finiteNumber(provider.unresolvedGaps),
          success: finiteNumber(provider.unresolvedGaps) === 0,
          source: 'ingest-active-health',
          dimensionKey: name,
        }),
      ];
    }),
  ]);
}

async function recordTelemetryCompleteness(env: Env): Promise<void> {
  const required = ['api_availability', 'd1_availability', 'r2_availability'];
  if (env.INGEST_HEALTH_URL && env.OPS_READ_SECRET) {
    required.push(
      'provider_health_availability',
      'provider_freshness_ms',
      'realtime_event_drops',
      'realtime_unresolved_gaps'
    );
  }
  const placeholders = required.map(() => '?').join(',');
  const observed = await env.DB.prepare(
    `SELECT COUNT(DISTINCT sli) AS count FROM operational_sli_samples
     WHERE observed_at >= unixepoch() - 600 AND sli IN (${placeholders})`
  )
    .bind(...required)
    .first<{ count: number }>();
  const completeness = required.length === 0 ? 1 : Number(observed?.count ?? 0) / required.length;
  await recordOperationalSli(env, {
    sli: 'telemetry_completeness',
    value: completeness,
    success: completeness >= 0.98,
    source: 'operational-sli-inventory',
    details: { required },
  });
}

async function refreshPercentileRollups(env: Pick<Env, 'DB'>): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT sli, dimension_key, value FROM operational_sli_samples
     WHERE observed_at >= unixepoch() - ? ORDER BY sli, dimension_key, value`
  )
    .bind(BUCKET_SECONDS)
    .all<{ sli: string; dimension_key: string; value: number }>();
  const groups = new Map<string, number[]>();
  for (const row of rows.results) {
    const values = groups.get(`${row.sli}\u0000${row.dimension_key}`) ?? [];
    values.push(row.value);
    groups.set(`${row.sli}\u0000${row.dimension_key}`, values);
  }
  const bucketStart = Math.floor(Date.now() / 1_000 / BUCKET_SECONDS) * BUCKET_SECONDS;
  for (const [key, values] of groups) {
    if (!key.includes('latency')) continue;
    const [sli, dimensionKey] = key.split('\u0000');
    const p95 = percentile95(values) ?? 0;
    await env.DB.prepare(
      `INSERT INTO operational_sli_rollups
        (bucket_start, bucket_seconds, sli, dimension_key, value, total_count, source)
       VALUES (?, ?, ?, ?, ?, ?, 'd1-sample-p95')
       ON CONFLICT(bucket_start, bucket_seconds, sli, dimension_key) DO UPDATE SET
         value = excluded.value, total_count = excluded.total_count, source = excluded.source`
    )
      .bind(
        bucketStart,
        BUCKET_SECONDS,
        `${sli.replace(/_ms$/, '')}_p95_ms`,
        dimensionKey ?? '',
        p95,
        values.length
      )
      .run();
  }
}

async function evaluateSloPolicies(env: Env): Promise<void> {
  const owner = env.OPERATIONAL_OWNER ?? 'lazuli-operations';
  for (const policy of SLO_POLICIES) {
    const ordering = policy.comparison === 'max' ? 'DESC' : 'ASC';
    const row = await env.DB.prepare(
      `SELECT * FROM operational_sli_rollups WHERE sli = ?
       AND bucket_start = (SELECT MAX(bucket_start) FROM operational_sli_rollups WHERE sli = ?)
       ORDER BY value ${ordering} LIMIT 1`
    )
      .bind(policy.sli, policy.sli)
      .first<SliRow>();
    if (!row || row.value === null) continue;
    const breached = sloBreached(row.value, policy.comparison, policy.threshold);
    const dedupeKey = `${env.ENVIRONMENT ?? 'local'}:${policy.id}`;
    const active = await env.DB.prepare(
      `SELECT * FROM operational_incidents WHERE dedupe_key = ?
       AND state IN ('open', 'acknowledged') LIMIT 1`
    )
      .bind(dedupeKey)
      .first<IncidentRow>();
    if (breached) {
      if (active) {
        await env.DB.prepare(
          `UPDATE operational_incidents SET observed_value = ?, last_observed_at = unixepoch(),
             details_json = ? WHERE id = ?`
        )
          .bind(
            row.value,
            JSON.stringify({ bucketStart: row.bucket_start, sli: row.sli }),
            active.id
          )
          .run();
      } else {
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO operational_incidents
            (id, policy_id, dedupe_key, severity, owner, runbook_url, summary,
             observed_value, threshold_value, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            policy.id,
            dedupeKey,
            policy.severity,
            owner,
            policy.runbook,
            policy.summary,
            row.value,
            policy.threshold,
            JSON.stringify({ bucketStart: row.bucket_start, sli: row.sli })
          )
          .run();
        await deliverIncidentEmail(env, id, policy, row.value);
      }
    } else if (active) {
      await env.DB.prepare(
        `UPDATE operational_incidents SET state = 'resolved', resolved_at = unixepoch(),
           resolution = 'SLI recovered automatically', observed_value = ?,
           last_observed_at = unixepoch() WHERE id = ?`
      )
        .bind(row.value, active.id)
        .run();
      await deliverIncidentEmail(env, active.id, policy, row.value, 'resolved');
    }
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function deliverIncidentEmail(
  env: Env,
  incidentId: string,
  policy: SloPolicy,
  value: number,
  transition: 'opened' | 'resolved' = 'opened'
): Promise<void> {
  const to = env.OPERATIONAL_ALERT_EMAIL;
  if (!to) return;
  const idempotencyKey = `${incidentId}:${transition}:email`;
  const deliveryId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO operational_alert_deliveries
      (id, incident_id, transition, channel, idempotency_key, status)
     VALUES (?, ?, ?, 'email', ?, 'queued')`
  )
    .bind(deliveryId, incidentId, transition, idempotencyKey)
    .run();
  try {
    const result = await sendAlertEmail(env, {
      to,
      subject:
        transition === 'resolved'
          ? `[RECOVERED] Lazuli: ${policy.summary}`
          : `[${policy.severity.toUpperCase()}] Lazuli: ${policy.summary}`,
      text: `${transition === 'resolved' ? 'Recovered' : policy.summary}\nObserved: ${value}\nThreshold: ${policy.threshold}\nOwner: ${env.OPERATIONAL_OWNER ?? 'lazuli-operations'}\nRunbook: ${policy.runbook}\nIncident: ${incidentId}`,
      payload: {
        incidentId,
        policyId: policy.id,
        transition,
        value,
        threshold: policy.threshold,
      },
      idempotencyKey,
    });
    await env.DB.prepare(
      `UPDATE operational_alert_deliveries SET status = ?, provider_status = ?,
         attempted_at = unixepoch(), delivered_at = CASE WHEN ? THEN unixepoch() END,
         last_error = ? WHERE id = ?`
    )
      .bind(
        result?.ok ? 'delivered' : 'failed',
        result?.status ?? null,
        result?.ok ? 1 : 0,
        result ? null : 'No operational email provider configured',
        deliveryId
      )
      .run();
  } catch (error) {
    await env.DB.prepare(
      `UPDATE operational_alert_deliveries SET status = 'failed', attempted_at = unixepoch(),
       last_error = ? WHERE id = ?`
    )
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), deliveryId)
      .run();
  }
}

function mapIncident(row: IncidentRow): unknown {
  return {
    id: row.id,
    policyId: row.policy_id,
    state: row.state,
    severity: row.severity,
    owner: row.owner,
    runbookUrl: row.runbook_url,
    summary: row.summary,
    observedValue: row.observed_value,
    thresholdValue: row.threshold_value,
    details: JSON.parse(row.details_json) as unknown,
    openedAt: row.opened_at,
    lastObservedAt: row.last_observed_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}
