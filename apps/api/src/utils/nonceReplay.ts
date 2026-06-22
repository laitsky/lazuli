export function isActiveNonceReplay(existingExpiresAt: number | undefined, nowMs: number): boolean {
  return typeof existingExpiresAt === 'number' && existingExpiresAt > nowMs;
}
