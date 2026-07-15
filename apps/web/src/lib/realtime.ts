import { useEffect, useRef, useState } from 'react';
import { BoundedEventIds } from './event-dedupe';
import { extractRealtimeLatencySample } from './realtime-latency';

export type RealtimeStatus = 'connecting' | 'open' | 'degraded' | 'closed';

export interface RealtimeEnvelope<T = unknown> {
  type: 'event';
  topic: string;
  sequence: number;
  event?: T & { topic?: string; sequence?: number; publishedAt?: number };
  data: T;
  publishedAt: number;
}

interface RealtimeBatchEnvelope {
  type: 'batch';
  schemaVersion: 1;
  topic: string;
  firstSequence: number;
  lastSequence: number;
  events: RealtimeEnvelope[];
  publishedAt: number;
}

interface TopicSubscription {
  listeners: Set<(event: RealtimeEnvelope) => void>;
  client: TopicClient;
}

const subscriptions = new Map<string, TopicSubscription>();
const MAX_SEEN_EVENT_IDS = 4096;
const LATENCY_REPORT_INTERVAL_MS = 10_000;
const LATENCY_REPORT_SAMPLE_PERCENT = 10;
const latencyReportTimes = new Map<string, number>();
const latencySamplerSeed = crypto.randomUUID();
const REALTIME_V2_PROTOCOL = 'lazuli.realtime.v2';

function realtimeApiOrigin(): URL {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured) return new URL(configured, window.location.origin);
  // Vite's HTTP proxy is useful for REST but does not preserve Worker WebSocket
  // upgrades consistently across local runtimes. Production remains same-origin.
  if (import.meta.env.DEV) return new URL('http://localhost:8787');
  return new URL(window.location.origin);
}

class TopicClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private startTimer: number | null = null;
  private reconnectAttempt = 0;
  private lastSequence = 0;
  private readonly seenEventIds = new BoundedEventIds(MAX_SEEN_EVENT_IDS);
  private stopped = false;
  private preferV2 = true;
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();

  constructor(
    private readonly topic: string,
    private readonly emit: (event: RealtimeEnvelope) => void
  ) {}

  start(): void {
    this.stopped = false;
    this.startTimer = window.setTimeout(() => {
      this.startTimer = null;
      if (!this.stopped) this.connect();
    }, 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.startTimer = null;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, 'No subscribers');
    this.socket = null;
    this.setStatus('closed');
  }

  onStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private connect(): void {
    if (this.stopped || this.socket?.readyState === WebSocket.OPEN) return;
    this.setStatus(this.reconnectAttempt === 0 ? 'connecting' : 'degraded');
    const origin = realtimeApiOrigin();
    const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${origin.host}/api/v1/ws`);
    url.searchParams.set('topic', this.topic);
    const requestedV2 = this.preferV2;
    const socket = requestedV2 ? new WebSocket(url, REALTIME_V2_PROTOCOL) : new WebSocket(url);
    this.socket = socket;
    let opened = false;

    socket.addEventListener('open', () => {
      opened = true;
      this.reconnectAttempt = 0;
      this.setStatus('open');
      if (this.lastSequence > 0) void this.recover(this.lastSequence);
    });
    socket.addEventListener('message', (message) => void this.handleMessage(String(message.data)));
    socket.addEventListener('close', () => {
      if (!opened && requestedV2) this.preferV2 = false;
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      this.setStatus('degraded');
      socket.close();
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (isSubscribedEnvelope(message) && message.topic === this.topic) {
      // The leaf is deliberately stateless about the canonical cursor. Recovery
      // always comes from the per-topic sequencer, never a leaf-local sequence.
      return;
    }
    if (isRealtimeBatchEnvelope(message) && message.topic === this.topic) {
      for (const event of message.events) await this.handleEnvelope(event);
      return;
    }
    if (!isRealtimeEnvelope(message) || message.topic !== this.topic) return;
    await this.handleEnvelope(message);
  }

  private async handleEnvelope(message: RealtimeEnvelope): Promise<void> {
    if (this.lastSequence > 0 && message.sequence > this.lastSequence + 1) {
      await this.recover(this.lastSequence);
    }
    if (message.sequence <= this.lastSequence) return;
    this.lastSequence = message.sequence;
    if (!this.rememberEvent(message)) return;
    reportRealtimeLatency(message);
    this.emit(message);
  }

  private async recover(after: number): Promise<void> {
    try {
      const url = new URL('/api/v1/realtime/snapshot', realtimeApiOrigin());
      url.searchParams.set('topic', this.topic);
      url.searchParams.set('after', String(after));
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const snapshot = (await response.json()) as {
        resetRequired?: boolean;
        events?: RealtimeEnvelope[];
      };
      if (snapshot.resetRequired) {
        this.lastSequence = 0;
        this.setStatus('degraded');
        return;
      }
      for (const event of snapshot.events ?? []) {
        if (isRealtimeEnvelope(event) && event.sequence > this.lastSequence) {
          this.lastSequence = event.sequence;
          if (this.rememberEvent(event)) {
            reportRealtimeLatency(event);
            this.emit(event);
          }
        }
      }
    } catch {
      this.setStatus('degraded');
    }
  }

  private scheduleReconnect(): void {
    this.socket = null;
    if (this.stopped || this.reconnectTimer !== null) return;
    this.setStatus('degraded');
    const base = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt, 6));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(status: RealtimeStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }

  private rememberEvent(envelope: RealtimeEnvelope): boolean {
    const eventId = realtimeEventId(envelope);
    if (!eventId) return true;
    return this.seenEventIds.remember(eventId);
  }
}

export function subscribeRealtime<T>(
  topic: string,
  listener: (event: RealtimeEnvelope<T>) => void
): () => void {
  let subscription = subscriptions.get(topic);
  if (!subscription) {
    const listeners = new Set<(event: RealtimeEnvelope) => void>();
    const client = new TopicClient(topic, (event) =>
      listeners.forEach((current) => current(event))
    );
    subscription = { listeners, client };
    subscriptions.set(topic, subscription);
    client.start();
  }
  const untyped = listener as (event: RealtimeEnvelope) => void;
  subscription.listeners.add(untyped);
  return () => {
    const current = subscriptions.get(topic);
    if (!current) return;
    current.listeners.delete(untyped);
    if (current.listeners.size === 0) {
      current.client.stop();
      subscriptions.delete(topic);
    }
  };
}

export function useRealtimeRefresh(
  topic: string | null,
  refresh: () => void,
  minimumIntervalMs = 250
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('closed');
  const lastRefresh = useRef(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!topic) {
      setStatus('closed');
      return;
    }
    const unsubscribe = subscribeRealtime(topic, () => {
      const now = Date.now();
      if (now - lastRefresh.current < minimumIntervalMs) return;
      lastRefresh.current = now;
      refreshRef.current();
    });
    const subscription = subscriptions.get(topic);
    const unsubscribeStatus = subscription?.client.onStatus(setStatus) ?? (() => undefined);
    return () => {
      unsubscribeStatus();
      unsubscribe();
    };
  }, [minimumIntervalMs, topic]);

  return status;
}

function isRealtimeEnvelope(value: unknown): value is RealtimeEnvelope {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<RealtimeEnvelope>;
  return (
    event.type === 'event' &&
    typeof event.topic === 'string' &&
    typeof event.sequence === 'number' &&
    Number.isSafeInteger(event.sequence) &&
    typeof event.publishedAt === 'number'
  );
}

function isRealtimeBatchEnvelope(value: unknown): value is RealtimeBatchEnvelope {
  if (!value || typeof value !== 'object') return false;
  const batch = value as Partial<RealtimeBatchEnvelope>;
  return (
    batch.type === 'batch' &&
    batch.schemaVersion === 1 &&
    typeof batch.topic === 'string' &&
    Number.isSafeInteger(batch.firstSequence) &&
    Number.isSafeInteger(batch.lastSequence) &&
    Array.isArray(batch.events) &&
    batch.events.length > 0 &&
    batch.events.every(isRealtimeEnvelope) &&
    typeof batch.publishedAt === 'number'
  );
}

function isSubscribedEnvelope(
  value: unknown
): value is { type: 'subscribed'; topic: string; sequence: number } {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; topic?: unknown; sequence?: unknown };
  return (
    message.type === 'subscribed' &&
    typeof message.topic === 'string' &&
    typeof message.sequence === 'number' &&
    Number.isSafeInteger(message.sequence)
  );
}

function realtimeEventId(envelope: RealtimeEnvelope): string | null {
  for (const candidate of [envelope.event, envelope.data]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const eventId = (candidate as Record<string, unknown>).eventId;
    if (typeof eventId === 'string' && eventId.length >= 8) return eventId;
  }
  return null;
}

function reportRealtimeLatency(envelope: RealtimeEnvelope): void {
  const sample = extractRealtimeLatencySample(envelope);
  if (!sample) return;
  if (
    stableSamplePercent(`${latencySamplerSeed}:${sample.eventId}`) >= LATENCY_REPORT_SAMPLE_PERCENT
  )
    return;
  const now = Date.now();
  for (const [segment, value] of [
    ['exchange-to-client', sample.sourceToClientMs],
    ['ingest-to-client', sample.ingestToClientMs],
  ] as const) {
    if (value === null) continue;
    const key = `${sample.provider}:${segment}`;
    const lastReportedAt = latencyReportTimes.get(key) ?? 0;
    if (now - lastReportedAt < LATENCY_REPORT_INTERVAL_MS) continue;
    latencyReportTimes.set(key, now);
    const url = new URL('/api/v1/metrics/events', realtimeApiOrigin());
    void fetch(url, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metric: 'liquidation_latency_ms',
        value,
        dimensions: { provider: sample.provider, segment },
      }),
    }).catch(() => undefined);
  }
}

function stableSamplePercent(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}
