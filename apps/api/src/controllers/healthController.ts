import type { Request, Response } from 'express';
import { successResponse } from '../utils/response';
import { testDatabaseConnection } from '../utils/supabase';
import { cacheService } from '../services/cacheService';

/**
 * Provides operational status for the API, cache, and optional database.
 * Used by both the public /health and versioned /api/v1/health endpoints.
 */
async function buildHealthData() {
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
  };
}

export const healthController = {
  /**
   * GET /health or /api/v1/health
   */
  async getHealth(_req: Request, res: Response) {
    const data = await buildHealthData();
    return successResponse(res, data);
  },
};
