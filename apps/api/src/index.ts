import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { successResponse } from './utils/response';
import { testDatabaseConnection } from './utils/supabase';
import { cacheService } from './services/cacheService';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler';

// Load environment variables from .env file
dotenv.config();

// Initialize cache service (connects to Redis if enabled)
cacheService.initialize().catch((err) => {
  console.error('Failed to initialize cache service:', err);
});

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
app.use(
  cors({
    origin: true, // Allow all origins in development
    credentials: true, // Enable credentials for Try It functionality
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Mount API routes under /api/v1 prefix
app.use('/api/v1', routes);

// Redirect root endpoint to API documentation
app.get('/', (_req, res) => {
  res.redirect('/api/v1/docs');
});

// Health check endpoint for monitoring
app.get('/health', async (_req, res) => {
  // Test database connection only if database features are being used
  let dbStatus = 'not_required';
  try {
    const hasDbCredentials = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY;
    if (hasDbCredentials) {
      const connected = await testDatabaseConnection();
      dbStatus = connected ? 'connected' : 'disconnected';
    }
  } catch (error) {
    dbStatus = 'error';
  }

  // Get cache status and statistics
  const cacheStats = cacheService.getStats();
  const cacheStatus = {
    backend: cacheStats.backend,
    redisConnected: cacheStats.redisConnected,
    hitRatio: cacheStats.hitRatio,
    size: cacheStats.size,
  };

  // Return health data in standard API response format
  successResponse(res, {
    status: 'ok',
    api: 'ready',
    database: dbStatus,
    cache: cacheStatus,
    exchanges: ['binance', 'bybit', 'okx', 'hyperliquid', 'upbit'],
    timestamp: Date.now(),
  });
});

// Handle 404 errors for undefined routes using standardized error handling
app.use(notFoundHandler);

// Global error handler for unhandled errors using standardized error handling
// This catches all errors thrown in route handlers and services
app.use(globalErrorHandler);

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Lazuli API server running on port ${PORT}`);
  console.log(`📊 Live data endpoints: http://localhost:${PORT}/api/v1`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api/v1/docs`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Ready to serve real-time cryptocurrency data!`);
  console.log('');
  console.log('📋 Available exchanges: Binance, Bybit, OKX, Hyperliquid, Upbit');
  console.log('💡 Database features are optional - see /data/* endpoints');
  console.log('🔧 Interactive API testing available at /api/v1/docs');
});
