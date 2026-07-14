import type { Env } from '../types';

export type RealtimeBatchClaim = 'claimed' | 'processing' | 'completed';

export async function claimRealtimeIngestBatch(
  env: Env,
  batchId: string
): Promise<RealtimeBatchClaim> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(batchId)) {
    throw new Error('Realtime ingest batch ID is invalid');
  }
  const batchHash = await sha256Hex(batchId);
  const [, claimResult] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM realtime_ingest_batches WHERE expires_at <= unixepoch()`),
    env.DB.prepare(
      `INSERT OR IGNORE INTO realtime_ingest_batches
          (batch_hash, received_at, expires_at, status)
         VALUES (?, unixepoch(), unixepoch() + 60, 'processing')`
    ).bind(batchHash),
  ]);
  if ((claimResult?.meta.changes ?? 0) === 1) return 'claimed';
  const existing = await env.DB.prepare(
    `SELECT status FROM realtime_ingest_batches WHERE batch_hash = ?`
  )
    .bind(batchHash)
    .first<{ status: 'processing' | 'completed' }>();
  return existing?.status ?? 'processing';
}

export async function completeRealtimeIngestBatch(env: Env, batchId: string): Promise<void> {
  await updateBatch(env, batchId, 'complete');
}

export async function releaseRealtimeIngestBatch(env: Env, batchId: string): Promise<void> {
  await updateBatch(env, batchId, 'release');
}

async function updateBatch(
  env: Env,
  batchId: string,
  action: 'complete' | 'release'
): Promise<void> {
  const batchHash = await sha256Hex(batchId);
  if (action === 'complete') {
    await env.DB.prepare(
      `UPDATE realtime_ingest_batches
       SET status = 'completed', completed_at = unixepoch(), expires_at = unixepoch() + 300
       WHERE batch_hash = ? AND status = 'processing'`
    )
      .bind(batchHash)
      .run();
    return;
  }
  await env.DB.prepare(
    `DELETE FROM realtime_ingest_batches WHERE batch_hash = ? AND status = 'processing'`
  )
    .bind(batchHash)
    .run();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
