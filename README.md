# Lazuli - Cryptocurrency Trading Tool

A REST API service that aggregates cryptocurrency data from multiple exchanges including Binance, Bybit, OKX, and Hyperliquid.

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

- `GET /exchanges` - List all supported exchanges
- `GET /tickers/:exchange` - Get all tickers for an exchange (binance, bybit, okx, hyperliquid)
- `GET /tickers/:exchange/:symbol` - Get specific ticker data
- `GET /markets/:exchange` - Get all available markets for an exchange

## Example Usage

```bash
# List exchanges
curl http://localhost:3000/api/v1/exchanges

# Get all Binance tickers
curl http://localhost:3000/api/v1/tickers/binance

# Get specific ticker
curl http://localhost:3000/api/v1/tickers/binance/BTC/USDT

# Get Hyperliquid markets
curl http://localhost:3000/api/v1/markets/hyperliquid
```

## Development

- Run development server: `npm run dev`
- Build for production: `npm run build`
- Run production build: `npm start`
- Type checking: `npm run lint`

See CLAUDE.md for detailed development guidelines and TODO.md for feature roadmap.