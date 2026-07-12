import { record } from './event';

export const BYBIT_REST_HOSTS = ['api.bybit.com', 'api.bytick.com'] as const;

export async function fetchBybitOrderbook(
  symbol: string,
  fetchImplementation: typeof fetch = fetch,
  hosts: readonly string[] = BYBIT_REST_HOSTS
): Promise<{ envelope: Record<string, unknown>; result: Record<string, unknown>; host: string }> {
  const failures: string[] = [];
  for (const host of hosts) {
    try {
      const response = await fetchImplementation(
        `https://${host}/v5/market/orderbook?category=linear&symbol=${symbol}&limit=50`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const envelope = record(await response.json());
      if (Number(envelope.retCode) !== 0) {
        throw new Error(`retCode ${String(envelope.retCode)}`);
      }
      return { envelope, result: record(envelope.result), host };
    } catch (error) {
      failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(failures.join('; '));
}
