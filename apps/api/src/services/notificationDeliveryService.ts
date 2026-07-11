import type { AlertDeliveryQueueMessage, Env } from '../types';
import { sendAlertEmail } from './emailDeliveryService';
import { createSecretRing, signWithCurrentSecret } from '../utils/rotatingSecrets';

const ENCRYPTION_VERSION = 2;
const LEGACY_ENCRYPTION_VERSION = 1;
const MAX_DELIVERY_ATTEMPTS = 6;
const DELIVERY_TIMEOUT_MS = 8_000;
const RETRY_BASE_SECONDS = 5;
const RETRY_MAX_SECONDS = 15 * 60;

export type NotificationChannelKind = 'email' | 'discord' | 'telegram' | 'webhook';

export interface NotificationChannelRecord {
  id: string;
  kind: NotificationChannelKind;
  label: string;
  endpointMasked: string;
  config: Record<string, string | number | boolean>;
  enabled: boolean;
  verifiedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationChannelInput {
  kind: NotificationChannelKind;
  label: string;
  endpoint: string;
  secret?: string | null;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface NotificationDeliveryAttemptRecord {
  id: string;
  alertEventId: string;
  channelId: string;
  channelKind: NotificationChannelKind;
  channelLabel: string;
  status: 'queued' | 'processing' | 'retry' | 'delivered' | 'failed' | 'dead_letter';
  attemptNumber: number;
  provider: string | null;
  responseStatus: number | null;
  lastError: string | null;
  queuedAt: number;
  attemptedAt: number | null;
  deliveredAt: number | null;
  nextAttemptAt: number | null;
}

interface ChannelRow {
  id: string;
  user_id: string;
  kind: NotificationChannelKind;
  label: string;
  endpoint_ciphertext: string;
  secret_ciphertext: string | null;
  config_json: string;
  enabled: number;
  verified_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

type NotificationEncryptionEnv = Pick<Env, 'NOTIFICATION_ENCRYPTION_KEY'> & {
  NOTIFICATION_ENCRYPTION_KEY_ID?: string;
  NOTIFICATION_ENCRYPTION_KEY_NEXT?: string;
  NOTIFICATION_ENCRYPTION_KEY_NEXT_ID?: string;
};

interface EncryptionKeyVersion {
  keyId: string;
  secret: string;
}

export interface NotificationReencryptionResult {
  processed: number;
  updated: number;
  nextCursor: string | null;
  done: boolean;
  targetKeyId: string;
}

interface AttemptRow {
  id: string;
  alert_event_id: string;
  channel_id: string;
  idempotency_key: string;
  status: NotificationDeliveryAttemptRecord['status'];
  attempt_number: number;
  provider: string | null;
  response_status: number | null;
  last_error: string | null;
  queued_at: number;
  attempted_at: number | null;
  delivered_at: number | null;
  next_attempt_at: number | null;
  channel_kind: NotificationChannelKind;
  channel_label: string;
  endpoint_ciphertext: string;
  secret_ciphertext: string | null;
  config_json: string;
  payload_json: string;
  symbol: string;
  exchange: string;
  trigger_price: number;
  target_price: number;
  condition: 'above' | 'below';
  user_id: string;
}

export class RetryableAlertDeliveryError extends Error {}

export async function listNotificationChannels(
  env: Env,
  userId: string
): Promise<NotificationChannelRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM notification_channels WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
  )
    .bind(userId)
    .all<ChannelRow>();
  return Promise.all(results.map((row) => publicChannel(env, row)));
}

/**
 * Re-encrypt a bounded, cursor-addressed channel batch with the staged next key.
 * Operators must run batches to completion before promoting NEXT to current.
 */
export async function reencryptNotificationChannels(
  env: Env,
  options: { limit?: number; cursor?: string | null } = {}
): Promise<NotificationReencryptionResult> {
  const keys = notificationEncryptionKeys(env);
  if (!keys.next) throw new Error('A staged notification encryption key is required');
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const cursor = options.cursor ?? '';
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, endpoint_ciphertext, secret_ciphertext
     FROM notification_channels WHERE id > ? ORDER BY id ASC LIMIT ?`
  )
    .bind(cursor, limit)
    .all<Pick<ChannelRow, 'id' | 'user_id' | 'endpoint_ciphertext' | 'secret_ciphertext'>>();

  const statements: D1PreparedStatement[] = [];
  for (const row of results) {
    const endpointAad = channelAad(row.user_id, row.id, 'endpoint');
    const secretAad = channelAad(row.user_id, row.id, 'secret');
    const endpointAlreadyRotated = ciphertextKeyId(row.endpoint_ciphertext) === keys.next.keyId;
    const secretAlreadyRotated =
      row.secret_ciphertext === null || ciphertextKeyId(row.secret_ciphertext) === keys.next.keyId;
    if (endpointAlreadyRotated && secretAlreadyRotated) continue;

    const endpoint = await decryptNotificationValue(env, row.endpoint_ciphertext, endpointAad);
    const secret = row.secret_ciphertext
      ? await decryptNotificationValue(env, row.secret_ciphertext, secretAad)
      : null;
    statements.push(
      env.DB.prepare(
        `UPDATE notification_channels
         SET endpoint_ciphertext = ?, secret_ciphertext = ?, updated_at = unixepoch()
         WHERE id = ? AND user_id = ?`
      ).bind(
        await encryptNotificationValue(env, endpoint, endpointAad, 'next'),
        secret ? await encryptNotificationValue(env, secret, secretAad, 'next') : null,
        row.id,
        row.user_id
      )
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
  const nextCursor = results.at(-1)?.id ?? null;
  return {
    processed: results.length,
    updated: statements.length,
    nextCursor,
    done: results.length < limit,
    targetKeyId: keys.next.keyId,
  };
}

export async function createNotificationChannel(
  env: Env,
  userId: string,
  input: NotificationChannelInput
): Promise<NotificationChannelRecord> {
  const id = `nch_${crypto.randomUUID()}`;
  const normalized = normalizeChannelInput(input);
  await assertAccountEmailChannel(env, userId, normalized.kind, normalized.endpoint);
  const endpointCiphertext = await encryptNotificationValue(
    env,
    normalized.endpoint,
    channelAad(userId, id, 'endpoint')
  );
  const secretCiphertext = normalized.secret
    ? await encryptNotificationValue(env, normalized.secret, channelAad(userId, id, 'secret'))
    : null;
  await env.DB.prepare(
    `INSERT INTO notification_channels
      (id, user_id, kind, label, endpoint_ciphertext, secret_ciphertext, config_json, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      userId,
      normalized.kind,
      normalized.label,
      endpointCiphertext,
      secretCiphertext,
      JSON.stringify(normalized.config),
      normalized.enabled ? 1 : 0
    )
    .run();
  const row = await getOwnedChannel(env, userId, id);
  if (!row) throw new Error('Notification channel was not persisted');
  return publicChannel(env, row);
}

export async function updateNotificationChannel(
  env: Env,
  userId: string,
  channelId: string,
  patch: Partial<NotificationChannelInput>
): Promise<NotificationChannelRecord | null> {
  const current = await getOwnedChannel(env, userId, channelId);
  if (!current) return null;
  const currentEndpoint = await decryptNotificationValue(
    env,
    current.endpoint_ciphertext,
    channelAad(userId, channelId, 'endpoint')
  );
  const currentSecret = current.secret_ciphertext
    ? await decryptNotificationValue(
        env,
        current.secret_ciphertext,
        channelAad(userId, channelId, 'secret')
      )
    : null;
  const normalized = normalizeChannelInput({
    kind: patch.kind ?? current.kind,
    label: patch.label ?? current.label,
    endpoint: patch.endpoint ?? currentEndpoint,
    secret: patch.secret === undefined ? currentSecret : patch.secret,
    config: patch.config ?? parseSafeConfig(current.config_json),
    enabled: patch.enabled ?? current.enabled === 1,
  });
  await assertAccountEmailChannel(env, userId, normalized.kind, normalized.endpoint);
  const endpointCiphertext = await encryptNotificationValue(
    env,
    normalized.endpoint,
    channelAad(userId, channelId, 'endpoint')
  );
  const secretCiphertext = normalized.secret
    ? await encryptNotificationValue(
        env,
        normalized.secret,
        channelAad(userId, channelId, 'secret')
      )
    : null;
  await env.DB.prepare(
    `UPDATE notification_channels
     SET kind = ?, label = ?, endpoint_ciphertext = ?, secret_ciphertext = ?, config_json = ?,
         enabled = ?, last_error = NULL, updated_at = unixepoch()
     WHERE id = ? AND user_id = ?`
  )
    .bind(
      normalized.kind,
      normalized.label,
      endpointCiphertext,
      secretCiphertext,
      JSON.stringify(normalized.config),
      normalized.enabled ? 1 : 0,
      channelId,
      userId
    )
    .run();
  const updated = await getOwnedChannel(env, userId, channelId);
  if (!updated) throw new Error('Notification channel disappeared during update');
  return publicChannel(env, updated);
}

/** Audit history must survive channel removal, so deletion is an intentional soft delete. */
export async function deleteNotificationChannel(
  env: Env,
  userId: string,
  channelId: string
): Promise<{ deleted: boolean }> {
  const result = await env.DB.prepare(
    `UPDATE notification_channels SET enabled = 0, updated_at = unixepoch()
     WHERE id = ? AND user_id = ? AND enabled = 1`
  )
    .bind(channelId, userId)
    .run();
  return { deleted: (result.meta.changes ?? 0) > 0 };
}

export async function listNotificationDeliveryAttempts(
  env: Env,
  userId: string,
  limit = 100
): Promise<NotificationDeliveryAttemptRecord[]> {
  const boundedLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const { results } = await env.DB.prepare(
    `SELECT a.*, c.kind AS channel_kind, c.label AS channel_label
     FROM notification_delivery_attempts a
     JOIN notification_channels c ON c.id = a.channel_id
     JOIN alert_events e ON e.id = a.alert_event_id
     WHERE e.user_id = ? AND c.user_id = ?
     ORDER BY a.created_at DESC LIMIT ?`
  )
    .bind(userId, userId, boundedLimit)
    .all<AttemptRow>();
  return results.map(mapAttempt);
}

export async function retryNotificationDelivery(
  env: Env,
  userId: string,
  attemptId: string
): Promise<{ retried: boolean }> {
  if (!env.ALERT_DELIVERY_QUEUE) return { retried: false };
  const result = await env.DB.prepare(
    `UPDATE notification_delivery_attempts
     SET status = 'queued', attempt_number = 0, response_status = NULL, last_error = NULL,
         next_attempt_at = NULL, queued_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND status IN ('failed', 'dead_letter')
       AND COALESCE(last_error, '') NOT LIKE 'Indeterminate provider acceptance;%'
       AND EXISTS (
         SELECT 1 FROM alert_events e
         JOIN notification_channels c ON c.id = notification_delivery_attempts.channel_id
         WHERE e.id = notification_delivery_attempts.alert_event_id
           AND e.user_id = ? AND c.user_id = ? AND c.enabled = 1
       )`
  )
    .bind(attemptId, userId, userId)
    .run();
  if ((result.meta.changes ?? 0) < 1) return { retried: false };
  await env.ALERT_DELIVERY_QUEUE.send({ kind: 'alert-delivery', attemptId });
  return { retried: true };
}

export async function enqueueAlertDeliveries(
  env: Env,
  alertEventId: string,
  userId: string,
  requestedChannelIds: string[] = []
): Promise<number> {
  if (!env.ALERT_DELIVERY_QUEUE) return 0;
  const uniqueIds = Array.from(new Set(requestedChannelIds.filter(validId))).slice(0, 20);
  if (uniqueIds.length === 0) return 0;
  const query = `SELECT * FROM notification_channels
       WHERE user_id = ? AND enabled = 1 AND id IN (${uniqueIds.map(() => '?').join(',')})`;
  const { results: channels } = await env.DB.prepare(query)
    .bind(userId, ...uniqueIds)
    .all<ChannelRow>();
  let queued = 0;
  for (const channel of channels) {
    const attemptId = `nda_${crypto.randomUUID()}`;
    const idempotencyKey = alertDeliveryIdempotencyKey(alertEventId, channel.id);
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_delivery_attempts
        (id, alert_event_id, channel_id, idempotency_key, status, queued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', unixepoch(), unixepoch(), unixepoch())`
    )
      .bind(attemptId, alertEventId, channel.id, idempotencyKey)
      .run();
    if ((result.meta.changes ?? 0) < 1) continue;
    await env.ALERT_DELIVERY_QUEUE.send({ kind: 'alert-delivery', attemptId });
    queued += 1;
  }
  return queued;
}

/**
 * Converts the legacy per-alert delivery object into encrypted, user-owned
 * channels. The returned value is safe to persist in price_alerts.delivery_json:
 * it contains references only, never endpoints or provider credentials.
 */
export async function normalizeAlertDeliveryReferences(
  env: Env,
  userId: string,
  delivery: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  if (!delivery) return { channels: ['realtime'], channelIds: [] };
  const existingIds = Array.isArray(delivery.channelIds)
    ? delivery.channelIds.filter(
        (value): value is string => typeof value === 'string' && validId(value)
      )
    : [];
  if (
    existingIds.length > 0 ||
    Object.keys(delivery).every((key) =>
      ['channels', 'channelIds', 'locale', 'timezone'].includes(key)
    )
  ) {
    const uniqueIds = Array.from(new Set(existingIds)).slice(0, 20);
    let ownedIds: string[] = [];
    if (uniqueIds.length > 0) {
      const { results } = await env.DB.prepare(
        `SELECT id FROM notification_channels WHERE user_id = ? AND enabled = 1
         AND id IN (${uniqueIds.map(() => '?').join(',')})`
      )
        .bind(userId, ...uniqueIds)
        .all<{ id: string }>();
      ownedIds = results.map(({ id }) => id);
    }
    return {
      channels: sanitizeDeliveryChannelNames(delivery.channels),
      channelIds: ownedIds,
    };
  }

  const created: NotificationChannelRecord[] = [];
  const emailValue =
    deliveryString(delivery.email) ?? deliveryString(deliveryRecord(delivery.email)?.to);
  if (emailValue) {
    created.push(
      await createNotificationChannel(env, userId, {
        kind: 'email',
        label: 'Alert email',
        endpoint: emailValue,
      })
    );
  }
  const discordValue =
    deliveryString(delivery.discord) ?? deliveryString(deliveryRecord(delivery.discord)?.url);
  if (discordValue) {
    created.push(
      await createNotificationChannel(env, userId, {
        kind: 'discord',
        label: 'Alert Discord',
        endpoint: discordValue,
      })
    );
  }
  const telegram = deliveryRecord(delivery.telegram);
  const telegramValue =
    deliveryString(delivery.telegram) ??
    deliveryString(telegram?.chatId) ??
    deliveryString(telegram?.chat_id);
  if (telegramValue) {
    created.push(
      await createNotificationChannel(env, userId, {
        kind: 'telegram',
        label: 'Alert Telegram',
        endpoint: telegramValue,
      })
    );
  }
  const webhook = deliveryRecord(delivery.webhook);
  const webhookValue = deliveryString(delivery.webhook) ?? deliveryString(webhook?.url);
  if (webhookValue) {
    created.push(
      await createNotificationChannel(env, userId, {
        kind: 'webhook',
        label: 'Alert webhook',
        endpoint: webhookValue,
        secret: deliveryString(webhook?.secret),
      })
    );
  }
  return {
    channels: ['realtime', ...created.map((channel) => channel.kind)],
    channelIds: created.map((channel) => channel.id),
  };
}

export function notificationChannelIds(delivery: Record<string, unknown> | null): string[] {
  return Array.isArray(delivery?.channelIds)
    ? Array.from(
        new Set(
          delivery.channelIds.filter(
            (value): value is string => typeof value === 'string' && validId(value)
          )
        )
      ).slice(0, 20)
    : [];
}

export async function reconcilePendingAlertDeliveries(env: Env, limit = 100): Promise<number> {
  const queue = env.ALERT_DELIVERY_QUEUE;
  if (!queue) return 0;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE notification_delivery_attempts
       SET status = 'dead_letter', next_attempt_at = NULL,
           last_error = 'Indeterminate provider acceptance; automatic replay suppressed',
           updated_at = unixepoch()
       WHERE status = 'processing' AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= unixepoch()
         AND EXISTS (
           SELECT 1 FROM notification_channels c
           WHERE c.id = notification_delivery_attempts.channel_id AND c.kind != 'webhook'
         )`
    ),
    env.DB.prepare(
      `UPDATE notification_delivery_attempts
     SET status = 'retry', updated_at = unixepoch()
       WHERE status = 'processing' AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= unixepoch()
         AND EXISTS (
           SELECT 1 FROM notification_channels c
           WHERE c.id = notification_delivery_attempts.channel_id AND c.kind = 'webhook'
         )`
    ),
  ]);
  const { results } = await env.DB.prepare(
    `SELECT id FROM notification_delivery_attempts
     WHERE status IN ('queued', 'retry') AND COALESCE(next_attempt_at, 0) <= unixepoch()
     ORDER BY queued_at ASC LIMIT ?`
  )
    .bind(Math.max(1, Math.min(250, Math.floor(limit))))
    .all<{ id: string }>();
  await Promise.all(results.map(({ id }) => queue.send({ kind: 'alert-delivery', attemptId: id })));
  return results.length;
}

export async function processAlertDeliveryMessage(
  env: Env,
  message: AlertDeliveryQueueMessage
): Promise<void> {
  const row = await loadAttempt(env, message.attemptId);
  if (
    !row ||
    row.status === 'delivered' ||
    row.status === 'failed' ||
    row.status === 'dead_letter'
  ) {
    return;
  }
  if (row.next_attempt_at && row.next_attempt_at > Math.floor(Date.now() / 1000)) {
    throw new RetryableAlertDeliveryError('Delivery retry is not due yet');
  }
  const claim = await env.DB.prepare(
    `UPDATE notification_delivery_attempts
     SET status = 'processing', attempt_number = attempt_number + 1, attempted_at = unixepoch(),
         next_attempt_at = unixepoch() + 60, updated_at = unixepoch()
     WHERE id = ? AND status IN ('queued', 'retry') AND attempt_number < ?`
  )
    .bind(row.id, MAX_DELIVERY_ATTEMPTS)
    .run();
  if ((claim.meta.changes ?? 0) < 1) return;

  const attemptNumber = row.attempt_number + 1;
  try {
    const result = await dispatchDelivery(env, row);
    if (result.ok) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE notification_delivery_attempts
           SET status = 'delivered', provider = ?, response_status = ?, delivered_at = unixepoch(),
               next_attempt_at = NULL, last_error = NULL, updated_at = unixepoch() WHERE id = ?`
        ).bind(result.provider, result.status, row.id),
        env.DB.prepare(
          `UPDATE notification_channels SET last_error = NULL, verified_at = COALESCE(verified_at, unixepoch())
           WHERE id = ?`
        ).bind(row.channel_id),
      ]);
      return;
    }
    // Only signed user webhooks have an enforceable receiver-side
    // Idempotency-Key contract. Email, Discord, and Telegram are at-most-once
    // after dispatch begins because their providers cannot dedupe a replay.
    const retryable = canAutomaticallyRetryDelivery(row.channel_kind, result.status);
    const terminal = !retryable;
    await recordDeliveryFailure(
      env,
      row,
      attemptNumber,
      terminal,
      result.provider,
      result.status,
      `Provider returned HTTP ${result.status}`
    );
    if (!terminal) throw new RetryableAlertDeliveryError(`Retryable HTTP ${result.status}`);
  } catch (error) {
    if (error instanceof RetryableAlertDeliveryError) throw error;
    const messageText = redactDeliveryError(error);
    if (row.channel_kind !== 'webhook') {
      await markIndeterminateDelivery(env, row, messageText);
      return;
    }
    await recordDeliveryFailure(
      env,
      row,
      attemptNumber,
      false,
      row.channel_kind,
      null,
      messageText
    );
    throw new RetryableAlertDeliveryError(messageText);
  }
}

async function markIndeterminateDelivery(env: Env, row: AttemptRow, error: string): Promise<void> {
  const safeError = `Indeterminate provider acceptance; automatic replay suppressed: ${redactDeliveryError(error)}`;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE notification_delivery_attempts
       SET status = 'dead_letter', next_attempt_at = NULL, last_error = ?, updated_at = unixepoch()
       WHERE id = ?`
    ).bind(safeError, row.id),
    env.DB.prepare(`UPDATE notification_channels SET last_error = ? WHERE id = ?`).bind(
      safeError,
      row.channel_id
    ),
  ]);
}

export async function markDeliveryDeadLetter(env: Env, attemptId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_delivery_attempts
     SET status = 'dead_letter', next_attempt_at = NULL, updated_at = unixepoch()
     WHERE id = ? AND status <> 'delivered'`
  )
    .bind(attemptId)
    .run();
}

export function alertDeliveryRetryDelaySeconds(attempt: number): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(attempt) - 1));
  const deterministicJitter = ((Math.max(1, attempt) * 17) % 31) / 100;
  return Math.min(
    RETRY_MAX_SECONDS,
    Math.ceil(RETRY_BASE_SECONDS * 2 ** exponent * (1 + deterministicJitter))
  );
}

export function canAutomaticallyRetryDelivery(
  kind: NotificationChannelKind,
  status: number
): boolean {
  return kind === 'webhook' && (status >= 500 || status === 408 || status === 429);
}

export function alertDeliveryIdempotencyKey(alertEventId: string, channelId: string): string {
  return `alert:${alertEventId}:channel:${channelId}:v1`;
}

export function isSafePublicHttpsUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return false;
    }
    if (host.endsWith('.internal') || host === 'metadata.google.internal') return false;
    if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd'))
      return false;
    if (/^fe[89ab]/i.test(host) || host.startsWith('::ffff:')) return false;
    const octets = host.split('.').map(Number);
    if (
      octets.length === 4 &&
      octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      const [a, b] = octets as [number, number, number, number];
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19))
      ) {
        return false;
      }
    }
    return host.includes('.');
  } catch {
    return false;
  }
}

export async function encryptNotificationValue(
  env: NotificationEncryptionEnv,
  plaintext: string,
  aad: string,
  target: 'current' | 'next' = 'current'
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keys = notificationEncryptionKeys(env);
  const selected = target === 'next' ? keys.next : keys.current;
  if (!selected) throw new Error('A staged notification encryption key is required');
  const key = await importNotificationEncryptionKey(selected.secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({
    v: ENCRYPTION_VERSION,
    kid: selected.keyId,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(encrypted)),
  });
}

export async function decryptNotificationValue(
  env: NotificationEncryptionEnv,
  ciphertext: string,
  aad: string
): Promise<string> {
  const parsed = JSON.parse(ciphertext) as {
    v?: unknown;
    kid?: unknown;
    iv?: unknown;
    data?: unknown;
  };
  if (
    (parsed.v !== ENCRYPTION_VERSION && parsed.v !== LEGACY_ENCRYPTION_VERSION) ||
    (parsed.v === ENCRYPTION_VERSION && typeof parsed.kid !== 'string') ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.data !== 'string'
  ) {
    throw new Error('Unsupported notification ciphertext');
  }
  const keys = notificationEncryptionKeys(env);
  const candidates = [keys.current, keys.next].filter(
    (candidate): candidate is EncryptionKeyVersion =>
      candidate !== undefined &&
      (parsed.v === LEGACY_ENCRYPTION_VERSION || candidate.keyId === parsed.kid)
  );
  for (const candidate of candidates) {
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64UrlToBytes(parsed.iv),
          additionalData: new TextEncoder().encode(aad),
          tagLength: 128,
        },
        await importNotificationEncryptionKey(candidate.secret),
        base64UrlToBytes(parsed.data)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      // Try the other configured key for legacy ciphertext without a key id.
    }
  }
  throw new Error('Notification ciphertext could not be decrypted with configured keys');
}

async function dispatchDelivery(
  env: Env,
  row: AttemptRow
): Promise<{ ok: boolean; status: number; provider: string }> {
  const endpoint = await decryptNotificationValue(
    env,
    row.endpoint_ciphertext,
    channelAad(row.user_id, row.channel_id, 'endpoint')
  );
  const channelSecret = row.secret_ciphertext
    ? await decryptNotificationValue(
        env,
        row.secret_ciphertext,
        channelAad(row.user_id, row.channel_id, 'secret')
      )
    : null;
  const payload = safeJsonRecord(row.payload_json);
  const text = `Lazuli price alert: ${row.symbol} on ${row.exchange.toUpperCase()} is ${formatNumber(row.trigger_price)}, ${row.condition} target ${formatNumber(row.target_price)}.`;
  let url: string;
  let body: Record<string, unknown>;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': row.idempotency_key,
    'X-Lazuli-Delivery': row.id,
  };
  switch (row.channel_kind) {
    case 'email': {
      const result = await sendAlertEmail(env, {
        to: endpoint,
        subject: `Lazuli alert: ${row.symbol}`,
        text,
        payload,
        idempotencyKey: row.idempotency_key,
      });
      if (!result) throw new Error('Email delivery provider is unavailable');
      return result;
    }
    case 'discord':
      if (!isDiscordWebhook(endpoint)) throw new Error('Discord endpoint is invalid');
      url = endpoint;
      body = { content: text, allowed_mentions: { parse: [] } };
      break;
    case 'telegram':
      if (!env.ALERT_TELEGRAM_BOT_TOKEN)
        throw new Error('Telegram delivery provider is unavailable');
      url = `https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`;
      body = { chat_id: endpoint, text, disable_web_page_preview: true };
      break;
    case 'webhook': {
      if (env.ALERT_USER_WEBHOOKS_ENABLED !== 'true' || !isSafePublicHttpsUrl(endpoint)) {
        throw new Error('Webhook endpoint is not allowed');
      }
      url = endpoint;
      const timestamp = Date.now().toString();
      body = {
        kind: 'price-alert-triggered',
        eventId: row.alert_event_id,
        payload,
        timestamp: Number(timestamp),
      };
      const raw = JSON.stringify(body);
      const signingSecret = channelSecret ?? env.ALERT_WEBHOOK_SIGNING_SECRET;
      headers['X-Lazuli-Event'] = 'price-alert.triggered';
      headers['X-Lazuli-Timestamp'] = timestamp;
      if (signingSecret) {
        if (channelSecret) {
          headers['X-Lazuli-Key-Id'] = 'channel';
          headers['X-Lazuli-Signature'] =
            `sha256=${await hmacHex(channelSecret, `${timestamp}.${raw}`)}`;
        } else {
          const rotationEnv = env as Env & {
            ALERT_WEBHOOK_SIGNING_SECRET_ID?: string;
            ALERT_WEBHOOK_SIGNING_SECRET_NEXT?: string;
            ALERT_WEBHOOK_SIGNING_SECRET_NEXT_ID?: string;
          };
          const signed = await signWithCurrentSecret(
            createSecretRing({
              currentKeyId: rotationEnv.ALERT_WEBHOOK_SIGNING_SECRET_ID ?? 'current',
              currentSecret: signingSecret,
              nextKeyId: rotationEnv.ALERT_WEBHOOK_SIGNING_SECRET_NEXT_ID,
              nextSecret: rotationEnv.ALERT_WEBHOOK_SIGNING_SECRET_NEXT,
              label: 'Alert webhook signing',
            }),
            `${timestamp}.${raw}`
          );
          headers['X-Lazuli-Key-Id'] = signed.keyId;
          headers['X-Lazuli-Signature'] = signed.signature;
        }
      }
      return fetchDelivery(url, raw, headers, 'webhook');
    }
  }
  return fetchDelivery(url, JSON.stringify(body), headers, row.channel_kind);
}

async function fetchDelivery(
  url: string,
  body: string,
  headers: Record<string, string>,
  provider: string
): Promise<{ ok: boolean; status: number; provider: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  return { ok: response.ok, status: response.status, provider };
}

async function recordDeliveryFailure(
  env: Env,
  row: AttemptRow,
  attemptNumber: number,
  terminal: boolean,
  provider: string,
  status: number | null,
  error: string
): Promise<void> {
  const exhausted = attemptNumber >= MAX_DELIVERY_ATTEMPTS;
  const state = terminal || exhausted ? 'failed' : 'retry';
  const nextAttempt =
    state === 'retry'
      ? Math.floor(Date.now() / 1000) + alertDeliveryRetryDelaySeconds(attemptNumber)
      : null;
  const safeError = redactDeliveryError(error);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE notification_delivery_attempts
       SET status = ?, provider = ?, response_status = ?, last_error = ?, next_attempt_at = ?,
           updated_at = unixepoch() WHERE id = ?`
    ).bind(state, provider, status, safeError, nextAttempt, row.id),
    env.DB.prepare(`UPDATE notification_channels SET last_error = ? WHERE id = ?`).bind(
      safeError,
      row.channel_id
    ),
  ]);
}

async function loadAttempt(env: Env, id: string): Promise<AttemptRow | null> {
  return env.DB.prepare(
    `SELECT a.*, c.kind AS channel_kind, c.label AS channel_label, c.endpoint_ciphertext,
            c.secret_ciphertext, c.config_json, c.user_id, e.payload_json, e.symbol, e.exchange,
            e.trigger_price, e.target_price, e.condition
     FROM notification_delivery_attempts a
     JOIN notification_channels c ON c.id = a.channel_id AND c.enabled = 1
     JOIN alert_events e ON e.id = a.alert_event_id AND e.user_id = c.user_id
     WHERE a.id = ?`
  )
    .bind(id)
    .first<AttemptRow>();
}

async function getOwnedChannel(env: Env, userId: string, id: string): Promise<ChannelRow | null> {
  return env.DB.prepare(`SELECT * FROM notification_channels WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<ChannelRow>();
}

async function assertAccountEmailChannel(
  env: Env,
  userId: string,
  kind: NotificationChannelKind,
  endpoint: string
): Promise<void> {
  if (kind !== 'email') return;
  const user = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string }>();
  if (!user || user.email.trim().toLowerCase() !== endpoint.trim().toLowerCase()) {
    throw new Error('Email channels must use the authenticated account email');
  }
}

async function publicChannel(env: Env, row: ChannelRow): Promise<NotificationChannelRecord> {
  const endpoint = await decryptNotificationValue(
    env,
    row.endpoint_ciphertext,
    channelAad(row.user_id, row.id, 'endpoint')
  );
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    endpointMasked: maskEndpoint(row.kind, endpoint),
    config: parseSafeConfig(row.config_json),
    enabled: row.enabled === 1,
    verifiedAt: toMillis(row.verified_at),
    lastError: row.last_error,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function normalizeChannelInput(
  input: NotificationChannelInput
): Required<NotificationChannelInput> {
  if (!['email', 'discord', 'telegram', 'webhook'].includes(input.kind)) {
    throw new Error('Unsupported notification channel kind');
  }
  const label = input.label.trim();
  if (!label || label.length > 80) throw new Error('Channel label must contain 1-80 characters');
  const endpoint = input.endpoint.trim();
  if (!isValidEndpoint(input.kind, endpoint)) throw new Error(`Invalid ${input.kind} endpoint`);
  const secret = input.secret?.trim() || null;
  if (secret && secret.length > 512) throw new Error('Channel secret is too long');
  return {
    kind: input.kind,
    label,
    endpoint,
    secret,
    config: sanitizeConfig(input.config ?? {}),
    enabled: input.enabled ?? true,
  };
}

function isValidEndpoint(kind: NotificationChannelKind, endpoint: string): boolean {
  if (endpoint.length < 1 || endpoint.length > 2_048) return false;
  if (kind === 'email')
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(endpoint) && endpoint.length <= 254;
  if (kind === 'telegram')
    return /^-?[0-9]{1,20}$/.test(endpoint) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(endpoint);
  if (kind === 'discord') return isDiscordWebhook(endpoint);
  return isSafePublicHttpsUrl(endpoint);
}

function isDiscordWebhook(endpoint: string): boolean {
  if (!isSafePublicHttpsUrl(endpoint)) return false;
  const url = new URL(endpoint);
  return (
    ['discord.com', 'discordapp.com'].includes(url.hostname.toLowerCase()) &&
    /^\/api\/webhooks\/[^/]+\/[^/]+/.test(url.pathname)
  );
}

function sanitizeConfig(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key) || /secret|token|password|auth|key/i.test(key)) {
      continue;
    }
    if (typeof value === 'string' && value.length <= 256) output[key] = value;
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    if (typeof value === 'boolean') output[key] = value;
  }
  return output;
}

function parseSafeConfig(value: string): Record<string, string | number | boolean> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? sanitizeConfig(parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function deliveryRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deliveryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeDeliveryChannelNames(value: unknown): string[] {
  const allowed = new Set(['realtime', 'email', 'discord', 'telegram', 'webhook']);
  const values = Array.isArray(value) ? value : [];
  const names = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toLowerCase().trim())
    .filter((item) => allowed.has(item));
  return Array.from(new Set(['realtime', ...names]));
}

function mapAttempt(row: AttemptRow): NotificationDeliveryAttemptRecord {
  return {
    id: row.id,
    alertEventId: row.alert_event_id,
    channelId: row.channel_id,
    channelKind: row.channel_kind,
    channelLabel: row.channel_label,
    status: row.status,
    attemptNumber: row.attempt_number,
    provider: row.provider,
    responseStatus: row.response_status,
    lastError: row.last_error,
    queuedAt: row.queued_at * 1000,
    attemptedAt: toMillis(row.attempted_at),
    deliveredAt: toMillis(row.delivered_at),
    nextAttemptAt: toMillis(row.next_attempt_at),
  };
}

function maskEndpoint(kind: NotificationChannelKind, endpoint: string): string {
  if (kind === 'email') {
    const [local = '', domain = ''] = endpoint.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (kind === 'telegram') return `${endpoint.slice(0, 3)}***${endpoint.slice(-2)}`;
  try {
    const url = new URL(endpoint);
    return `${url.origin}/***`;
  } catch {
    return '***';
  }
}

function redactDeliveryError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/(?:bearer|token|secret|password|authorization)[=: ]+[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 500);
}

function notificationEncryptionKeys(env: NotificationEncryptionEnv): {
  current: EncryptionKeyVersion;
  next?: EncryptionKeyVersion;
} {
  const currentSecret = env.NOTIFICATION_ENCRYPTION_KEY;
  if (!currentSecret || currentSecret.length < 32)
    throw new Error('NOTIFICATION_ENCRYPTION_KEY must be configured with at least 32 characters');
  const currentKeyId = env.NOTIFICATION_ENCRYPTION_KEY_ID?.trim() || 'current';
  const nextSecret = env.NOTIFICATION_ENCRYPTION_KEY_NEXT;
  const nextKeyId = env.NOTIFICATION_ENCRYPTION_KEY_NEXT_ID?.trim();
  if (Boolean(nextSecret) !== Boolean(nextKeyId))
    throw new Error('Notification next encryption key and key id must be configured together');
  if (nextSecret && nextSecret.length < 32)
    throw new Error(
      'NOTIFICATION_ENCRYPTION_KEY_NEXT must be configured with at least 32 characters'
    );
  if (nextKeyId === currentKeyId)
    throw new Error('Notification current and next encryption key ids must differ');
  return {
    current: { keyId: currentKeyId, secret: currentSecret },
    ...(nextSecret && nextKeyId ? { next: { keyId: nextKeyId, secret: nextSecret } } : {}),
  };
}

async function importNotificationEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function ciphertextKeyId(ciphertext: string): string | null {
  try {
    const parsed = JSON.parse(ciphertext) as { v?: unknown; kid?: unknown };
    return parsed.v === ENCRYPTION_VERSION && typeof parsed.kid === 'string' ? parsed.kid : null;
  } catch {
    return null;
  }
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

function channelAad(userId: string, channelId: string, field: 'endpoint' | 'secret'): string {
  return `lazuli:notification:v1:${userId}:${channelId}:${field}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value);
}

function toMillis(value: number | null): number | null {
  return value === null ? null : value * 1000;
}

function validId(value: string): boolean {
  return /^nch_[a-zA-Z0-9-]{1,64}$/.test(value);
}
