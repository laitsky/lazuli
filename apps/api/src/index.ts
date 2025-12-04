import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import routes from './routes';
import { cacheService } from './services/cacheService';
import { ccxtService } from './services/ccxtService';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler';
import { healthController } from './controllers/healthController';

// Load environment variables from .env file
// Try loading from multiple locations to support both direct run and turborepo
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // apps/api/.env
dotenv.config(); // Root .env (won't override existing vars)

// Initialize cache service (connects to Redis if enabled)
cacheService.initialize().catch((err) => {
  console.error('Failed to initialize cache service:', err);
});

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
// Enable Cross-Origin Resource Sharing with Private Network Access support
// The 'Access-Control-Allow-Origin' header is set based on environment:
// - Production: Only allow the specific frontend origin
// - Development: Allow all origins
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['https://lazuli.now'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, origin); // Return the specific origin, not true
      }
      return callback(null, false);
    },
    credentials: true, // Enable credentials for Try It functionality
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Mount API routes under /api/v1 prefix
app.use('/api/v1', routes);

// Redirect root endpoint to API documentation
app.get('/', (_req, res) => {
  res.redirect('/api/v1/docs');
});

// Health check endpoint for monitoring
app.get('/health', async (req, res) => {
  await healthController.getHealth(req, res);
});

// Handle 404 errors for undefined routes using standardized error handling
app.use(notFoundHandler);

// Global error handler for unhandled errors using standardized error handling
// This catches all errors thrown in route handlers and services
app.use(globalErrorHandler);

// Start the server
// Bind to 0.0.0.0 to accept connections from any network interface (required for Docker)
const HOST = process.env.HOST || '0.0.0.0';
app.listen(Number(PORT), HOST, () => {
  console.log(`🚀 Lazuli API server running on port ${PORT}`);
  console.log(`📊 Live data endpoints: http://localhost:${PORT}/api/v1`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api/v1/docs`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Ready to serve real-time cryptocurrency data!`);
  console.log('');
  console.log('📋 Available exchanges: Binance, Bybit, OKX, Hyperliquid, Upbit');
  console.log('💡 Database features are optional - see /data/* endpoints');
  console.log('🔧 Interactive API testing available at /api/v1/docs');

  // Pre-warm exchange markets in background to speed up first requests
  // This loads market data for all exchanges so API responses are fast
  ccxtService.warmup().catch((err) => {
    console.error('Failed to warm up exchange markets:', err);
  });
});
