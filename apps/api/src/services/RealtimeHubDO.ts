import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

interface SocketAttachment {
  topic: string;
  connectedAt: number;
  lastSequence: number;
}

const MAX_TOPIC_LENGTH = 120;
const MAX_SNAPSHOT_EVENTS = 256;
const MAX_BUFFERED_BYTES = 1_048_576;

interface RealtimeEnvelope {
  type: 'event';
  topic: string;
  sequence: number;
  event: Record<string, unknown>;
  /** Backward-compatible alias removed after all pre-v1 clients migrate. */
  data: unknown;
  publishedAt: number;
}

export class RealtimeHubV2DO extends DurableObject<Env> {
  private sequence = 0;
  private readonly recent: RealtimeEnvelope[] = [];

  async fetch(request: Request): Promise<Response> {
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

      const envelope = this.append(topic, payload);
      const delivered = this.broadcast(envelope);
      return Response.json({
        ok: true,
        topic,
        sequence: envelope.sequence,
        delivered,
        timestamp: envelope.publishedAt,
      });
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
