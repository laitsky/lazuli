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
      const [checkpoint, index, recovery] = await Promise.all([
        ctx.storage.get<SequencerCheckpoint>(CHECKPOINT_KEY),
        ctx.storage.get<SequencerEventIndexCheckpoint>(EVENT_INDEX_KEY),
        ctx.storage.get<SequencerRecoveryCheckpoint>(RECOVERY_KEY),
      ]);
      if (!checkpoint) return;
      this.sequence = checkpoint.sequence;
      this.eventSequences.restore(index?.eventSequences ?? []);
      this.recent.push(...(recovery?.recentEvents ?? []).slice(-MAX_RECENT_EVENTS));
      for (const batchId of checkpoint.completedBatchIds ?? []) {
        this.completedBatchIds.add(batchId);
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
    if (this.completedBatchIds.has(input.batchId)) {
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

    const envelopes: CanonicalRealtimeEnvelope[] = [];
    const sequences: number[] = [];
    const eventIdsInBatch = new Set<string>();
    const newEvents: Array<{ eventId: string; envelope: CanonicalRealtimeEnvelope }> = [];
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
      const existing = this.eventSequences.get(eventId);
      const sequence = existing ?? ++nextSequence;
      if (existing !== undefined) duplicateCount += 1;
      const publishedAt = Date.now();
      const canonicalEvent = { ...event, topic, sequence, publishedAt };
      const envelope: CanonicalRealtimeEnvelope = {
        type: 'event',
        topic,
        sequence,
        event: canonicalEvent,
        data: event,
        publishedAt,
      };
      envelopes.push(envelope);
      sequences.push(sequence);
      if (existing === undefined) newEvents.push({ eventId, envelope });
    }

    const encoded = JSON.stringify(createBatchEnvelope(topic, envelopes));
    if (new TextEncoder().encode(encoded).byteLength > MAX_REALTIME_FRAME_BYTES) {
      return Response.json({ error: 'Realtime frame exceeds the bounded size' }, { status: 413 });
    }

    this.sequence = nextSequence;
    this.deduplicatedEvents += duplicateCount;
    for (const { eventId, envelope } of newEvents) {
      this.eventSequences.remember(eventId, envelope.sequence);
      this.rememberRecent(envelope);
    }

    await this.persistCheckpoint();
    const startedAt = Date.now();
    const results = await Promise.allSettled(
      realtimeFanoutNames(topic).map((name) =>
        this.dispatch(name, topic, input.batchId as string, envelopes)
      )
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failures.length > 0) {
      this.partialDispatches += 1;
      this.dispatchRetries += 1;
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
    this.rememberCompletedBatch(input.batchId);
    await this.persistCheckpoint();
    const delivered = results.reduce(
      (sum, result) => (result.status === 'fulfilled' ? sum + result.value.delivered : sum),
      0
    );
    this.env.API_ANALYTICS?.writeDataPoint({
      blobs: ['realtime_leaf_dispatch_ms', topic],
      doubles: [Date.now() - startedAt, envelopes.length],
      indexes: ['realtime_leaf_dispatch_ms'],
    });
    return Response.json({ ok: true, topic, sequences, delivered, timestamp: Date.now() });
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

  private async persistCheckpoint(): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      await Promise.all([
        transaction.put(CHECKPOINT_KEY, {
          sequence: this.sequence,
          completedBatchIds: [...this.completedBatchIds],
        } satisfies SequencerCheckpoint),
        transaction.put(EVENT_INDEX_KEY, {
          eventSequences: this.eventSequences.entries(),
        } satisfies SequencerEventIndexCheckpoint),
        transaction.put(RECOVERY_KEY, {
          recentEvents: this.recent,
        } satisfies SequencerRecoveryCheckpoint),
      ]);
    });
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

function parseSequence(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}
