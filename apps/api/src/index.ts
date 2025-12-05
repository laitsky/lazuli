import './config/environment';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import dotenv from 'dotenv';
import path from 'path';

// Import routes
import { exchangeRoutes } from './routes/exchanges';
import { tickerRoutes } from './routes/tickers';
import { ohlcvRoutes } from './routes/ohlcv';
import { healthRoutes } from './routes/health';
import { fundingRoutes } from './routes/funding';
import { dataRoutes } from './routes/data';
import { docsRoutes } from './routes/docs';
import { customIndexRoutes } from './routes/customIndex';
import { customPairRoutes } from './routes/customPair';
import { superEmaRoutes } from './routes/superEma';
import { screenerRoutes } from './routes/screener';
import { indicatorRoutes } from './routes/indicators';
import { orderBookRoutes } from './routes/orderBook';

// Import services
import { cacheService } from './services/cacheService';
import { ccxtService } from './services/ccxtService';

// Import utilities
import { createServiceLogger, logTransportStatus } from './utils/logger';
import { errorPlugin } from './plugins/error';
import { loggingPlugin } from './plugins/logging';

// Create logger for server initialization
const log = createServiceLogger('server');

// Load environment variables from .env file
// Try loading from multiple locations to support both direct run and turborepo
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // apps/api/.env
dotenv.config(); // Root .env (won't override existing vars)

// Initialize cache service (connects to Redis if enabled)
cacheService.initialize().catch((err) => {
  log.error('Failed to initialize cache service', err);
});

// Server configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Configure allowed origins for CORS
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['https://lazuli.now'];

// Create Elysia application
const app = new Elysia()
  // Configure CORS middleware
  .use(
    cors({
      origin: allowedOrigins.includes('*') ? true : allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  )
  // Apply custom plugins
  .use(loggingPlugin)
  .use(errorPlugin)
  // Mount API v1 routes
  .group('/api/v1', (app) =>
    app
      .use(exchangeRoutes)
      .use(tickerRoutes)
      .use(ohlcvRoutes)
      .use(healthRoutes)
      .use(fundingRoutes)
      .use(dataRoutes)
      .use(docsRoutes)
      .use(customIndexRoutes)
      .use(customPairRoutes)
      .use(superEmaRoutes)
      .use(screenerRoutes)
      .use(indicatorRoutes)
      .use(orderBookRoutes)
  )
  // Root redirect to API documentation
  .get('/', ({ redirect }) => redirect('/api/v1/docs'))
  // Health check endpoint for monitoring (also available at /api/v1/health)
  .get('/health', async () => {
    const { buildHealthData } = await import('./routes/health');
    return buildHealthData();
  })
  // Start the server
  .listen({
    port: Number(PORT),
    hostname: HOST,
  });

// Log startup information
logTransportStatus();

log.info('Server started', {
  port: PORT,
  host: HOST,
  nodeEnv: process.env.NODE_ENV || 'development',
});

log.info('Endpoints available', {
  api: `http://localhost:${PORT}/api/v1`,
  docs: `http://localhost:${PORT}/api/v1/docs`,
  health: `http://localhost:${PORT}/health`,
});

log.info('Supported exchanges: Binance, Bybit, OKX, Hyperliquid, Upbit');

// Pre-warm exchange markets in background to speed up first requests
// This loads market data for all exchanges so API responses are fast
ccxtService.warmup().catch((err) => {
  log.error('Failed to warm up exchange markets', err);
});

// Export app for testing purposes
export { app };

// Export app type for type inference in routes
export type App = typeof app;
