# Lazuli - Cryptocurrency Trading Tool

A REST API service that provides **real-time** cryptocurrency data from multiple exchanges including Binance, Bybit, OKX, and Hyperliquid.

**🚀 Ready to use immediately** - no database setup required for live trading data!

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Run development server:
```bash
npm run dev
```

## API Endpoints

Base URL: `http://localhost:3000/api/v1`

### 🔥 Live Trading Data (No DB Required)
- `GET /exchanges` - List all supported exchanges
- `GET /tickers/:exchange` - Get all tickers for an exchange (binance, bybit, okx, hyperliquid)
- `GET /tickers/:exchange/:symbol` - Get specific ticker data
- `GET /markets/:exchange` - Get all available markets for an exchange

### 💾 Optional Database Features (Advanced Use Only)
*Only needed for historical analysis, alerts, or custom features*
- `POST /data/store/:exchange` - Store live ticker data for an exchange
- `GET /data/history/:symbol?exchange=X&limit=100` - Get historical ticker data
- `GET /data/latest/:exchange/:symbol` - Get latest stored ticker for a symbol
- `POST /data/markets/:exchange` - Store market information for an exchange
- `DELETE /data/cleanup?days=30` - Clean up old ticker data

## Example Usage

### 🚀 Ready to Use (Live Data)
```bash
# List exchanges
curl http://localhost:3000/api/v1/exchanges

# Get all Binance tickers (live prices)
curl http://localhost:3000/api/v1/tickers/binance

# Get specific ticker (real-time)
curl http://localhost:3000/api/v1/tickers/binance/BTC/USDT

# Get Hyperliquid markets
curl http://localhost:3000/api/v1/markets/hyperliquid
```

### 💾 Advanced Features (Optional DB Setup Required)
```bash
# Store live Binance ticker data
curl -X POST http://localhost:3000/api/v1/data/store/binance

# Get historical data for BTC/USDT
curl http://localhost:3000/api/v1/data/history/BTC/USDT?exchange=binance&limit=50
```

## Database Setup (Optional)

**Only needed if you want to use `/data/*` endpoints for advanced features:**

1. Copy the content of `database-setup.sql` 
2. Run it in your Supabase SQL Editor (one-time setup)
3. Start using database endpoints for historical data, alerts, etc.

## Development

- Run development server: `npm run dev`
- Build for production: `npm run build`
- Run production build: `npm start`
- Type checking: `npm run lint`

See CLAUDE.md for detailed development guidelines and TODO.md for feature roadmap.