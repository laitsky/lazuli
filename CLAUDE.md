# Lazuli Development Guidelines

## Project Overview
Lazuli is a cryptocurrency trading tool that aggregates data from multiple exchanges to help traders make informed decisions. Currently implemented as a REST API with TypeScript.

## Architecture
- **Language**: TypeScript with strict type checking
- **Framework**: Express.js REST API
- **Database**: Supabase (PostgreSQL) - credentials to be provided
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
Create `.env` file:
```
PORT=3000
NODE_ENV=development
SUPABASE_URL=<to-be-provided>
SUPABASE_ANON_KEY=<to-be-provided>
```

### Testing Commands
Always run these before committing:
```bash
npm run lint
```

### API Endpoints Structure
- `GET /api/v1/exchanges` - List supported exchanges
- `GET /api/v1/tickers/:exchange` - Get all tickers for an exchange
- `GET /api/v1/tickers/:exchange/:symbol` - Get specific ticker
- `GET /api/v1/markets/:exchange` - Get all markets (spot/perp)

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