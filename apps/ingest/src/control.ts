import type { ProviderName } from './container/types.ts';

const PROVIDERS = new Set<ProviderName>(['binance', 'bybit', 'okx', 'hyperliquid', 'upbit']);

export function parseProviderFaultPath(pathname: string): ProviderName | null {
  const match = /^\/control\/providers\/([a-z]+)\/disconnect$/.exec(pathname);
  const provider = match?.[1] as ProviderName | undefined;
  return provider && PROVIDERS.has(provider) ? provider : null;
}

export function parseFaultDuration(value: string | null): number {
  const duration = Number(value ?? '30');
  if (!Number.isInteger(duration) || duration < 5 || duration > 300) {
    throw new Error('durationSeconds must be an integer from 5 to 300');
  }
  return duration;
}

export function faultInjectionAllowed(environment: string): boolean {
  return environment === 'local' || environment === 'staging';
}

export function containerNeedsStart(
  status: 'running' | 'stopping' | 'stopped' | 'healthy' | 'stopped_with_code'
): boolean {
  return status !== 'healthy' && status !== 'running';
}

export function healthRequestAuthorized(
  authorization: string | null,
  environment: string,
  controlToken?: string,
  operationsReadSecret?: string
): boolean {
  if (!controlToken && environment === 'local') return true;
  return Boolean(
    authorization &&
    ((controlToken && authorization === `Bearer ${controlToken}`) ||
      (operationsReadSecret && authorization === `Bearer ${operationsReadSecret}`))
  );
}
