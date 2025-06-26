import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { errorResponse } from './utils/response';

// Load environment variables from .env file
dotenv.config();

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Mount API routes under /api/v1 prefix
app.use('/api/v1', routes);

// Health check endpoint for monitoring
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
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
  console.log(`Lazuli API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API endpoints: http://localhost:${PORT}/api/v1`);
});