import { describe, expect, test } from 'bun:test';
import type { Env } from '../types';
import {
  claimRealtimeIngestBatch,
  completeRealtimeIngestBatch,
  releaseRealtimeIngestBatch,
} from './realtimeIngestService';

describe('realtime ingest replay protection', () => {
  test('accepts a signed batch nonce once and rejects a replay', async () => {
    const state = new Map<string, 'processing' | 'completed'>();
    const env = {
      DB: {
        prepare(statement: string) {
          return {
            bind(hash: string) {
              return {
                async run() {
                  if (statement.startsWith('DELETE')) return { meta: { changes: 0 } };
                  const duplicate = state.has(hash);
                  if (!duplicate) state.set(hash, 'processing');
                  return { meta: { changes: duplicate ? 0 : 1 } };
                },
                async first() {
                  const status = state.get(hash);
                  return status ? { status } : null;
                },
              };
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
      },
    } as unknown as Env;
    const batchId = '123e4567-e89b-12d3-a456-426614174000';
    expect(await claimRealtimeIngestBatch(env, batchId)).toBe('claimed');
    expect(await claimRealtimeIngestBatch(env, batchId)).toBe('processing');
  });

  test('marks completed batches as terminal and releases failed processing claims', async () => {
    const statements: string[] = [];
    const env = {
      DB: {
        prepare(statement: string) {
          statements.push(statement);
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        },
      },
    } as unknown as Env;
    const batchId = '123e4567-e89b-12d3-a456-426614174000';
    await completeRealtimeIngestBatch(env, batchId);
    await releaseRealtimeIngestBatch(env, batchId);
    expect(statements.some((statement) => statement.includes("status = 'completed'"))).toBe(true);
    expect(
      statements.some((statement) => statement.includes('DELETE FROM realtime_ingest_batches'))
    ).toBe(true);
  });

  test('rejects malformed nonces before touching D1', async () => {
    await expect(claimRealtimeIngestBatch({} as Env, 'not-a-uuid')).rejects.toThrow(
      'batch ID is invalid'
    );
  });
});
