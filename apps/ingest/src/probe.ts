export interface HealthProbeResult {
  probe: 'api';
  target: string;
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  errorCode: string | null;
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function runHealthProbe(
  baseUrl: string,
  fetchImplementation: FetchImplementation = fetch
): Promise<HealthProbeResult> {
  const target = new URL('/health', baseUrl);
  const startedAt = Date.now();
  let success = false;
  let statusCode: number | null = null;
  let errorCode: string | null = null;
  try {
    const response = await fetchImplementation(target, { signal: AbortSignal.timeout(8_000) });
    statusCode = response.status;
    success = response.ok;
  } catch (error) {
    errorCode = (error instanceof Error ? error.name : 'probe_error').slice(0, 80);
  }
  return {
    probe: 'api',
    target: `${target.origin}${target.pathname}`,
    success,
    statusCode,
    latencyMs: Date.now() - startedAt,
    errorCode,
  };
}
