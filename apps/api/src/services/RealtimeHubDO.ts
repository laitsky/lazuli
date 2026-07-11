import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

interface SocketAttachment {
  topic: string;
  connectedAt: number;
}

const MAX_TOPIC_LENGTH = 120;

export class RealtimeHubV2DO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        connections: this.ctx.getWebSockets().length,
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

      const delivered = this.broadcast(topic, payload);
      return Response.json({ ok: true, topic, delivered, timestamp: Date.now() });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'Expected WebSocket upgrade' }, { status: 426 });
    }

    const topic = sanitizeTopic(url.searchParams.get('topic'));
    if (!topic) return Response.json({ error: 'Missing topic' }, { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = { topic, connectedAt: Date.now() };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [topic]);
    server.send(JSON.stringify({ type: 'subscribed', topic, timestamp: Date.now() }));

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

  private broadcast(topic: string, payload: unknown): number {
    const encoded = JSON.stringify({ topic, data: payload, timestamp: Date.now() });
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets(topic)) {
      try {
        socket.send(encoded);
        delivered += 1;
      } catch {
        socket.close(1011, 'Publish failed');
      }
    }
    return delivered;
  }
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
