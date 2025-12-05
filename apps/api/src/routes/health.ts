/**
 * Health Routes for Elysia
 * Provides operational status for the API, cache, and optional database
 */

import { Elysia } from 'elysia';
import { testDatabaseConnection } from '../utils/supabase';
import { cacheService } from '../services/cacheService';

/**
 * Build health check data
 * Exported for use in root /health endpoint
 */
export async function buildHealthData() {
  let database = 'not_required';

  try {
    const hasDbCredentials = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY;
    if (hasDbCredentials) {
      const connected = await testDatabaseConnection();
      database = connected ? 'connected' : 'disconnected';
    }
  } catch {
    database = 'error';
  }

  const cacheStats = cacheService.getStats();

  return {
    success: true,
    data: {
      status: 'ok' as const,
      api: 'ready' as const,
      database,
      cache: {
        backend: cacheStats.backend,
        redisConnected: cacheStats.redisConnected,
        hitRatio: cacheStats.hitRatio,
        size: cacheStats.size,
      },
      exchanges: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'],
      timestamp: Date.now(),
    },
    error: null,
    timestamp: Date.now(),
  };
}

/**
 * Health routes plugin
 */
export const healthRoutes = new Elysia({ prefix: '/health' })
  // GET /api/v1/health - API health status
  .get('/', async () => {
    return buildHealthData();
  });
