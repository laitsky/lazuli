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
const MAX_COMPLETED_BATCHES = 512;
const MAX_COMPLETED_EVENTS = 2_048;
const MAX_LEGACY_CONNECTIONS = 50;
const MAX_BUFFERED_BYTES = 1_048_576;

export class RealtimeFanoutV3DO extends DurableObject<Env> {
  private readonly completedBatchIds = new Set<string>();
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
      const checkpoint = await ctx.storage.get<FanoutCheckpoint>(CHECKPOINT_KEY);
      for (const batchId of checkpoint?.completedBatchIds ?? []) {
        this.completedBatchIds.add(batchId);
      }
      for (const eventId of checkpoint?.completedEventIds ?? []) {
        this.completedEventIds.add(eventId);
      }
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
    if (this.completedBatchIds.has(input.batchId)) {
      return Response.json({ ok: true, duplicate: true, delivered: 0, timestamp: Date.now() });
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

    this.rememberBatch(input.batchId);
    for (const event of unseenEvents) {
      const eventId = realtimeEventId(event.event);
      if (eventId) this.rememberEvent(eventId);
    }
    const checkpointWrite = this.ctx.storage.put(CHECKPOINT_KEY, {
      completedBatchIds: [...this.completedBatchIds],
      completedEventIds: [...this.completedEventIds],
    } satisfies FanoutCheckpoint);

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
    await checkpointWrite;
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
