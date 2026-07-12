import { describe, expect, test } from 'bun:test';
import { fetchBybitOrderbook } from './bybit-rest';

describe('Bybit REST snapshot fallback', () => {
  test('falls through to the official secondary host', async () => {
    const requested: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('api.bybit.com')) return new Response('', { status: 403 });
      return Response.json({ retCode: 0, result: { u: 42, b: [], a: [] } });
    }) as typeof fetch;

    const snapshot = await fetchBybitOrderbook('BTCUSDT', mockFetch);

    expect(snapshot.host).toBe('api.bytick.com');
    expect(snapshot.result.u).toBe(42);
    expect(requested).toHaveLength(2);
  });

  test('reports every host failure without returning fabricated data', async () => {
    const mockFetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;

    await expect(fetchBybitOrderbook('BTCUSDT', mockFetch)).rejects.toThrow(
      'api.bybit.com: HTTP 403; api.bytick.com: HTTP 403'
    );
  });
});
