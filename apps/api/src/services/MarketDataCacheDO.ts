/**
 * MarketDataCacheDO - Durable Object shell.
 *
 * This singleton DO will eventually replace the marketDataWorker + cacheService
 * + redisCacheService from the Bun era. For the foundation milestone it only
 * provides an empty fetch handler and alarm method so the Worker can boot and
 * the binding is wired correctly. Alarm/polling logic is added in a later
 * milestone.
 */

import { DurableObject } from 'cloudflare:workers';

export class MarketDataCacheDO extends DurableObject {
  /**
   * Request handler. Future milestones will route cache reads/writes here.
   * For now we return a simple health payload so wiring can be verified.
   */
  async fetch(_request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'MarketDataCacheDO is alive',
        timestamp: Date.now(),
      }),
      {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }
    );
  }

  /**
   * Alarm handler. Will poll exchanges via CCXT every 5s (ticker loop) and
   * every 2min (OHLCV/screener warming) once implemented. The shell simply
   * logs that it fired.
   */
  async alarm(): Promise<void> {
    console.log(JSON.stringify({ module: 'MarketDataCacheDO', msg: 'alarm fired (shell)' }));
  }
}
