/**
 * Exchange Routes for Elysia
 * Handles requests for exchange information and capabilities
 */

import { Elysia } from 'elysia';
import { successResponse } from '../utils/response';
import { ExchangeInfo } from '../types';

// Static list of supported exchanges and their capabilities
const exchanges: ExchangeInfo[] = [
  {
    name: 'Binance',
    id: 'binance',
    supported: true,
    hasSpot: true,
    hasPerp: true,
  },
  {
    name: 'Bybit',
    id: 'bybit',
    supported: true,
    hasSpot: true,
    hasPerp: true,
  },
  {
    name: 'OKX',
    id: 'okx',
    supported: true,
    hasSpot: true,
    hasPerp: true,
  },
  {
    name: 'Hyperliquid',
    id: 'hyperliquid',
    supported: true,
    hasSpot: false,
    hasPerp: true,
  },
  {
    name: 'Upbit',
    id: 'upbit',
    supported: true,
    hasSpot: true,
    hasPerp: false,
  },
];

/**
 * Exchange routes plugin
 */
export const exchangeRoutes = new Elysia({ prefix: '/exchanges' })
  // GET /api/v1/exchanges - List all supported exchanges
  .get('/', () => {
    return successResponse(exchanges);
  });
