import type {
  ApiKeyRecord,
  AuthMagicLinkResponse,
  AuthSessionResponse,
  BacktestResponse,
  PasskeyAuthenticationOptionsResponse,
  PasskeyRecord,
  PasskeyRegistrationOptionsResponse,
  PriceAlertRecord,
  SavedBacktestRecord,
  SignalLabStrategy,
  SavedWorkspaceRecord,
  StrategyDefinition,
  UserAccount,
  WatchlistRecord,
} from '@lazuli/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type Uint8Array_,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type { Env } from '../types';

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const WEBAUTHN_CHALLENGE_TTL_SECONDS = 5 * 60;
const WEBAUTHN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_JSON_BYTES = 32_000;
const DEFAULT_ALERT_TOPIC = 'alerts:price';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: number;
  last_login_at: number | null;
}

interface SessionRow {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: number;
  last_login_at: number | null;
  expires_at: number;
}

interface SavedWorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  state_json: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

interface WatchlistRow {
  id: string;
  user_id: string;
  name: string;
  items_json: string;
  created_at: number;
  updated_at: number;
}

interface SavedBacktestRow {
  id: string;
  user_id: string;
  name: string;
  exchange: string;
  symbol: string;
  timeframe: string;
  strategy_json: string;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

interface SignalLabStrategyRow {
  id: string;
  user_id: string;
  name: string;
  exchange: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  timeframe: string;
  strategy_json: string;
  version: number;
  parent_id: string | null;
  latest_backtest_json: string | null;
  created_at: number;
  updated_at: number;
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash?: string;
  scopes_json: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports_json: string | null;
  device_type: string | null;
  backed_up: number;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}

interface WebAuthnChallengeRow {
  id: string;
  user_id: string | null;
  challenge: string;
  type: 'registration' | 'authentication';
  metadata_json: string | null;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

interface PriceAlertRow {
  id: number;
  user_id: string | null;
  symbol: string;
  exchange: string;
  market_type: 'spot' | 'perp' | null;
  price_target: number;
  condition: 'above' | 'below';
  active: number;
  triggered_at: number | null;
  topic: string | null;
  delivery_json: string | null;
  metadata_json: string | null;
  last_price: number | null;
  last_evaluated_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SaveWorkspaceInput {
  name: string;
  state: Record<string, unknown>;
  isDefault?: boolean;
}

export interface SaveWatchlistInput {
  name: string;
  items: string[];
}

export interface SaveBacktestInput {
  name: string;
  exchange: string;
  symbol: string;
  timeframe: string;
  strategy: Record<string, unknown>;
  result?: Record<string, unknown> | null;
}

export interface SaveSignalLabStrategyInput {
  name: string;
  exchange: string;
  symbol: string;
  marketType: 'spot' | 'perp';
  timeframe: string;
  strategy: StrategyDefinition;
  latestBacktest?: BacktestResponse | null;
}

export interface CreatePriceAlertInput {
  symbol: string;
  exchange: string;
  marketType: 'spot' | 'perp';
  priceTarget: number;
  condition: 'above' | 'below';
  delivery?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface VerifyPasskeyRegistrationInput {
  challengeId: string;
  response: RegistrationResponseJSON;
  name?: string;
}

export interface CreatePasskeyAuthenticationOptionsInput {
  email?: string;
}

export interface VerifyPasskeyAuthenticationInput {
  challengeId: string;
  response: AuthenticationResponseJSON;
}

export interface AlertEvaluationInput {
  alert: PriceAlertRecord;
  currentPrice: number;
}

export async function createMagicLink(
  env: Env,
  emailInput: string
): Promise<AuthMagicLinkResponse> {
  assertD1(env);
  const email = normalizeEmail(emailInput);
  const token = `ml_${randomToken(32)}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = unixNow() + MAGIC_LINK_TTL_SECONDS;
  const id = `ml_${crypto.randomUUID()}`;
  const baseUrl = env.APP_BASE_URL ?? env.PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
  const magicLink = `${baseUrl.replace(/\/$/, '')}/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

  await env.DB.prepare(
    `INSERT INTO auth_magic_links (id, email, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, unixepoch())`
  )
    .bind(id, email, tokenHash, expiresAt)
    .run();

  const delivered = await deliverMagicLink(env, email, magicLink, expiresAt);
  const exposeLink = env.ENVIRONMENT !== 'production' || !env.MAGIC_LINK_DELIVERY_WEBHOOK_URL;
  return {
    email,
    expiresAt: expiresAt * 1000,
    delivered,
    magicLink: exposeLink ? magicLink : null,
  };
}

export async function verifyMagicLink(env: Env, token: string): Promise<AuthSessionResponse> {
  assertD1(env);
  const tokenHash = await sha256Hex(token.trim());
  const now = unixNow();
  const row = await env.DB.prepare(
    `SELECT id, email
     FROM auth_magic_links
     WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`
  )
    .bind(tokenHash, now)
    .first<{ id: string; email: string }>();

  if (!row) {
    throw new Error('Magic link is invalid or expired');
  }

  const user = await upsertUser(env, row.email);
  await env.DB.prepare(`UPDATE auth_magic_links SET consumed_at = unixepoch() WHERE id = ?`)
    .bind(row.id)
    .run();

  return createSessionForUser(env, user);
}

export async function readUserFromSession(
  env: Env,
  authorization: string | null
): Promise<UserAccount> {
  assertD1(env);
  const token = parseBearerToken(authorization);
  if (!token) {
    throw new Error('Missing bearer session token');
  }
  const tokenHash = await sha256Hex(token);
  const now = unixNow();
  const row = await env.DB.prepare(
    `SELECT
       s.user_id,
       s.expires_at,
       u.email,
       u.display_name,
       u.created_at,
       u.last_login_at
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
  )
    .bind(tokenHash, now)
    .first<SessionRow>();

  if (!row) {
    throw new Error('Session token is invalid or expired');
  }

  await env.DB.prepare(
    `UPDATE user_sessions
     SET last_seen_at = unixepoch()
     WHERE token_hash = ?
       AND (last_seen_at IS NULL OR last_seen_at <= unixepoch() - 900)`
  )
    .bind(tokenHash)
    .run();
  return mapUser(row);
}

export async function revokeSession(
  env: Env,
  authorization: string | null
): Promise<{ revoked: boolean }> {
  assertD1(env);
  const token = parseBearerToken(authorization);
  if (!token) return { revoked: false };
  await env.DB.prepare(
    `UPDATE user_sessions SET revoked_at = unixepoch() WHERE token_hash = ? AND revoked_at IS NULL`
  )
    .bind(await sha256Hex(token))
    .run();
  return { revoked: true };
}

export async function listPasskeys(env: Env, userId: string): Promise<PasskeyRecord[]> {
  assertD1(env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  )
    .bind(userId)
    .all<PasskeyRow>();
  return results.map(mapPasskey);
}

export async function createPasskeyRegistrationOptions(
  env: Env,
  user: UserAccount
): Promise<PasskeyRegistrationOptionsResponse> {
  assertD1(env);
  const config = webAuthnConfig(env);
  const existingPasskeys = await listPasskeys(env, user.id);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID: new TextEncoder().encode(user.id) as Uint8Array_,
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    timeout: WEBAUTHN_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });
  const challenge = await createWebAuthnChallenge(env, {
    userId: user.id,
    type: 'registration',
    challenge: options.challenge,
  });

  return passkeyOptionsEnvelope(challenge, options);
}

export async function verifyPasskeyRegistration(
  env: Env,
  user: UserAccount,
  input: VerifyPasskeyRegistrationInput
): Promise<PasskeyRecord> {
  assertD1(env);
  const challenge = await getActiveWebAuthnChallenge(env, {
    id: input.challengeId,
    type: 'registration',
    userId: user.id,
  });
  const config = webAuthnConfig(env);
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: true,
  });

  if (!verification.verified) {
    throw new Error('Passkey registration could not be verified');
  }

  const credential = verification.registrationInfo.credential;
  const id = `pk_${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO passkeys
        (id, user_id, credential_id, public_key, counter, transports_json, device_type,
         backed_up, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
    ).bind(
      id,
      user.id,
      credential.id,
      bytesToBase64Url(credential.publicKey),
      credential.counter,
      encodeJson(credential.transports ?? [], 'transports'),
      verification.registrationInfo.credentialDeviceType,
      verification.registrationInfo.credentialBackedUp ? 1 : 0,
      cleanName(input.name ?? 'Passkey')
    ),
    env.DB.prepare(`UPDATE webauthn_challenges SET consumed_at = unixepoch() WHERE id = ?`).bind(
      challenge.id
    ),
  ]);

  const passkey = await getPasskeyById(env, user.id, id);
  if (!passkey) throw new Error('Passkey was not persisted');
  return passkey;
}

export async function createPasskeyAuthenticationOptions(
  env: Env,
  input: CreatePasskeyAuthenticationOptionsInput = {}
): Promise<PasskeyAuthenticationOptionsResponse> {
  assertD1(env);
  const config = webAuthnConfig(env);
  const email = input.email ? normalizeEmail(input.email) : null;
  const user = email ? await getUserByEmail(env, email) : null;
  const passkeys = user ? await listPasskeys(env, user.id) : [];
  if (email && passkeys.length === 0) {
    throw new Error('No passkeys are available for this account');
  }
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    timeout: WEBAUTHN_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials:
      passkeys.length > 0
        ? passkeys.map((passkey) => ({
            id: passkey.credentialId,
            transports: passkey.transports as AuthenticatorTransportFuture[],
          }))
        : undefined,
  });
  const challenge = await createWebAuthnChallenge(env, {
    userId: user?.id ?? null,
    type: 'authentication',
    challenge: options.challenge,
  });

  return passkeyOptionsEnvelope(challenge, options);
}

export async function verifyPasskeyAuthentication(
  env: Env,
  input: VerifyPasskeyAuthenticationInput
): Promise<AuthSessionResponse> {
  assertD1(env);
  const challenge = await getActiveWebAuthnChallenge(env, {
    id: input.challengeId,
    type: 'authentication',
  });
  const passkey = await getPasskeyByCredentialId(env, input.response.id);
  if (!passkey || (challenge.user_id && challenge.user_id !== passkey.user_id)) {
    throw new Error('Passkey authentication could not be verified');
  }

  const config = webAuthnConfig(env);
  const credential: WebAuthnCredential = {
    id: passkey.credential_id,
    publicKey: base64UrlToBytes(passkey.public_key),
    counter: passkey.counter,
    transports: parseStringArray(passkey.transports_json ?? '[]') as AuthenticatorTransportFuture[],
  };
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    credential,
    requireUserVerification: true,
  });

  if (!verification.verified) {
    throw new Error('Passkey authentication could not be verified');
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE passkeys
       SET counter = ?, last_used_at = unixepoch(), device_type = ?, backed_up = ?
       WHERE id = ?`
    ).bind(
      verification.authenticationInfo.newCounter,
      verification.authenticationInfo.credentialDeviceType,
      verification.authenticationInfo.credentialBackedUp ? 1 : 0,
      passkey.id
    ),
    env.DB.prepare(`UPDATE webauthn_challenges SET consumed_at = unixepoch() WHERE id = ?`).bind(
      challenge.id
    ),
  ]);

  const user = await getUserById(env, passkey.user_id);
  if (!user) throw new Error('Passkey account was not found');
  return createSessionForUser(env, user);
}

export async function deletePasskey(
  env: Env,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  assertD1(env);
  const result = await env.DB.prepare(`DELETE FROM passkeys WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
  return { deleted: (result.meta.changes ?? 0) > 0 };
}

export async function listWorkspaces(env: Env, userId: string): Promise<SavedWorkspaceRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM saved_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
  )
    .bind(userId)
    .all<SavedWorkspaceRow>();
  return results.map(mapWorkspace);
}

export async function saveWorkspace(
  env: Env,
  userId: string,
  input: SaveWorkspaceInput
): Promise<SavedWorkspaceRecord> {
  const id = `ws_${crypto.randomUUID()}`;
  const stateJson = encodeJson(input.state, 'state');
  if (input.isDefault) {
    await env.DB.prepare(`UPDATE saved_workspaces SET is_default = 0 WHERE user_id = ?`)
      .bind(userId)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO saved_workspaces (id, user_id, name, state_json, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(id, userId, cleanName(input.name), stateJson, input.isDefault ? 1 : 0)
    .run();
  return (await getWorkspace(env, userId, id))!;
}

export async function deleteWorkspace(
  env: Env,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const result = await env.DB.prepare(`DELETE FROM saved_workspaces WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
  return { deleted: (result.meta.changes ?? 0) > 0 };
}

export async function listWatchlists(env: Env, userId: string): Promise<WatchlistRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM watchlists WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
  )
    .bind(userId)
    .all<WatchlistRow>();
  return results.map(mapWatchlist);
}

export async function saveWatchlist(
  env: Env,
  userId: string,
  input: SaveWatchlistInput
): Promise<WatchlistRecord> {
  const id = `wl_${crypto.randomUUID()}`;
  const uniqueItems = Array.from(
    new Set(input.items.map((item) => item.trim()).filter(Boolean))
  ).slice(0, 200);
  const itemsJson = encodeJson(uniqueItems, 'items');
  await env.DB.prepare(
    `INSERT INTO watchlists (id, user_id, name, items_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(id, userId, cleanName(input.name), itemsJson)
    .run();
  return (await getWatchlist(env, userId, id))!;
}

export async function deleteWatchlist(
  env: Env,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const result = await env.DB.prepare(`DELETE FROM watchlists WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
  return { deleted: (result.meta.changes ?? 0) > 0 };
}

export async function listSavedBacktests(env: Env, userId: string): Promise<SavedBacktestRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM saved_backtests WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
  )
    .bind(userId)
    .all<SavedBacktestRow>();
  return results.map(mapBacktest);
}

export async function saveBacktest(
  env: Env,
  userId: string,
  input: SaveBacktestInput
): Promise<SavedBacktestRecord> {
  const id = `bt_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO saved_backtests
      (id, user_id, name, exchange, symbol, timeframe, strategy_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(
      id,
      userId,
      cleanName(input.name),
      input.exchange,
      input.symbol,
      input.timeframe,
      encodeJson(input.strategy, 'strategy'),
      input.result ? encodeJson(input.result, 'result') : null
    )
    .run();
  return (await getBacktest(env, userId, id))!;
}

export async function deleteSavedBacktest(
  env: Env,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const result = await env.DB.prepare(`DELETE FROM saved_backtests WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
  return { deleted: (result.meta.changes ?? 0) > 0 };
}

export async function listSignalLabStrategies(
  env: Env,
  userId: string
): Promise<SignalLabStrategy[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM signal_lab_strategies WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`
  )
    .bind(userId)
    .all<SignalLabStrategyRow>();
  return results.map(mapSignalLabStrategy);
}

export async function saveSignalLabStrategy(
  env: Env,
  userId: string,
  input: SaveSignalLabStrategyInput
): Promise<SignalLabStrategy> {
  const id = `sig_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO signal_lab_strategies
      (id, user_id, name, exchange, symbol, market_type, timeframe, strategy_json,
       version, parent_id, latest_backtest_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, unixepoch(), unixepoch())`
  )
    .bind(
      id,
      userId,
      cleanName(input.name),
      input.exchange,
      input.symbol,
      input.marketType,
      input.timeframe,
      encodeJson(input.strategy, 'strategy'),
      input.latestBacktest ? encodeJson(input.latestBacktest, 'latestBacktest') : null
    )
    .run();
  return (await getSignalLabStrategy(env, userId, id))!;
}

export async function saveSignalLabStrategyVersion(
  env: Env,
  userId: string,
  parentId: string,
  input: SaveSignalLabStrategyInput
): Promise<SignalLabStrategy> {
  const parent = await getSignalLabStrategy(env, userId, parentId);
  if (!parent) {
    throw new Error('Signal Lab strategy was not found');
  }
  const id = `sig_${crypto.randomUUID()}`;
  const nextVersion = await nextSignalLabVersion(env, parent.parentId ?? parent.id);
  await env.DB.prepare(
    `INSERT INTO signal_lab_strategies
      (id, user_id, name, exchange, symbol, market_type, timeframe, strategy_json,
       version, parent_id, latest_backtest_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(
      id,
      userId,
      cleanName(input.name),
      input.exchange,
      input.symbol,
      input.marketType,
      input.timeframe,
      encodeJson(input.strategy, 'strategy'),
      nextVersion,
      parent.parentId ?? parent.id,
      input.latestBacktest ? encodeJson(input.latestBacktest, 'latestBacktest') : null
    )
    .run();
  return (await getSignalLabStrategy(env, userId, id))!;
}

export async function updateSignalLabLatestBacktest(
  env: Env,
  userId: string,
  id: string,
  latestBacktest: BacktestResponse
): Promise<SignalLabStrategy> {
  const result = await env.DB.prepare(
    `UPDATE signal_lab_strategies SET latest_backtest_json = ? WHERE user_id = ? AND id = ?`
  )
    .bind(encodeJson(latestBacktest, 'latestBacktest'), userId, id)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new Error('Signal Lab strategy was not found');
  }
  return (await getSignalLabStrategy(env, userId, id))!;
}

export async function deleteSignalLabStrategy(
  env: Env,
  userId: string,
  id: string
): Promise<{ deleted: boolean }> {
  const results = await env.DB.batch([
    env.DB.prepare(`DELETE FROM signal_lab_strategies WHERE user_id = ? AND parent_id = ?`).bind(
      userId,
      id
    ),
    env.DB.prepare(`DELETE FROM signal_lab_strategies WHERE user_id = ? AND id = ?`).bind(
      userId,
      id
    ),
  ]);
  return { deleted: results.some((result) => (result.meta.changes ?? 0) > 0) };
}

export async function listPriceAlerts(env: Env, userId: string): Promise<PriceAlertRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM price_alerts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 250`
  )
    .bind(userId)
    .all<PriceAlertRow>();
  return results.map(mapAlert);
}

export async function listDuePriceAlerts(env: Env, limit = 500): Promise<PriceAlertRecord[]> {
  assertD1(env);
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const { results } = await env.DB.prepare(
    `SELECT *
     FROM price_alerts
     WHERE active = 1 AND user_id IS NOT NULL
     ORDER BY COALESCE(last_evaluated_at, 0) ASC, updated_at ASC
     LIMIT ?`
  )
    .bind(boundedLimit)
    .all<PriceAlertRow>();
  return results.map(mapAlert);
}

export async function createPriceAlert(
  env: Env,
  userId: string,
  input: CreatePriceAlertInput
): Promise<PriceAlertRecord> {
  const topic = `${DEFAULT_ALERT_TOPIC}:${userId}`;
  const result = await env.DB.prepare(
    `INSERT INTO price_alerts
      (user_id, symbol, exchange, market_type, price_target, condition, active, topic,
       delivery_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(
      userId,
      input.symbol,
      input.exchange,
      input.marketType,
      input.priceTarget,
      input.condition,
      topic,
      input.delivery ? encodeJson(input.delivery, 'delivery') : null,
      input.metadata ? encodeJson(input.metadata, 'metadata') : null
    )
    .run();
  const id = Number(result.meta.last_row_id);
  return (await getPriceAlert(env, userId, id))!;
}

export async function deletePriceAlert(
  env: Env,
  userId: string,
  id: number
): Promise<{ deleted: boolean }> {
  const result = await env.DB.prepare(`DELETE FROM price_alerts WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
  return { deleted: (result.meta.changes ?? 0) > 0 };
}

export async function listApiKeys(env: Env, userId: string): Promise<ApiKeyRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
  )
    .bind(userId)
    .all<ApiKeyRow>();
  return results.map(mapApiKey);
}

export async function createApiKey(
  env: Env,
  userId: string,
  name: string,
  scopes: string[]
): Promise<ApiKeyRecord & { secret: string }> {
  const id = `key_${crypto.randomUUID()}`;
  const secret = `lz_live_${randomToken(32)}`;
  const keyPrefix = secret.slice(0, 18);
  await env.DB.prepare(
    `INSERT INTO api_keys
      (id, user_id, name, key_prefix, key_hash, scopes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`
  )
    .bind(
      id,
      userId,
      cleanName(name),
      keyPrefix,
      await sha256Hex(secret),
      encodeJson(scopes, 'scopes')
    )
    .run();
  const record = await getApiKey(env, userId, id);
  if (!record) throw new Error('API key was not persisted');
  return { ...record, secret };
}

export async function verifyApiKey(env: Env, secretInput: string): Promise<ApiKeyRecord | null> {
  assertD1(env);
  const secret = secretInput.trim();
  if (!/^lz_live_[a-f0-9]{64}$/.test(secret)) {
    return null;
  }

  const keyPrefix = secret.slice(0, 18);
  const row = await env.DB.prepare(
    `SELECT *
     FROM api_keys
     WHERE key_prefix = ? AND revoked_at IS NULL
     LIMIT 1`
  )
    .bind(keyPrefix)
    .first<ApiKeyRow>();
  if (!row?.key_hash) return null;

  const expectedHash = await sha256Hex(secret);
  if (!constantTimeEqual(row.key_hash, expectedHash)) {
    return null;
  }

  await env.DB.prepare(
    `UPDATE api_keys
     SET last_used_at = unixepoch()
     WHERE id = ?
       AND (last_used_at IS NULL OR last_used_at <= unixepoch() - 900)`
  )
    .bind(row.id)
    .run();
  return mapApiKey(row);
}

export async function revokeApiKey(
  env: Env,
  userId: string,
  id: string
): Promise<{ revoked: boolean }> {
  const result = await env.DB.prepare(
    `UPDATE api_keys SET revoked_at = unixepoch() WHERE user_id = ? AND id = ? AND revoked_at IS NULL`
  )
    .bind(userId, id)
    .run();
  return { revoked: (result.meta.changes ?? 0) > 0 };
}

export async function evaluateAlertTrigger(
  env: Env,
  input: AlertEvaluationInput
): Promise<{ triggered: boolean; eventId: string | null }> {
  const target = input.alert.priceTarget;
  const triggered =
    input.alert.condition === 'above' ? input.currentPrice >= target : input.currentPrice <= target;

  await env.DB.prepare(
    `UPDATE price_alerts
     SET last_price = ?, last_evaluated_at = unixepoch()
     WHERE id = ?`
  )
    .bind(input.currentPrice, input.alert.id)
    .run();

  if (!triggered || input.alert.triggeredAt !== null) {
    return { triggered: false, eventId: null };
  }

  const eventId = `ae_${crypto.randomUUID()}`;
  const topic = input.alert.topic ?? DEFAULT_ALERT_TOPIC;
  const payload = {
    eventId,
    alertId: input.alert.id,
    userId: input.alert.userId,
    symbol: input.alert.symbol,
    exchange: input.alert.exchange,
    condition: input.alert.condition,
    priceTarget: input.alert.priceTarget,
    currentPrice: input.currentPrice,
    triggeredAt: Date.now(),
  };
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE price_alerts
       SET active = 0, triggered_at = unixepoch(), last_price = ?, last_evaluated_at = unixepoch()
       WHERE id = ?`
    ).bind(input.currentPrice, input.alert.id),
    env.DB.prepare(
      `INSERT INTO alert_events
        (id, alert_id, user_id, symbol, exchange, trigger_price, target_price, condition,
         status, topic, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, unixepoch())`
    ).bind(
      eventId,
      input.alert.id,
      input.alert.userId,
      input.alert.symbol,
      input.alert.exchange,
      input.currentPrice,
      input.alert.priceTarget,
      input.alert.condition,
      topic,
      JSON.stringify(payload)
    ),
  ]);

  const published = await publishRealtime(env, topic, payload);
  const delivered = await deliverAlertNotification(env, input.alert, payload);
  await env.DB.prepare(`UPDATE alert_events SET status = ? WHERE id = ?`)
    .bind(published || delivered ? 'published' : 'failed', eventId)
    .run();
  return { triggered: true, eventId };
}

export async function deliverAlertNotification(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>
): Promise<boolean> {
  const delivery = sanitizeAlertDelivery(alert.delivery);
  const attempts = [
    ...buildChannelDeliveryAttempts(env, alert, payload, delivery),
    deliverAlertRelay(env, alert, payload, delivery),
  ];
  const results = await Promise.all(attempts);
  return results.some(Boolean);
}

async function deliverAlertRelay(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>,
  delivery: Record<string, unknown>
): Promise<boolean> {
  if (!env.ALERT_DELIVERY_WEBHOOK_URL) return false;

  return postJson(env.ALERT_DELIVERY_WEBHOOK_URL, {
    body: alertDeliveryEnvelope(alert, payload, delivery),
    headers: env.ALERT_DELIVERY_WEBHOOK_SECRET
      ? { Authorization: `Bearer ${env.ALERT_DELIVERY_WEBHOOK_SECRET}` }
      : {},
    channel: 'relay',
    alertId: alert.id,
  });
}

function buildChannelDeliveryAttempts(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>,
  delivery: Record<string, unknown>
): Array<Promise<boolean>> {
  return alertDeliveryChannels(delivery).map((channel) => {
    switch (channel) {
      case 'email':
        return deliverAlertEmail(env, alert, payload, delivery);
      case 'discord':
        return deliverAlertDiscord(env, alert, payload);
      case 'telegram':
        return deliverAlertTelegram(env, alert, payload, delivery);
      case 'webhook':
        return deliverAlertWebhook(env, alert, payload, delivery);
      default:
        return Promise.resolve(false);
    }
  });
}

async function deliverAlertEmail(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>,
  delivery: Record<string, unknown>
): Promise<boolean> {
  if (!env.ALERT_EMAIL_DELIVERY_WEBHOOK_URL) return false;
  const emailConfig = deliveryRecord(delivery.email);
  const to = deliveryString(delivery.email) ?? deliveryString(emailConfig?.to);
  if (!to) return false;

  const text = alertMessage(alert, payload);
  return postJson(env.ALERT_EMAIL_DELIVERY_WEBHOOK_URL, {
    body: {
      kind: 'price-alert-email',
      to,
      subject: `Lazuli alert: ${alert.symbol} ${alert.condition} ${formatNumber(alert.priceTarget)}`,
      text,
      alert: publicAlertSummary(alert),
      payload,
      timestamp: Date.now(),
    },
    headers: env.ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET
      ? { Authorization: `Bearer ${env.ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET}` }
      : {},
    channel: 'email',
    alertId: alert.id,
  });
}

async function deliverAlertDiscord(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>
): Promise<boolean> {
  if (!env.ALERT_DISCORD_WEBHOOK_URL) return false;
  return postJson(env.ALERT_DISCORD_WEBHOOK_URL, {
    body: {
      content: alertMessage(alert, payload),
      allowed_mentions: { parse: [] },
    },
    channel: 'discord',
    alertId: alert.id,
  });
}

async function deliverAlertTelegram(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>,
  delivery: Record<string, unknown>
): Promise<boolean> {
  if (!env.ALERT_TELEGRAM_BOT_TOKEN) return false;
  const telegram = deliveryRecord(delivery.telegram);
  const chatId = deliveryString(telegram?.chatId) ?? deliveryString(telegram?.chat_id);
  if (!chatId) return false;

  return postJson(`https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    body: {
      chat_id: chatId,
      text: alertMessage(alert, payload),
      disable_web_page_preview: true,
    },
    channel: 'telegram',
    alertId: alert.id,
  });
}

async function deliverAlertWebhook(
  env: Env,
  alert: PriceAlertRecord,
  payload: Record<string, unknown>,
  delivery: Record<string, unknown>
): Promise<boolean> {
  if (env.ALERT_USER_WEBHOOKS_ENABLED !== 'true') return false;
  const webhookUrl = userWebhookUrl(delivery.webhook);
  if (!webhookUrl) return false;

  const body = JSON.stringify(alertDeliveryEnvelope(alert, payload, delivery));
  const headers: Record<string, string> = {};
  if (env.ALERT_WEBHOOK_SIGNING_SECRET) {
    headers['X-Lazuli-Signature'] =
      `sha256=${await hmacSha256Hex(env.ALERT_WEBHOOK_SIGNING_SECRET, body)}`;
  }

  return postJson(webhookUrl, {
    body,
    headers,
    channel: 'webhook',
    alertId: alert.id,
  });
}

async function postJson(
  url: string,
  options: {
    body: unknown;
    headers?: Record<string, string>;
    channel: string;
    alertId: number;
  }
): Promise<boolean> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  }).catch((error) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'alerts',
        msg: 'alert delivery failed',
        alertId: options.alertId,
        channel: options.channel,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return null;
  });

  if (!response) return false;
  if (!response.ok) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'alerts',
        msg: 'alert delivery rejected event',
        alertId: options.alertId,
        channel: options.channel,
        status: response.status,
      })
    );
    return false;
  }
  return true;
}

function alertDeliveryEnvelope(
  alert: PriceAlertRecord,
  payload: Record<string, unknown>,
  delivery: Record<string, unknown>
): Record<string, unknown> {
  return {
    kind: 'price-alert-triggered',
    alert: publicAlertSummary(alert),
    delivery,
    payload,
    timestamp: Date.now(),
  };
}

function publicAlertSummary(alert: PriceAlertRecord): Record<string, unknown> {
  return {
    id: alert.id,
    userId: alert.userId,
    symbol: alert.symbol,
    exchange: alert.exchange,
    marketType: alert.marketType,
    condition: alert.condition,
    priceTarget: alert.priceTarget,
    topic: alert.topic,
  };
}

function alertDeliveryChannels(delivery: Record<string, unknown>): string[] {
  const explicit = Array.isArray(delivery.channels)
    ? delivery.channels.filter((channel): channel is string => typeof channel === 'string')
    : [];
  const type = deliveryString(delivery.type);
  const inferred = ['email', 'discord', 'telegram', 'webhook'].filter(
    (channel) => delivery[channel] !== undefined
  );
  const channels = explicit.length > 0 ? explicit : type ? [type] : inferred;
  return Array.from(new Set(channels.map((channel) => channel.toLowerCase().trim()))).filter(
    (channel) => channel !== 'realtime' && channel !== 'relay'
  );
}

function alertMessage(alert: PriceAlertRecord, payload: Record<string, unknown>): string {
  const currentPrice =
    typeof payload.currentPrice === 'number' ? formatNumber(payload.currentPrice) : 'n/a';
  const target = formatNumber(alert.priceTarget);
  return `Lazuli price alert: ${alert.symbol} on ${alert.exchange.toUpperCase()} is ${currentPrice}, ${alert.condition} target ${target}.`;
}

function deliveryRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deliveryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function userWebhookUrl(value: unknown): string | null {
  const rawUrl = deliveryString(value) ?? deliveryString(deliveryRecord(value)?.url);
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function buildMarketSnapshotSvg(params: {
  symbol: string;
  exchange: string;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  timestamp: number;
}): string {
  const change = params.change24h ?? 0;
  const accent = change >= 0 ? '#33d17a' : '#ff5f57';
  const price = params.price === null ? 'n/a' : `$${formatNumber(params.price)}`;
  const volume = params.volume24h === null ? 'n/a' : `$${formatCompact(params.volume24h)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#080b12"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#101622" stroke="#243044"/>
  <text x="88" y="130" fill="#8ea0bd" font-family="Inter,Arial,sans-serif" font-size="32" font-weight="600">LAZULI LIVE SNAPSHOT</text>
  <text x="88" y="230" fill="#f4f7fb" font-family="Inter,Arial,sans-serif" font-size="86" font-weight="800">${escapeSvg(params.symbol)}</text>
  <text x="88" y="292" fill="#8ea0bd" font-family="Inter,Arial,sans-serif" font-size="34">${escapeSvg(params.exchange.toUpperCase())}</text>
  <text x="88" y="404" fill="#f4f7fb" font-family="Inter,Arial,sans-serif" font-size="76" font-weight="800">${price}</text>
  <text x="88" y="472" fill="${accent}" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="700">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h</text>
  <text x="690" y="404" fill="#f4f7fb" font-family="Inter,Arial,sans-serif" font-size="54" font-weight="700">${volume}</text>
  <text x="690" y="456" fill="#8ea0bd" font-family="Inter,Arial,sans-serif" font-size="28">24h volume</text>
  <text x="88" y="538" fill="#5f718d" font-family="Inter,Arial,sans-serif" font-size="22">Generated ${new Date(params.timestamp).toISOString()}</text>
</svg>`;
}

async function upsertUser(env: Env, email: string): Promise<UserAccount> {
  const existing = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
  if (existing) return mapUser(existing);

  const id = `usr_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())`
  )
    .bind(id, email)
    .run();
  const created = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
  if (!created) throw new Error('User was not persisted');
  return mapUser(created);
}

async function getUserById(env: Env, id: string): Promise<UserAccount | null> {
  const row = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
  return row ? mapUser(row) : null;
}

async function getUserByEmail(env: Env, email: string): Promise<UserAccount | null> {
  const row = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

async function createSessionForUser(env: Env, user: UserAccount): Promise<AuthSessionResponse> {
  const sessionToken = `ls_${randomToken(36)}`;
  const sessionHash = await sha256Hex(sessionToken);
  const sessionId = `sess_${crypto.randomUUID()}`;
  const expiresAt = unixNow() + SESSION_TTL_SECONDS;
  await env.DB.prepare(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
  )
    .bind(sessionId, user.id, sessionHash, expiresAt)
    .run();
  await env.DB.prepare(`UPDATE users SET last_login_at = unixepoch() WHERE id = ?`)
    .bind(user.id)
    .run();

  return {
    user: {
      ...user,
      lastLoginAt: Date.now(),
    },
    sessionToken,
    expiresAt: expiresAt * 1000,
  };
}

async function createWebAuthnChallenge(
  env: Env,
  input: {
    userId: string | null;
    type: WebAuthnChallengeRow['type'];
    challenge: string;
  }
): Promise<WebAuthnChallengeRow> {
  const id = `wch_${crypto.randomUUID()}`;
  const expiresAt = unixNow() + WEBAUTHN_CHALLENGE_TTL_SECONDS;
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges
      (id, user_id, challenge, type, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())`
  )
    .bind(id, input.userId, input.challenge, input.type, expiresAt)
    .run();
  return {
    id,
    user_id: input.userId,
    challenge: input.challenge,
    type: input.type,
    metadata_json: null,
    expires_at: expiresAt,
    consumed_at: null,
    created_at: unixNow(),
  };
}

async function getActiveWebAuthnChallenge(
  env: Env,
  input: { id: string; type: WebAuthnChallengeRow['type']; userId?: string }
): Promise<WebAuthnChallengeRow> {
  const row = await env.DB.prepare(
    `SELECT *
     FROM webauthn_challenges
     WHERE id = ? AND type = ? AND consumed_at IS NULL AND expires_at > ?`
  )
    .bind(input.id, input.type, unixNow())
    .first<WebAuthnChallengeRow>();
  if (!row || (input.userId && row.user_id !== input.userId)) {
    throw new Error('WebAuthn challenge is invalid or expired');
  }
  return row;
}

async function getPasskeyById(env: Env, userId: string, id: string): Promise<PasskeyRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM passkeys WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<PasskeyRow>();
  return row ? mapPasskey(row) : null;
}

async function getPasskeyByCredentialId(
  env: Env,
  credentialId: string
): Promise<PasskeyRow | null> {
  return env.DB.prepare(`SELECT * FROM passkeys WHERE credential_id = ?`)
    .bind(credentialId)
    .first<PasskeyRow>();
}

async function getWorkspace(
  env: Env,
  userId: string,
  id: string
): Promise<SavedWorkspaceRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM saved_workspaces WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<SavedWorkspaceRow>();
  return row ? mapWorkspace(row) : null;
}

async function getWatchlist(env: Env, userId: string, id: string): Promise<WatchlistRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM watchlists WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<WatchlistRow>();
  return row ? mapWatchlist(row) : null;
}

async function getBacktest(
  env: Env,
  userId: string,
  id: string
): Promise<SavedBacktestRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM saved_backtests WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<SavedBacktestRow>();
  return row ? mapBacktest(row) : null;
}

async function getSignalLabStrategy(
  env: Env,
  userId: string,
  id: string
): Promise<SignalLabStrategy | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM signal_lab_strategies WHERE user_id = ? AND id = ?`
  )
    .bind(userId, id)
    .first<SignalLabStrategyRow>();
  return row ? mapSignalLabStrategy(row) : null;
}

async function getPriceAlert(
  env: Env,
  userId: string,
  id: number
): Promise<PriceAlertRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM price_alerts WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<PriceAlertRow>();
  return row ? mapAlert(row) : null;
}

async function getApiKey(env: Env, userId: string, id: string): Promise<ApiKeyRecord | null> {
  const row = await env.DB.prepare(`SELECT * FROM api_keys WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<ApiKeyRow>();
  return row ? mapApiKey(row) : null;
}

async function deliverMagicLink(
  env: Env,
  email: string,
  magicLink: string,
  expiresAt: number
): Promise<boolean> {
  if (!env.MAGIC_LINK_DELIVERY_WEBHOOK_URL) {
    if (env.ENVIRONMENT === 'production') {
      throw new Error('MAGIC_LINK_DELIVERY_WEBHOOK_URL is required in production');
    }
    return false;
  }

  const response = await fetch(env.MAGIC_LINK_DELIVERY_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.MAGIC_LINK_DELIVERY_WEBHOOK_SECRET
        ? { Authorization: `Bearer ${env.MAGIC_LINK_DELIVERY_WEBHOOK_SECRET}` }
        : {}),
    },
    body: JSON.stringify({ email, magicLink, expiresAt: expiresAt * 1000 }),
  });
  if (!response.ok) {
    throw new Error(`Magic-link delivery failed with HTTP ${response.status}`);
  }
  return true;
}

async function publishRealtime(env: Env, topic: string, payload: unknown): Promise<boolean> {
  if (!env.REALTIME_HUB || !env.ADMIN_API_KEY) return false;
  const id = env.REALTIME_HUB.idFromName('global');
  const url = new URL('https://realtime/publish');
  url.searchParams.set('topic', topic);
  const response = await env.REALTIME_HUB.get(id).fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-API-Key': env.ADMIN_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

function mapUser(row: UserRow | SessionRow): UserAccount {
  return {
    id: 'user_id' in row ? row.user_id : row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at * 1000,
    lastLoginAt: row.last_login_at ? row.last_login_at * 1000 : null,
  };
}

function mapWorkspace(row: SavedWorkspaceRow): SavedWorkspaceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    state: parseJsonRecord(row.state_json),
    isDefault: row.is_default === 1,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function mapWatchlist(row: WatchlistRow): WatchlistRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    items: parseStringArray(row.items_json),
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function mapBacktest(row: SavedBacktestRow): SavedBacktestRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    exchange: row.exchange,
    symbol: row.symbol,
    timeframe: row.timeframe,
    strategy: parseJsonRecord(row.strategy_json),
    result: row.result_json ? parseJsonRecord(row.result_json) : null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function mapSignalLabStrategy(row: SignalLabStrategyRow): SignalLabStrategy {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    exchange: row.exchange as SignalLabStrategy['exchange'],
    symbol: row.symbol,
    marketType: row.market_type,
    timeframe: row.timeframe as SignalLabStrategy['timeframe'],
    strategy: parseJsonRecord(row.strategy_json) as unknown as SignalLabStrategy['strategy'],
    version: row.version,
    parentId: row.parent_id,
    latestBacktest: row.latest_backtest_json
      ? (parseJsonRecord(
          row.latest_backtest_json
        ) as unknown as SignalLabStrategy['latestBacktest'])
      : null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function mapApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: parseStringArray(row.scopes_json),
    createdAt: row.created_at * 1000,
    lastUsedAt: row.last_used_at ? row.last_used_at * 1000 : null,
    revokedAt: row.revoked_at ? row.revoked_at * 1000 : null,
  };
}

function mapPasskey(row: PasskeyRow): PasskeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    name: row.name,
    transports: parseStringArray(row.transports_json ?? '[]'),
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    createdAt: row.created_at * 1000,
    lastUsedAt: row.last_used_at ? row.last_used_at * 1000 : null,
  };
}

function passkeyOptionsEnvelope(
  challenge: WebAuthnChallengeRow,
  options: PublicKeyCredentialCreationOptionsJSON
): PasskeyRegistrationOptionsResponse;
function passkeyOptionsEnvelope(
  challenge: WebAuthnChallengeRow,
  options: PublicKeyCredentialRequestOptionsJSON
): PasskeyAuthenticationOptionsResponse;
function passkeyOptionsEnvelope(
  challenge: WebAuthnChallengeRow,
  options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON
): PasskeyRegistrationOptionsResponse | PasskeyAuthenticationOptionsResponse {
  return {
    challengeId: challenge.id,
    options: options as unknown as Record<string, unknown>,
    expiresAt: challenge.expires_at * 1000,
  };
}

function mapAlert(row: PriceAlertRow): PriceAlertRecord {
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    exchange: row.exchange,
    marketType: row.market_type ?? 'spot',
    priceTarget: row.price_target,
    condition: row.condition,
    active: row.active === 1,
    triggeredAt: row.triggered_at ? row.triggered_at * 1000 : null,
    topic: row.topic,
    delivery: row.delivery_json ? parseJsonRecord(row.delivery_json) : null,
    metadata: row.metadata_json ? parseJsonRecord(row.metadata_json) : null,
    lastPrice: row.last_price,
    lastEvaluatedAt: row.last_evaluated_at ? row.last_evaluated_at * 1000 : null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('A valid email address is required');
  }
  return email;
}

function webAuthnConfig(env: Env): { rpName: string; rpID: string; origin: string } {
  const rawUrl = env.APP_BASE_URL ?? env.PUBLIC_API_BASE_URL ?? 'http://localhost:8788';
  const url = new URL(rawUrl);
  return {
    rpName: 'Lazuli',
    rpID: url.hostname,
    origin: url.origin,
  };
}

function cleanName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120) {
    throw new Error('name must be between 1 and 120 characters');
  }
  return name;
}

function encodeJson(value: unknown, field: string): string {
  const encoded = JSON.stringify(value);
  if (encoded.length > MAX_JSON_BYTES) {
    throw new Error(`${field} exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return encoded;
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

async function nextSignalLabVersion(env: Env, rootId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT MAX(version) AS max_version
     FROM signal_lab_strategies
     WHERE id = ? OR parent_id = ?`
  )
    .bind(rootId, rootId)
    .first<{ max_version: number | null }>();
  return (row?.max_version ?? 1) + 1;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function sanitizeAlertDelivery(value: Record<string, unknown> | null): Record<string, unknown> {
  if (!value) return { channels: ['realtime'] };
  const allowed = new Set([
    'channels',
    'type',
    'email',
    'webhook',
    'discord',
    'telegram',
    'locale',
    'timezone',
  ]);
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    sanitized[key] = sanitizeJsonValue(item);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : { channels: ['realtime'] };
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeJsonValue);
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/(secret|token|key|password|authorization)/i.test(key)) continue;
      result[key] = sanitizeJsonValue(item);
    }
    return result;
  }
  return null;
}

function parseBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array_ {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array_;
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
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

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function assertD1(env: Env): asserts env is Env & { DB: D1Database } {
  if (!env.DB) {
    throw new Error('D1 database binding is not configured');
  }
}

function formatNumber(value: number): string {
  return value >= 100
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : value.toFixed(4);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeSvg(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
