import type { RealtimeEvent } from '@lazuli/shared';

import type { BatchHealth, IngestConfig, ProviderHealth } from './types.ts';

const encoder = new TextEncoder();

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
  readonly #queue: RealtimeEvent[] = [];
  readonly #health: BatchHealth = {
    queued: 0,
    dropped: 0,
    batchesSent: 0,
    batchesFailed: 0,
    lastSuccessAt: null,
    lastError: null,
  };
  #timer: ReturnType<typeof setInterval> | null = null;
  #flushing = false;

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
    if (this.#queue.length >= this.config.maxBufferedEvents) {
      this.#queue.shift();
      this.#health.dropped += 1;
    }
    this.#queue.push(event);
    this.#health.queued = this.#queue.length;
    if (this.#queue.length >= this.config.batchSize) void this.flush();
  }

  getHealth(): BatchHealth {
    return { ...this.#health, queued: this.#queue.length };
  }

  async flush(): Promise<void> {
    if (this.#flushing || this.#queue.length === 0) return;
    this.#flushing = true;
    try {
      while (this.#queue.length > 0) {
        const events = this.#queue.splice(0, this.config.batchSize);
        this.#health.queued = this.#queue.length;
        const accepted = await this.sendWithRetry(events);
        if (!accepted) {
          const capacity = Math.max(0, this.config.maxBufferedEvents - this.#queue.length);
          const restored = events.slice(Math.max(0, events.length - capacity));
          this.#queue.unshift(...restored);
          this.#health.dropped += events.length - restored.length;
          break;
        }
      }
    } finally {
      this.#health.queued = this.#queue.length;
      this.#flushing = false;
    }
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
