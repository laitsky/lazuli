# Lazuli Development Guidelines

## Project Overview
Lazuli is a cryptocurrency trading tool that provides **real-time** data from multiple exchanges to help traders make informed decisions. Implemented as a REST API with TypeScript.

**Core Philosophy**: Prioritize live data from exchanges directly. Database features are optional for advanced use cases only.

## Architecture
- **Language**: TypeScript with strict type checking
- **Framework**: Express.js REST API
- **Primary Data**: Live exchange APIs (CCXT + Hyperliquid)
- **Database**: Supabase (PostgreSQL) - **OPTIONAL** for advanced features
- **Exchanges**: CCXT (Binance, Bybit, OKX) + Hyperliquid
- **Future**: May expand to web interface or Telegram bot

## Development Workflow

### Running the Project
```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Type checking
npm run lint
```

### Project Structure
```
src/
├── index.ts          # Express server entry point
├── routes/           # API route definitions
├── controllers/      # Request handlers
├── services/         # Business logic and external integrations
├── types/            # TypeScript type definitions
└── utils/            # Helper functions
```

### Code Standards
1. **TypeScript**: Use strict mode, explicit typing, no any types
2. **Error Handling**: Proper try-catch blocks with descriptive errors
3. **API Design**: RESTful conventions, versioned endpoints (/api/v1/)
4. **Code Comments**: MANDATORY - Add comprehensive comments to explain:
   - What each function/method does
   - Purpose of complex logic or algorithms
   - API integrations and data transformations
   - Business logic and trading-specific calculations
   - Error handling strategies
   - Configuration and setup steps
5. **Response Format**: Consistent JSON structure
   ```json
   {
     "success": boolean,
     "data": any,
     "error": string | null,
     "timestamp": number
   }
   ```

### Environment Variables
Create `.env` file (use `.env.example` as template):
```
PORT=3000
NODE_ENV=development
SUPABASE_URL=https://jaxglbziswzllhrxcnyp.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### Database Integration (Optional)
- **Purpose**: Only for advanced features (historical data, alerts, analytics)
- **Primary Use**: Live exchange data via APIs (no database needed)
- **Supabase**: PostgreSQL database with REST API (when needed)
- **Client**: `@supabase/supabase-js` for database operations
- **Health Check**: `/health` endpoint includes optional database status
- **Setup**: Only required if using `/data/*` endpoints

### Testing Commands
Always run these before committing:
```bash
npm run lint
```

### API Endpoints Structure

#### Core Endpoints (Live Data - No DB)
- `GET /api/v1/exchanges` - List supported exchanges
- `GET /api/v1/tickers/:exchange` - Get all tickers for an exchange
- `GET /api/v1/tickers/:exchange/:symbol` - Get specific ticker
- `GET /api/v1/markets/:exchange` - Get all markets (spot/perp)

#### Advanced Endpoints (Optional DB Features)
- `POST /api/v1/data/store/:exchange` - Store live data
- `GET /api/v1/data/history/:symbol` - Historical data
- `GET /api/v1/data/latest/:exchange/:symbol` - Latest stored
- `DELETE /api/v1/data/cleanup` - Cleanup old data

### Integration Notes

#### CCXT
- Supports multiple exchanges with unified API
- Handle rate limits appropriately
- Implement caching for frequent requests

#### Hyperliquid
- Uses custom REST API implementation
- Endpoint: https://api.hyperliquid.xyz/info
- Requires special handling for perp markets

### Security Best Practices
1. Never commit sensitive credentials
2. Use environment variables for all secrets
3. Implement rate limiting on API endpoints
4. Validate all input parameters
5. Use CORS appropriately

### Performance Considerations
1. Implement caching for ticker data (Redis in future)
2. Use pagination for large datasets
3. Implement WebSocket connections for real-time data (future)
4. Monitor API rate limits for each exchange

### Debugging Tips
1. Use proper logging (consider Winston/Pino)
2. Include request IDs for tracing
3. Log exchange API responses for debugging
4. Use TypeScript source maps in development

### Git Workflow
1. Create feature branches
2. Write descriptive commit messages
3. Keep commits atomic and focused
4. Update TODO.md with completed/new features