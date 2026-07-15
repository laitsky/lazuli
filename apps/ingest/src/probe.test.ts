import { describe, expect, test } from 'bun:test';
import { runHealthProbe } from './probe';

describe('external API health probe', () => {
  test('records a successful service-isolation response', async () => {
    const result = await runHealthProbe(
      'https://api-worker.example/path',
      async () => new Response(null, { status: 200 })
    );
    expect(result).toMatchObject({
      probe: 'api',
      target: 'https://api-worker.example/health',
      success: true,
      statusCode: 200,
      errorCode: null,
    });
  });

  test('reports failures without throwing away the observation', async () => {
    const result = await runHealthProbe('https://api-worker.example', async () => {
      throw new TypeError('network unavailable');
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.errorCode).toBe('TypeError');
  });
});
