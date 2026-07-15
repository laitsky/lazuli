import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { BoundedRealtimeEventIndex } from './realtimeDedupe';
import { realtimeFanoutNames } from './realtimeFanout';
import {
  createBatchEnvelope,
  MAX_REALTIME_BATCH_EVENTS,
  MAX_REALTIME_FRAME_BYTES,
  realtimeEventId,
  timingSafeStringEqual,
  type CanonicalRealtimeEnvelope,
} from './realtimeProtocol';

interface SequencerCheckpoint {
  sequence: number;
  completedBatchIds: string[];
}

interface SequencerEventIndexCheckpoint {
  eventSequences: Array<[string, number]>;
}

interface SequencerRecoveryCheckpoint {
  recentEvents: CanonicalRealtimeEnvelope[];
}

const CHECKPOINT_KEY = 'sequencer-v1-state';
const EVENT_INDEX_KEY = 'sequencer-v1-event-index';
const RECOVERY_KEY = 'sequencer-v1-recovery';
const META_TABLE = 'realtime_sequencer_meta_v1';
const BATCH_TABLE = 'realtime_sequencer_batches_v1';
const EVENT_TABLE = 'realtime_sequencer_events_v1';
const RECOVERY_TABLE = 'realtime_sequencer_recovery_v1';
const MAX_RECENT_EVENTS = 96;
const MAX_RECENT_STORAGE_BYTES = 64_000;
const MAX_EVENT_IDS = 384;
const MAX_COMPLETED_BATCHES = 256;

export class RealtimeSequencerV1DO extends DurableObject<Env> {
  private sequence = 0;
  private readonly recent: CanonicalRealtimeEnvelope[] = [];
  private readonly eventSequences = new BoundedRealtimeEventIndex(MAX_EVENT_IDS);
  private readonly completedBatchIds = new Set<string>();
  private readonly ready: Promise<void>;
  private partialDispatches = 0;
  private dispatchRetries = 0;
  private deduplicatedEvents = 0;
  private requests = 0;
  private snapshotRequests = 0;
  private snapshotResets = 0;
  private publishLane: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`
        CREATE TABLE IF NOT EXISTS ${META_TABLE} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          sequence INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${BATCH_TABLE} (
          batch_id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
          envelopes_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
          event_id TEXT PRIMARY KEY,
          sequence INTEGER NOT NULL,
          envelope_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${RECOVERY_TABLE} (
          sequence INTEGER PRIMARY KEY,
          envelope_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      const [checkpoint, index, recovery] = await Promise.all([
        ctx.storage.get<SequencerCheckpoint>(CHECKPOINT_KEY),
        ctx.storage.get<SequencerEventIndexCheckpoint>(EVENT_INDEX_KEY),
        ctx.storage.get<SequencerRecoveryCheckpoint>(RECOVERY_KEY),
      ]);
      if (
        checkpoint &&
        sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${META_TABLE}`).one().count === 0
      ) {
        // Copy the legacy KV checkpoint once. It remains intact as the immediate
        // rollback source; all v2 hot-path writes go to bounded SQLite rows.
        const migratedAt = Date.now();
        ctx.storage.transactionSync(() => {
          sql.exec(`INSERT INTO ${META_TABLE} (id, sequence) VALUES (1, ?)`, checkpoint.sequence);
          for (const batchId of checkpoint.completedBatchIds ?? []) {
            sql.exec(
              `INSERT OR IGNORE INTO ${BATCH_TABLE}
                 (batch_id, state, envelopes_json, created_at)
               VALUES (?, 'completed', '[]', ?)`,
              batchId,
              migratedAt
            );
          }
          for (const [eventId, sequence] of index?.eventSequences ?? []) {
            sql.exec(
              `INSERT OR IGNORE INTO ${EVENT_TABLE}
                 (event_id, sequence, envelope_json, created_at)
               VALUES (?, ?, NULL, ?)`,
              eventId,
              sequence,
              migratedAt
            );
          }
          for (const event of recovery?.recentEvents ?? []) {
            sql.exec(
              `INSERT OR REPLACE INTO ${RECOVERY_TABLE}
                 (sequence, envelope_json, created_at) VALUES (?, ?, ?)`,
              event.sequence,
              JSON.stringify(event),
              migratedAt
            );
          }
        });
      }
      const meta = sql
        .exec<{ sequence: number }>(`SELECT sequence FROM ${META_TABLE} WHERE id = 1`)
        .toArray()[0];
      this.sequence = meta?.sequence ?? 0;
      this.eventSequences.restore(
        sql
          .exec<{ event_id: string; sequence: number }>(
            `SELECT event_id, sequence FROM (
               SELECT event_id, sequence, created_at, rowid FROM ${EVENT_TABLE}
               ORDER BY created_at DESC, rowid DESC LIMIT ?
             ) ORDER BY created_at ASC, rowid ASC`,
            MAX_EVENT_IDS
          )
          .toArray()
          .map((row) => [row.event_id, row.sequence] as [string, number])
      );
      for (const row of sql.exec<{ envelope_json: string }>(
        `SELECT envelope_json FROM ${RECOVERY_TABLE} ORDER BY sequence ASC LIMIT ?`,
        MAX_RECENT_EVENTS
      )) {
        const event = parseCanonicalEnvelope(row.envelope_json);
        if (event) this.recent.push(event);
      }
      for (const row of sql.exec<{ batch_id: string }>(
        `SELECT batch_id FROM (
           SELECT batch_id, created_at, rowid FROM ${BATCH_TABLE}
           WHERE state = 'completed'
           ORDER BY created_at DESC, rowid DESC LIMIT ?
         ) ORDER BY created_at ASC, rowid ASC`,
        MAX_COMPLETED_BATCHES
      )) {
        this.completedBatchIds.add(row.batch_id);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/health') return this.health();
    if (request.method === 'GET' && url.pathname === '/snapshot') {
      return this.snapshot(url.searchParams.get('topic'), url.searchParams.get('after'));
    }
    if (request.method === 'POST' && url.pathname === '/publish-batch') {
      return this.enqueuePublish(request, url.searchParams.get('topic'));
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  private async enqueuePublish(request: Request, topic: string | null): Promise<Response> {
    const previous = this.publishLane;
    let release = (): void => undefined;
    this.publishLane = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.publishBatch(request, topic);
    } finally {
      release();
    }
  }

  private async publishBatch(request: Request, topic: string | null): Promise<Response> {
    if (!this.authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!validTopic(topic)) return Response.json({ error: 'Missing topic' }, { status: 400 });
    const input = (await request.json().catch(() => null)) as {
      batchId?: unknown;
      events?: unknown;
    } | null;
    if (
      !input ||
      typeof input.batchId !== 'string' ||
      !validBatchId(input.batchId) ||
      !Array.isArray(input.events) ||
      input.events.length === 0 ||
      input.events.length > MAX_REALTIME_BATCH_EVENTS ||
      !input.events.every(isEventRecord)
    ) {
      return Response.json({ error: 'Invalid realtime batch' }, { status: 400 });
    }
    const persistedBatch = this.ctx.storage.sql
      .exec<{
        state: 'processing' | 'completed';
        envelopes_json: string;
      }>(`SELECT state, envelopes_json FROM ${BATCH_TABLE} WHERE batch_id = ?`, input.batchId)
      .toArray()[0];
    if (this.completedBatchIds.has(input.batchId) || persistedBatch?.state === 'completed') {
      return Response.json({
        ok: true,
        duplicate: true,
        topic,
        sequences: [],
        delivered: 0,
        timestamp: Date.now(),
      });
    }
    this.requests += 1;
    if (persistedBatch?.state === 'processing') {
      const persistedEnvelopes = parseCanonicalEnvelopes(persistedBatch.envelopes_json);
      if (!persistedEnvelopes || persistedEnvelopes.some((event) => event.topic !== topic)) {
        return Response.json({ error: 'Persisted realtime batch is invalid' }, { status: 500 });
      }
      this.dispatchRetries += 1;
      return this.dispatchCanonicalBatch(input.batchId, topic, persistedEnvelopes);
    }

    const envelopes: CanonicalRealtimeEnvelope[] = [];
    const eventIdsInBatch = new Set<string>();
    const newEvents: Array<{ eventId: string; envelope: CanonicalRealtimeEnvelope }> = [];
    const inputEventIds = input.events.flatMap((event) => {
      const eventId = realtimeEventId(event);
      return eventId ? [eventId] : [];
    });
    const persistedEvents = this.loadPersistedEvents(inputEventIds);
    let nextSequence = this.sequence;
    let duplicateCount = 0;
    for (const event of input.events) {
      const eventId = realtimeEventId(event);
      if (!eventId)
        return Response.json({ error: 'Every event requires eventId' }, { status: 400 });
      if (eventIdsInBatch.has(eventId)) {
        duplicateCount += 1;
        continue;
      }
      eventIdsInBatch.add(eventId);
      const persistedEvent = persistedEvents.get(eventId);
      const existingSequence = persistedEvent?.sequence ?? this.eventSequences.get(eventId);
      const sequence = existingSequence ?? ++nextSequence;
      if (existingSequence !== undefined) duplicateCount += 1;
      const existingEnvelope = persistedEvent?.envelope;
      const publishedAt = Date.now();
      const canonicalEvent = { ...event, topic, sequence, publishedAt };
      const envelope: CanonicalRealtimeEnvelope =
        existingEnvelope ??
        ({
          type: 'event',
          topic,
          sequence,
          event: canonicalEvent,
          data: event,
          publishedAt,
        } satisfies CanonicalRealtimeEnvelope);
      envelopes.push(envelope);
      if (existingSequence === undefined) newEvents.push({ eventId, envelope });
    }

    const encoded = JSON.stringify(createBatchEnvelope(topic, envelopes));
    if (new TextEncoder().encode(encoded).byteLength > MAX_REALTIME_FRAME_BYTES) {
      return Response.json({ error: 'Realtime frame exceeds the bounded size' }, { status: 413 });
    }

    this.sequence = nextSequence;
    this.deduplicatedEvents += duplicateCount;
    const persistedAt = Date.now();
    // Persist the exact canonical envelopes and ID-to-sequence mapping before
    // any leaf dispatch. A crash or partial dispatch can therefore replay the
    // same batch without allocating new sequences or publish timestamps.
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec(
        `INSERT INTO ${META_TABLE} (id, sequence) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence`,
        this.sequence
      );
      sql.exec(
        `INSERT INTO ${BATCH_TABLE}
           (batch_id, state, envelopes_json, created_at)
         VALUES (?, 'processing', ?, ?)`,
        input.batchId,
        JSON.stringify(envelopes),
        persistedAt
      );
      for (const { eventId, envelope } of newEvents) {
        const encodedEnvelope = JSON.stringify(envelope);
        sql.exec(
          `INSERT OR IGNORE INTO ${EVENT_TABLE}
             (event_id, sequence, envelope_json, created_at) VALUES (?, ?, ?, ?)`,
          eventId,
          envelope.sequence,
          encodedEnvelope,
          persistedAt
        );
        sql.exec(
          `INSERT OR REPLACE INTO ${RECOVERY_TABLE}
             (sequence, envelope_json, created_at) VALUES (?, ?, ?)`,
          envelope.sequence,
          encodedEnvelope,
          persistedAt
        );
      }
      this.trimSqlCheckpoints();
    });
    for (const { eventId, envelope } of newEvents) {
      this.eventSequences.remember(eventId, envelope.sequence);
      this.rememberRecent(envelope);
    }
    return this.dispatchCanonicalBatch(input.batchId, topic, envelopes);
  }

  private async dispatchCanonicalBatch(
    batchId: string,
    topic: string,
    envelopes: CanonicalRealtimeEnvelope[]
  ): Promise<Response> {
    const startedAt = Date.now();
    const results = await Promise.allSettled(
      realtimeFanoutNames(topic).map((name) => this.dispatch(name, topic, batchId, envelopes))
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failures.length > 0) {
      this.partialDispatches += 1;
      this.env.API_ANALYTICS?.writeDataPoint({
        blobs: ['realtime_partial_dispatch', topic],
        doubles: [failures.length, envelopes.length, Date.now() - startedAt],
        indexes: ['realtime_partial_dispatch'],
      });
      return Response.json(
        {
          error: 'Realtime fanout dispatch incomplete',
          failedLeaves: failures.length,
          retryable: true,
        },
        { status: 503 }
      );
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE ${BATCH_TABLE} SET state = 'completed' WHERE batch_id = ?`,
        batchId
      );
    });
    this.rememberCompletedBatch(batchId);
    const delivered = results.reduce(
      (sum, result) => (result.status === 'fulfilled' ? sum + result.value.delivered : sum),
      0
    );
    this.env.API_ANALYTICS?.writeDataPoint({
      blobs: ['realtime_leaf_dispatch_ms', topic],
      doubles: [Date.now() - startedAt, envelopes.length],
      indexes: ['realtime_leaf_dispatch_ms'],
    });
    return Response.json({
      ok: true,
      topic,
      sequences: envelopes.map((event) => event.sequence),
      delivered,
      timestamp: Date.now(),
    });
  }

  private loadPersistedEvents(
    eventIds: string[]
  ): Map<string, { sequence: number; envelope: CanonicalRealtimeEnvelope | null }> {
    const persisted = new Map<
      string,
      { sequence: number; envelope: CanonicalRealtimeEnvelope | null }
    >();
    const uniqueIds = [...new Set(eventIds)];
    for (let offset = 0; offset < uniqueIds.length; offset += 90) {
      const chunk = uniqueIds.slice(offset, offset + 90);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => '?').join(', ');
      for (const row of this.ctx.storage.sql.exec<{
        event_id: string;
        sequence: number;
        envelope_json: string | null;
      }>(
        `SELECT event_id, sequence, envelope_json FROM ${EVENT_TABLE}
         WHERE event_id IN (${placeholders})`,
        ...chunk
      )) {
        persisted.set(row.event_id, {
          sequence: row.sequence,
          envelope: row.envelope_json ? parseCanonicalEnvelope(row.envelope_json) : null,
        });
      }
    }
    return persisted;
  }

  private trimSqlCheckpoints(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      `DELETE FROM ${BATCH_TABLE}
       WHERE rowid NOT IN (
         SELECT rowid FROM ${BATCH_TABLE}
         ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`,
      MAX_COMPLETED_BATCHES
    );
    sql.exec(
      `DELETE FROM ${EVENT_TABLE}
       WHERE rowid NOT IN (
         SELECT rowid FROM ${EVENT_TABLE}
         ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`,
      MAX_EVENT_IDS
    );
    sql.exec(
      `DELETE FROM ${RECOVERY_TABLE}
       WHERE rowid NOT IN (
         SELECT rowid FROM ${RECOVERY_TABLE}
         ORDER BY sequence DESC LIMIT ?
       )`,
      MAX_RECENT_EVENTS
    );
    let retainedBytes = 0;
    let minimumRetainedSequence: number | null = null;
    for (const row of sql.exec<{ sequence: number; envelope_json: string }>(
      `SELECT sequence, envelope_json FROM ${RECOVERY_TABLE} ORDER BY sequence DESC`
    )) {
      const bytes = new TextEncoder().encode(row.envelope_json).byteLength;
      if (retainedBytes + bytes > MAX_RECENT_STORAGE_BYTES) break;
      retainedBytes += bytes;
      minimumRetainedSequence = row.sequence;
    }
    if (minimumRetainedSequence === null) {
      sql.exec(`DELETE FROM ${RECOVERY_TABLE}`);
    } else {
      sql.exec(`DELETE FROM ${RECOVERY_TABLE} WHERE sequence < ?`, minimumRetainedSequence);
    }
  }

  private async dispatch(
    leafName: string,
    topic: string,
    batchId: string,
    events: CanonicalRealtimeEnvelope[]
  ): Promise<{ delivered: number }> {
    if (!this.env.REALTIME_FANOUT || !this.env.ADMIN_API_KEY) {
      throw new Error('Realtime fanout is not configured');
    }
    const url = new URL('https://realtime-fanout/publish-batch');
    url.searchParams.set('topic', topic);
    const id = this.env.REALTIME_FANOUT.idFromName(leafName);
    const response = await this.env.REALTIME_FANOUT.get(id).fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-API-Key': this.env.ADMIN_API_KEY },
      body: JSON.stringify({ batchId, events }),
    });
    if (!response.ok) throw new Error(`Fanout leaf ${leafName} returned HTTP ${response.status}`);
    return (await response.json()) as { delivered: number };
  }

  private snapshot(topic: string | null, rawAfter: string | null): Response {
    if (!validTopic(topic)) return Response.json({ error: 'Missing topic' }, { status: 400 });
    const after = parseSequence(rawAfter);
    const events = this.recent.filter(
      (event) => event.topic === topic && (after === null || event.sequence > after)
    );
    const oldest = this.recent[0]?.sequence ?? this.sequence + 1;
    const resetRequired =
      after !== null && (after > this.sequence || (after < this.sequence && after < oldest - 1));
    this.snapshotRequests += 1;
    if (resetRequired) this.snapshotResets += 1;
    return Response.json({
      topic,
      sequence: this.sequence,
      resetRequired,
      events,
      timestamp: Date.now(),
    });
  }

  private health(): Response {
    return Response.json({
      ok: true,
      sequence: this.sequence,
      retainedEvents: this.recent.length,
      partialDispatches: this.partialDispatches,
      dispatchRetries: this.dispatchRetries,
      deduplicatedEvents: this.deduplicatedEvents,
      requests: this.requests,
      snapshotRequests: this.snapshotRequests,
      snapshotResets: this.snapshotResets,
      timestamp: Date.now(),
    });
  }

  private authorized(request: Request): boolean {
    const expected = this.env.ADMIN_API_KEY;
    const provided = request.headers.get('X-Admin-API-Key');
    return Boolean(expected && provided && timingSafeStringEqual(provided, expected));
  }

  private rememberRecent(event: CanonicalRealtimeEnvelope): void {
    this.recent.push(event);
    while (
      this.recent.length > MAX_RECENT_EVENTS ||
      new TextEncoder().encode(JSON.stringify(this.recent)).byteLength > MAX_RECENT_STORAGE_BYTES
    ) {
      this.recent.shift();
    }
  }

  private rememberCompletedBatch(batchId: string): void {
    this.completedBatchIds.delete(batchId);
    this.completedBatchIds.add(batchId);
    while (this.completedBatchIds.size > MAX_COMPLETED_BATCHES) {
      const oldest = this.completedBatchIds.values().next().value as string | undefined;
      if (!oldest) break;
      this.completedBatchIds.delete(oldest);
    }
  }
}

function validTopic(topic: string | null): topic is string {
  return Boolean(topic && topic.length <= 120 && /^[a-z0-9:._-]+$/.test(topic));
}

function validBatchId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

function isEventRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCanonicalEnvelope(value: string): CanonicalRealtimeEnvelope | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isCanonicalEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCanonicalEnvelopes(value: string): CanonicalRealtimeEnvelope[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every(isCanonicalEnvelope) ? parsed : null;
  } catch {
    return null;
  }
}

function isCanonicalEnvelope(value: unknown): value is CanonicalRealtimeEnvelope {
  if (!isEventRecord(value)) return false;
  return (
    value.type === 'event' &&
    typeof value.topic === 'string' &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.publishedAt === 'number' &&
    isEventRecord(value.event)
  );
}

function parseSequence(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}
