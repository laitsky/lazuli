export interface SecretVersion {
  keyId: string;
  secret: string;
}

export interface SecretRing {
  current: SecretVersion;
  next?: SecretVersion;
}

export interface RotatingHmacVerificationInput {
  ring: SecretRing;
  payload: string;
  signature: string;
  keyId?: string | null;
  signaturePrefix?: string;
}

export interface RotatingHmacVerificationResult {
  ok: boolean;
  keyId: string | null;
}

/**
 * Verify against the presented key version when supplied, otherwise try the
 * current and staged-next keys. The latter preserves compatibility while
 * callers roll out key-id headers or token claims.
 */
export async function verifyRotatingHmac(
  input: RotatingHmacVerificationInput
): Promise<RotatingHmacVerificationResult> {
  const prefix = input.signaturePrefix ?? 'sha256=';
  if (!input.signature.startsWith(prefix)) return { ok: false, keyId: null };
  const presented = input.signature.slice(prefix.length);
  const candidates = [input.ring.current, input.ring.next].filter(
    (candidate): candidate is SecretVersion =>
      candidate !== undefined && (!input.keyId || candidate.keyId === input.keyId)
  );

  for (const candidate of candidates) {
    const expected = await hmacSha256Hex(candidate.secret, input.payload);
    if (constantTimeEqual(presented, expected)) return { ok: true, keyId: candidate.keyId };
  }
  return { ok: false, keyId: null };
}

export async function signWithCurrentSecret(
  ring: SecretRing,
  payload: string,
  signaturePrefix = 'sha256='
): Promise<{ keyId: string; signature: string }> {
  return {
    keyId: ring.current.keyId,
    signature: `${signaturePrefix}${await hmacSha256Hex(ring.current.secret, payload)}`,
  };
}

export function createSecretRing(input: {
  currentKeyId: string | undefined;
  currentSecret: string | undefined;
  nextKeyId?: string | undefined;
  nextSecret?: string | undefined;
  label: string;
}): SecretRing {
  const currentKeyId = input.currentKeyId?.trim();
  const currentSecret = input.currentSecret;
  if (!currentKeyId || !currentSecret) {
    throw new Error(`${input.label} current key id and secret must be configured`);
  }

  const nextKeyId = input.nextKeyId?.trim();
  const nextSecret = input.nextSecret;
  if (Boolean(nextKeyId) !== Boolean(nextSecret)) {
    throw new Error(`${input.label} next key id and secret must be configured together`);
  }
  if (nextKeyId === currentKeyId) {
    throw new Error(`${input.label} current and next key ids must differ`);
  }

  return {
    current: { keyId: currentKeyId, secret: currentSecret },
    ...(nextKeyId && nextSecret ? { next: { keyId: nextKeyId, secret: nextSecret } } : {}),
  };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
