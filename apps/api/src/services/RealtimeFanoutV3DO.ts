import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import {
  acceptsRealtimeV2,
  createBatchEnvelope,
  MAX_REALTIME_BATCH_EVENTS,
  MAX_REALTIME_FRAME_BYTES,
  REALTIME_V2_PROTOCOL,
  realtimeEventId,
  timingSafeStringEqual,
  type CanonicalRealtimeEnvelope,
} from './realtimeProtocol';
import { boundedCheckpointEvictions } from './realtimeCheckpoint';

interface SocketAttachment {
  topic: string;
  protocol: 'v1' | 'v2';
  connectedAt: number;
}

interface FanoutCheckpoint {
  completedBatchIds: string[];
  completedEventIds: string[];
}

const CHECKPOINT_KEY = 'fanout-v3-checkpoint';
const BATCH_TABLE = 'realtime_fanout_batches_v1';
const EVENT_TABLE = 'realtime_fanout_events_v1';
const MAX_COMPLETED_BATCHES = 512;
const MAX_PROCESSING_BATCHES = 64;
const MAX_COMPLETED_EVENTS = 2_048;
const MAX_LEGACY_CONNECTIONS = 50;
const MAX_BUFFERED_BYTES = 1_048_576;

export class RealtimeFanoutV3DO extends DurableObject<Env> {
  private readonly completedBatchIds = new Set<string>();
  private readonly processingBatchIds = new Set<string>();
  private readonly completedEventIds = new Set<string>();
  private readonly ready: Promise<void>;
  private slowConsumers = 0;
  private batchesPublished = 0;
  private logicalEventsPublished = 0;
  private bytesPublished = 0;
  private deduplicatedEvents = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`
        CREATE TABLE IF NOT EXISTS ${BATCH_TABLE} (
          batch_id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
          event_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
      `);
      const checkpoint = await ctx.storage.get<FanoutCheckpoint>(CHECKPOINT_KEY);
      if (
        checkpoint &&
        sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${BATCH_TABLE}`).one().count ===
          0
      ) {
        // Preserve the legacy KV checkpoint for rollback while copying its
        // bounded dedupe state into the SQLite hot path once.
        const migratedAt = Date.now();
        ctx.storage.transactionSync(() => {
          for (const batchId of checkpoint.completedBatchIds) {
            sql.exec(
              `INSERT OR IGNORE INTO ${BATCH_TABLE} (batch_id, state, created_at)
               VALUES (?, 'completed', ?)`,
              batchId,
              migratedAt
            );
          }
          for (const eventId of checkpoint.completedEventIds) {
            sql.exec(
              `INSERT OR IGNORE INTO ${EVENT_TABLE} (event_id, created_at) VALUES (?, ?)`,
              eventId,
              migratedAt
            );
          }
        });
      }
      for (const row of sql.exec<{ batch_id: string }>(
        `SELECT batch_id FROM (
           SELECT batch_id, created_at, rowid FROM ${BATCH_TABLE} WHERE state = 'completed'
           ORDER BY created_at DESC, rowid DESC LIMIT ?
         ) ORDER BY created_at ASC, rowid ASC`,
        MAX_COMPLETED_BATCHES
      )) {
        this.completedBatchIds.add(row.batch_id);
      }
      for (const row of sql.exec<{ batch_id: string }>(
        `SELECT batch_id FROM (
           SELECT batch_id, created_at, rowid FROM ${BATCH_TABLE} WHERE state = 'processing'
           ORDER BY created_at DESC, rowid DESC LIMIT ?
         ) ORDER BY created_at ASC, rowid ASC`,
        MAX_PROCESSING_BATCHES
      )) {
        this.processingBatchIds.add(row.batch_id);
      }
      for (const row of sql.exec<{ event_id: string }>(
        `SELECT event_id FROM (
           SELECT event_id, created_at, rowid FROM ${EVENT_TABLE}
           ORDER BY created_at DESC, rowid DESC LIMIT ?
         ) ORDER BY created_at ASC, rowid ASC`,
        MAX_COMPLETED_EVENTS
      )) {
        this.completedEventIds.add(row.event_id);
      }
      ctx.storage.transactionSync(() => {
        sql.exec(
          `DELETE FROM ${BATCH_TABLE}
           WHERE state = 'completed' AND rowid NOT IN (
             SELECT rowid FROM ${BATCH_TABLE} WHERE state = 'completed'
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`,
          MAX_COMPLETED_BATCHES
        );
        sql.exec(
          `DELETE FROM ${BATCH_TABLE}
           WHERE state = 'processing' AND rowid NOT IN (
             SELECT rowid FROM ${BATCH_TABLE} WHERE state = 'processing'
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`,
          MAX_PROCESSING_BATCHES
        );
        sql.exec(
          `DELETE FROM ${EVENT_TABLE}
           WHERE rowid NOT IN (
             SELECT rowid FROM ${EVENT_TABLE}
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`,
          MAX_COMPLETED_EVENTS
        );
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/health') return this.health();
    if (request.method === 'POST' && url.pathname === '/publish-batch') {
      return this.publishBatch(request, url.searchParams.get('topic'));
    }
    return this.acceptSocket(request, url.searchParams.get('topic'));
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    if (message === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', topic: attachment.topic, timestamp: Date.now() }));
      return;
    }
    socket.send(JSON.stringify({ type: 'ack', topic: attachment.topic, receivedAt: Date.now() }));
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'WebSocket error');
  }

  private acceptSocket(request: Request, topic: string | null): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'Expected WebSocket upgrade' }, { status: 426 });
    }
    if (!validTopic(topic)) return Response.json({ error: 'Missing topic' }, { status: 400 });
    const v2 = acceptsRealtimeV2(request.headers.get('Sec-WebSocket-Protocol'));
    const legacyCapacityExceeded = !v2 && this.legacyConnectionCount() >= MAX_LEGACY_CONNECTIONS;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({
      topic,
      protocol: v2 ? 'v2' : 'v1',
      connectedAt: Date.now(),
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [topic, v2 ? 'protocol:v2' : 'protocol:v1']);
    if (legacyCapacityExceeded) {
      server.close(1013, 'Legacy realtime capacity reached; use v2 or REST polling');
      return new Response(null, { status: 101, webSocket: client });
    }
    server.send(JSON.stringify({ type: 'subscribed', topic, sequence: 0, timestamp: Date.now() }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: v2 ? { 'Sec-WebSocket-Protocol': REALTIME_V2_PROTOCOL } : undefined,
    });
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
      !input.events.every(
        (event) =>
          isCanonicalEnvelope(event) &&
          event.topic === topic &&
          realtimeEventId(event.event) !== null
      )
    ) {
      return Response.json({ error: 'Invalid canonical realtime batch' }, { status: 400 });
    }
    const persistedBatch = this.ctx.storage.sql
      .exec<{
        state: 'processing' | 'completed';
      }>(`SELECT state FROM ${BATCH_TABLE} WHERE batch_id = ?`, input.batchId)
      .toArray()[0];
    if (this.completedBatchIds.has(input.batchId) || persistedBatch?.state === 'completed') {
      return Response.json({ ok: true, duplicate: true, delivered: 0, timestamp: Date.now() });
    }
    if (!persistedBatch && this.processingBatchIds.size >= MAX_PROCESSING_BATCHES) {
      return Response.json(
        { error: 'Realtime fanout is at its bounded retry capacity', retryable: true },
        { status: 503 }
      );
    }

    const unseenEvents = input.events.filter((event) => {
      const eventId = realtimeEventId(event.event);
      return eventId !== null && !this.completedEventIds.has(eventId);
    });
    let encodedBatch: string | null = null;
    if (unseenEvents.length > 0) {
      encodedBatch = JSON.stringify(createBatchEnvelope(topic, unseenEvents));
      if (new TextEncoder().encode(encodedBatch).byteLength > MAX_REALTIME_FRAME_BYTES) {
        return Response.json({ error: 'Realtime frame exceeds the bounded size' }, { status: 413 });
      }
    }

    const eventIds = unseenEvents.flatMap((event) => {
      const eventId = realtimeEventId(event.event);
      return eventId ? [eventId] : [];
    });
    const evictedEventIds = boundedCheckpointEvictions(
      this.completedEventIds,
      eventIds,
      MAX_COMPLETED_EVENTS
    );
    const persistedAt = Date.now();
    // A processing marker makes crash recovery at-least-once. If a leaf dies
    // after sending only part of a batch, the canonical retry is sent again and
    // v2 clients suppress repeated event IDs before applying it.
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec(
        `INSERT OR IGNORE INTO ${BATCH_TABLE} (batch_id, state, created_at)
         VALUES (?, 'processing', ?)`,
        input.batchId,
        persistedAt
      );
    });
    this.rememberProcessingBatch(input.batchId);

    let delivered = 0;
    for (const socket of unseenEvents.length > 0 ? this.ctx.getWebSockets(topic) : []) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || this.evictSlow(socket)) continue;
      try {
        if (attachment.protocol === 'v2') {
          socket.send(encodedBatch as string);
          delivered += unseenEvents.length;
        } else {
          for (const event of unseenEvents) {
            socket.send(JSON.stringify(event));
            delivered += 1;
          }
        }
      } catch {
        socket.close(1011, 'Publish failed');
      }
    }
    const evictedCompletedBatchIds = boundedCheckpointEvictions(
      this.completedBatchIds,
      [input.batchId],
      MAX_COMPLETED_BATCHES
    );
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      for (const eventId of eventIds) {
        sql.exec(
          `INSERT OR IGNORE INTO ${EVENT_TABLE} (event_id, created_at) VALUES (?, ?)`,
          eventId,
          persistedAt
        );
      }
      for (const eventId of evictedEventIds) {
        sql.exec(`DELETE FROM ${EVENT_TABLE} WHERE event_id = ?`, eventId);
      }
      sql.exec(`UPDATE ${BATCH_TABLE} SET state = 'completed' WHERE batch_id = ?`, input.batchId);
      for (const batchId of evictedCompletedBatchIds) {
        sql.exec(`DELETE FROM ${BATCH_TABLE} WHERE batch_id = ?`, batchId);
      }
    });
    this.processingBatchIds.delete(input.batchId);
    this.rememberBatch(input.batchId);
    for (const eventId of eventIds) this.rememberEvent(eventId);
    this.batchesPublished += 1;
    this.logicalEventsPublished += unseenEvents.length;
    this.bytesPublished +=
      encodedBatch === null ? 0 : new TextEncoder().encode(encodedBatch).byteLength;
    this.deduplicatedEvents += input.events.length - unseenEvents.length;
    this.env.API_ANALYTICS?.writeDataPoint({
      blobs: ['realtime_fanout_frame', topic],
      doubles: [
        unseenEvents.length,
        encodedBatch === null ? 0 : new TextEncoder().encode(encodedBatch).byteLength,
        delivered,
      ],
      indexes: ['realtime_fanout_frame'],
    });
    return Response.json({
      ok: true,
      delivered,
      deduplicated: input.events.length - unseenEvents.length,
      timestamp: Date.now(),
    });
  }

  private health(): Response {
    const sockets = this.ctx.getWebSockets();
    let v1Connections = 0;
    let v2Connections = 0;
    for (const socket of sockets) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.protocol === 'v2') v2Connections += 1;
      else if (attachment) v1Connections += 1;
    }
    return Response.json({
      ok: true,
      connections: sockets.length,
      v1Connections,
      v2Connections,
      batchesPublished: this.batchesPublished,
      logicalEventsPublished: this.logicalEventsPublished,
      bytesPublished: this.bytesPublished,
      logicalEventsPerFrame:
        this.batchesPublished === 0 ? 0 : this.logicalEventsPublished / this.batchesPublished,
      averageBytesPerFrame:
        this.batchesPublished === 0 ? 0 : this.bytesPublished / this.batchesPublished,
      deduplicatedEvents: this.deduplicatedEvents,
      slowConsumers: this.slowConsumers,
      timestamp: Date.now(),
    });
  }

  private authorized(request: Request): boolean {
    const expected = this.env.ADMIN_API_KEY;
    const provided = request.headers.get('X-Admin-API-Key');
    return Boolean(expected && provided && timingSafeStringEqual(provided, expected));
  }

  private legacyConnectionCount(): number {
    return this.ctx
      .getWebSockets('protocol:v1')
      .filter((socket) => socket.readyState === WebSocket.OPEN).length;
  }

  private evictSlow(socket: WebSocket): boolean {
    const bufferedAmount = (socket as WebSocket & { bufferedAmount?: number }).bufferedAmount ?? 0;
    if (bufferedAmount <= MAX_BUFFERED_BYTES) return false;
    this.slowConsumers += 1;
    socket.close(1013, 'Slow consumer');
    return true;
  }

  private rememberBatch(batchId: string): void {
    this.completedBatchIds.delete(batchId);
    this.completedBatchIds.add(batchId);
    while (this.completedBatchIds.size > MAX_COMPLETED_BATCHES) {
      const oldest = this.completedBatchIds.values().next().value as string | undefined;
      if (!oldest) break;
      this.completedBatchIds.delete(oldest);
    }
  }

  private rememberProcessingBatch(batchId: string): void {
    this.processingBatchIds.delete(batchId);
    this.processingBatchIds.add(batchId);
    while (this.processingBatchIds.size > MAX_PROCESSING_BATCHES) {
      const oldest = this.processingBatchIds.values().next().value as string | undefined;
      if (!oldest) break;
      this.processingBatchIds.delete(oldest);
    }
  }

  private rememberEvent(eventId: string): void {
    this.completedEventIds.delete(eventId);
    this.completedEventIds.add(eventId);
    while (this.completedEventIds.size > MAX_COMPLETED_EVENTS) {
      const oldest = this.completedEventIds.values().next().value as string | undefined;
      if (!oldest) break;
      this.completedEventIds.delete(oldest);
    }
  }
}

function validTopic(topic: string | null): topic is string {
  return Boolean(topic && topic.length <= 120 && /^[a-z0-9:._-]+$/.test(topic));
}

function validBatchId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

function isCanonicalEnvelope(value: unknown): value is CanonicalRealtimeEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Partial<CanonicalRealtimeEnvelope>;
  return (
    event.type === 'event' &&
    typeof event.topic === 'string' &&
    Number.isSafeInteger(event.sequence) &&
    typeof event.publishedAt === 'number' &&
    typeof event.event === 'object' &&
    event.event !== null
  );
}
