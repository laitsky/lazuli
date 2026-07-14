import type { RealtimeEvent } from '@lazuli/shared';

import type { BatchHealth, IngestConfig, ProviderHealth } from './types.ts';

const encoder = new TextEncoder();
const MAX_BATCH_EVENT_BYTES = 450_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signBatch(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const canonical = `${timestamp}.${body}`;
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical)));
}

export class BatchSink {
  readonly #lanes = new Map<string, { queue: RealtimeEvent[]; flushing: Promise<void> | null }>();
  readonly #health: BatchHealth = {
    queued: 0,
    dropped: 0,
    batchesSent: 0,
    batchesFailed: 0,
    lastSuccessAt: null,
    lastError: null,
  };
  #timer: ReturnType<typeof setInterval> | null = null;
  #queued = 0;

  constructor(
    private readonly config: IngestConfig,
    private readonly providerHealth: () => ProviderHealth[]
  ) {}

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.flush(), this.config.batchIntervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  enqueue(event: RealtimeEvent): void {
    if (this.#queued >= this.config.maxBufferedEvents) {
      this.#health.dropped += 1;
      return;
    }
    const lane = this.#lanes.get(event.topic) ?? { queue: [], flushing: null };
    if (!this.#lanes.has(event.topic)) this.#lanes.set(event.topic, lane);
    lane.queue.push(event);
    this.#queued += 1;
    this.#health.queued = this.#queued;
    if (lane.queue.length >= this.config.batchSize) void this.flushLane(event.topic, lane);
  }

  getHealth(): BatchHealth {
    return { ...this.#health, queued: this.#queued };
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#lanes].map(([topic, lane]) => this.flushLane(topic, lane)));
  }

  private async flushLane(
    topic: string,
    lane: { queue: RealtimeEvent[]; flushing: Promise<void> | null }
  ): Promise<void> {
    if (lane.flushing) return lane.flushing;
    if (lane.queue.length === 0) return;
    const operation = (async () => {
      while (lane.queue.length > 0) {
        const events = this.takeBatch(lane.queue);
        if (events.length === 0) break;
        this.#queued -= events.length;
        this.#health.queued = this.#queued;
        const accepted = await this.sendWithRetry(events);
        if (!accepted) {
          const capacity = Math.max(0, this.config.maxBufferedEvents - this.#queued);
          const restored = events.slice(0, capacity);
          lane.queue.unshift(...restored);
          this.#queued += restored.length;
          this.#health.dropped += events.length - restored.length;
          break;
        }
      }
    })().finally(() => {
      this.#health.queued = this.#queued;
      lane.flushing = null;
      if (lane.queue.length === 0 && this.#lanes.get(topic) === lane) {
        this.#lanes.delete(topic);
      }
    });
    lane.flushing = operation;
    return operation;
  }

  private takeBatch(queue: RealtimeEvent[]): RealtimeEvent[] {
    const events: RealtimeEvent[] = [];
    let bytes = 0;
    while (events.length < this.config.batchSize && queue.length > 0) {
      const next = queue[0];
      if (!next) break;
      const eventBytes = encoder.encode(JSON.stringify(next)).byteLength + 1;
      if (events.length > 0 && bytes + eventBytes > MAX_BATCH_EVENT_BYTES) break;
      queue.shift();
      if (eventBytes > MAX_BATCH_EVENT_BYTES) {
        this.#health.dropped += 1;
        this.#queued -= 1;
        continue;
      }
      events.push(next);
      bytes += eventBytes;
    }
    return events;
  }

  private async sendWithRetry(events: RealtimeEvent[]): Promise<boolean> {
    const batchId = crypto.randomUUID();
    const sentAt = Date.now();
    const body = JSON.stringify({
      schemaVersion: 1,
      batchId,
      sentAt,
      events,
      providers: this.providerHealth(),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const signature = await signBatch(this.config.signingSecret, sentAt, body);
        const response = await fetch(`${this.config.apiBaseUrl}/internal/realtime/batch`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'lazuli-ingest/1',
            'x-lazuli-timestamp': String(sentAt),
            'x-lazuli-ingest-batch-id': batchId,
            'x-lazuli-key-id': this.config.signingKeyId,
            'x-lazuli-signature': `sha256=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) {
          this.#health.batchesSent += 1;
          this.#health.lastSuccessAt = Date.now();
          this.#health.lastError = null;
          return true;
        }
        const responseBody = (await response.text()).slice(0, 256);
        throw new Error(`ingest API returned ${response.status}: ${responseBody}`);
      } catch (error) {
        this.#health.lastError = error instanceof Error ? error.message : String(error);
        if (attempt < 3) await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 250));
      }
    }

    this.#health.batchesFailed += 1;
    return false;
  }
}
