import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { errorResponse } from './utils/response';
import { testDatabaseConnection } from './utils/supabase';

// Load environment variables from .env file
dotenv.config();

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true, // Enable credentials for Try It functionality
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
})); // Enable Cross-Origin Resource Sharing
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
  
  res.json({ 
    status: 'ok', 
    api: 'ready',
    database: dbStatus,
    exchanges: ['binance', 'bybit', 'okx', 'hyperliquid'],
    timestamp: Date.now() 
  });
});

// Handle 404 errors for undefined routes
app.use((_req, res) => {
  errorResponse(res, 'Route not found', 404);
});

// Global error handler for unhandled errors
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  errorResponse(res, err.message || 'Internal server error', 500);
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Lazuli API server running on port ${PORT}`);
  console.log(`📊 Live data endpoints: http://localhost:${PORT}/api/v1`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api/v1/docs`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Ready to serve real-time cryptocurrency data!`);
  console.log('');
  console.log('📋 Available exchanges: Binance, Bybit, OKX, Hyperliquid');
  console.log('💡 Database features are optional - see /data/* endpoints');
  console.log('🔧 Interactive API testing available at /api/v1/docs');
});