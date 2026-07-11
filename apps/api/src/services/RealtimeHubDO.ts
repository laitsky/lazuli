import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { BoundedRealtimeEventIndex } from './realtimeDedupe';

interface SocketAttachment {
  topic: string;
  connectedAt: number;
  lastSequence: number;
}

const MAX_TOPIC_LENGTH = 120;
const MAX_SNAPSHOT_EVENTS = 256;
const MAX_DEDUPE_EVENTS = 2048;
const MAX_BUFFERED_BYTES = 1_048_576;
const MAX_CHECKPOINT_BYTES = 1_500_000;
const CHECKPOINT_KEY = 'realtime-checkpoint-v1';

interface RealtimeEnvelope {
  type: 'event';
  topic: string;
  sequence: number;
  event: Record<string, unknown>;
  /** Backward-compatible alias removed after all pre-v1 clients migrate. */
  data: unknown;
  publishedAt: number;
}

interface RealtimeCheckpoint {
  sequence: number;
  recent: RealtimeEnvelope[];
  eventSequences: Array<[string, number]>;
}

export class RealtimeHubV2DO extends DurableObject<Env> {
  private sequence = 0;
  private readonly recent: RealtimeEnvelope[] = [];
  private readonly eventSequences = new BoundedRealtimeEventIndex(MAX_DEDUPE_EVENTS);
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const checkpoint = await ctx.storage.get<RealtimeCheckpoint>(CHECKPOINT_KEY);
      if (!checkpoint) return;
      this.sequence = checkpoint.sequence;
      this.recent.push(...checkpoint.recent.slice(-MAX_SNAPSHOT_EVENTS));
      this.eventSequences.restore(checkpoint.eventSequences);
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        connections: this.ctx.getWebSockets().length,
        sequence: this.sequence,
        retainedEvents: this.recent.length,
        timestamp: Date.now(),
      });
    }

    if (request.method === 'GET' && url.pathname === '/snapshot') {
      this.restoreSequenceFromSockets();
      const topic = sanitizeTopic(url.searchParams.get('topic'));
      if (!topic) return Response.json({ error: 'Missing topic' }, { status: 400 });
      const after = parseSequence(url.searchParams.get('after'));
      const events = this.recent.filter(
        (event) => event.topic === topic && (after === null || event.sequence > after)
      );
      return Response.json({
        topic,
        sequence: this.sequence,
        resetRequired:
          after !== null &&
          events.length === 0 &&
          (after > this.sequence || after < Math.max(0, this.sequence - this.recent.length)),
        events,
        timestamp: Date.now(),
      });
    }

    if (request.method === 'POST' && url.pathname === '/publish') {
      if (!this.env.ADMIN_API_KEY) {
        return Response.json({ error: 'Publishing is disabled' }, { status: 503 });
      }
      const providedKey = request.headers.get('X-Admin-API-Key');
      if (!providedKey || !timingSafeEqual(providedKey, this.env.ADMIN_API_KEY)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const topic = sanitizeTopic(url.searchParams.get('topic'));
      if (!topic) return Response.json({ error: 'Missing topic' }, { status: 400 });
      const payload = await request.json().catch(() => null);
      if (payload === null) {
        return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
      }
      const eventId = realtimeEventId(payload);
      if (!eventId) {
        return Response.json({ error: 'A valid eventId is required' }, { status: 400 });
      }
      return this.ctx.blockConcurrencyWhile(() => this.publish(topic, eventId, payload));
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'Expected WebSocket upgrade' }, { status: 426 });
    }

    const topic = sanitizeTopic(url.searchParams.get('topic'));
    if (!topic) return Response.json({ error: 'Missing topic' }, { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      topic,
      connectedAt: Date.now(),
      lastSequence: this.sequence,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [topic]);
    this.env.API_ANALYTICS?.writeDataPoint({
      blobs: ['ws_peak_connections', topic],
      doubles: [this.ctx.getWebSockets().length, Date.now()],
      indexes: ['ws_peak_connections'],
    });
    server.send(
      JSON.stringify({ type: 'subscribed', topic, sequence: this.sequence, timestamp: Date.now() })
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const session = socket.deserializeAttachment() as SocketAttachment | null;
    if (!session) return;

    if (message === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', topic: session.topic, timestamp: Date.now() }));
      return;
    }

    socket.send(JSON.stringify({ type: 'ack', topic: session.topic, receivedAt: Date.now() }));
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'WebSocket error');
  }

  private append(topic: string, payload: unknown): RealtimeEnvelope {
    this.restoreSequenceFromSockets();
    const sequence = ++this.sequence;
    const publishedAt = Date.now();
    const event =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? { ...(payload as Record<string, unknown>), topic, sequence, publishedAt }
        : { topic, sequence, publishedAt, payload };
    const envelope: RealtimeEnvelope = {
      type: 'event',
      topic,
      sequence,
      event,
      data: payload,
      publishedAt,
    };
    this.recent.push(envelope);
    if (this.recent.length > MAX_SNAPSHOT_EVENTS) {
      this.recent.splice(0, this.recent.length - MAX_SNAPSHOT_EVENTS);
    }
    return envelope;
  }

  /** Hibernation recreates the class but preserves serialized socket attachments. */
  private restoreSequenceFromSockets(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment && attachment.lastSequence > this.sequence) {
        this.sequence = attachment.lastSequence;
      }
    }
  }

  private broadcast(envelope: RealtimeEnvelope): number {
    const encoded = JSON.stringify(envelope);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets(envelope.topic)) {
      try {
        const bufferedAmount =
          (socket as WebSocket & { bufferedAmount?: number }).bufferedAmount ?? 0;
        if (bufferedAmount > MAX_BUFFERED_BYTES) {
          socket.close(1013, 'Slow consumer');
          continue;
        }
        socket.send(encoded);
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment) {
          socket.serializeAttachment({ ...attachment, lastSequence: envelope.sequence });
        }
        delivered += 1;
      } catch {
        socket.close(1011, 'Publish failed');
      }
    }
    return delivered;
  }

  private async publish(topic: string, eventId: string, payload: unknown): Promise<Response> {
    const existingSequence = this.eventSequences.get(eventId);
    if (existingSequence !== undefined) {
      return Response.json({
        ok: true,
        duplicate: true,
        topic,
        sequence: existingSequence,
        delivered: 0,
        timestamp: Date.now(),
      });
    }

    const envelope = this.append(topic, payload);
    const delivered = this.broadcast(envelope);
    this.rememberEvent(eventId, envelope.sequence);
    await this.persistCheckpoint();
    return Response.json({
      ok: true,
      topic,
      sequence: envelope.sequence,
      delivered,
      timestamp: envelope.publishedAt,
    });
  }

  private rememberEvent(eventId: string, sequence: number): void {
    this.eventSequences.remember(eventId, sequence);
  }

  private async persistCheckpoint(): Promise<void> {
    const eventSequences = this.eventSequences.entries();
    let recent = this.recent.slice(-MAX_SNAPSHOT_EVENTS);
    let checkpoint: RealtimeCheckpoint = { sequence: this.sequence, recent, eventSequences };
    while (recent.length > 0 && checkpointBytes(checkpoint) > MAX_CHECKPOINT_BYTES) {
      recent = recent.slice(Math.ceil(recent.length / 2));
      checkpoint = { sequence: this.sequence, recent, eventSequences };
    }
    await this.ctx.storage.put(CHECKPOINT_KEY, checkpoint);
  }
}

function checkpointBytes(value: RealtimeCheckpoint): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function realtimeEventId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const eventId = (value as Record<string, unknown>).eventId;
  return typeof eventId === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(eventId) ? eventId : null;
}

function parseSequence(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function sanitizeTopic(value: string | null): string | null {
  const topic = value?.trim().toLowerCase();
  if (!topic || topic.length > MAX_TOPIC_LENGTH) return null;
  return /^[a-z0-9:._-]+$/.test(topic) ? topic : null;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
