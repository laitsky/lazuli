export interface OpsReadEnvironment {
  ENVIRONMENT?: 'local' | 'staging' | 'production';
  OPS_READ_SECRET?: string;
  OPS_READ_SECRET_NEXT?: string;
}

export async function verifyOpsReadSecret(
  env: OpsReadEnvironment,
  candidate: string | undefined
): Promise<boolean> {
  if (!candidate) return false;
  const candidates = [env.OPS_READ_SECRET, env.OPS_READ_SECRET_NEXT].filter(
    (value): value is string => Boolean(value)
  );
  if (candidates.length === 0) return env.ENVIRONMENT === 'local' && candidate === 'local-ops';
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const supplied = await digest(candidate);
  for (const secret of candidates) {
    const expected = await digest(secret);
    let difference = supplied.byteLength ^ expected.byteLength;
    const length = Math.max(supplied.byteLength, expected.byteLength);
    for (let index = 0; index < length; index += 1) {
      difference |= (supplied[index] ?? 0) ^ (expected[index] ?? 0);
    }
    if (difference === 0) return true;
  }
  return false;
}
