import { describe, expect, test } from 'bun:test';
import { runHealthProbe, signedProbePayload } from './probe';

describe('external API health probe', () => {
  test('binds signed reports to their exact body', () => {
    expect(signedProbePayload(123, '{"success":true}')).toBe('123.{"success":true}');
    expect(signedProbePayload(123, '')).toBe('123.');
  });

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
