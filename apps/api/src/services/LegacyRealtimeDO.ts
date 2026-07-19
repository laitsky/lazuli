import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

/**
 * Compatibility exports for Durable Object namespaces created by the staged
 * realtime-batched-fanout-v2 migration. Current main no longer binds these
 * namespaces, but Cloudflare requires their classes to remain exported until a
 * deliberate data-retention/deletion migration is approved.
 */
class LegacyRealtimeCompatibilityDO extends DurableObject<Env> {
  fetch(): Response {
    return Response.json(
      {
        error: 'Legacy realtime Durable Object is not bound by the current release',
        retained: true,
      },
      { status: 410 }
    );
  }
}

export class RealtimeSequencerV1DO extends LegacyRealtimeCompatibilityDO {}

export class RealtimeFanoutV3DO extends LegacyRealtimeCompatibilityDO {}
