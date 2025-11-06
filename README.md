# Lazuli - Cryptocurrency Trading Tool

A full-stack application that provides **real-time** cryptocurrency data from multiple exchanges including Binance, Bybit, OKX, and Hyperliquid.

**🚀 Ready to use immediately** - no database setup required for live trading data!

## Features

- 📊 **Beautiful Web Interface** - Modern Next.js frontend with real-time data
- 🔌 **REST API** - Powerful TypeScript backend with Express.js
- 💱 **Multi-Exchange Support** - Binance, Bybit, OKX, and Hyperliquid
- 🎯 **Live Trading Data** - Real-time prices, volumes, and market statistics
- 📈 **Spot & Perpetual Markets** - Support for both market types
- 🎨 **Modern UI** - Built with Shadcn UI and Tailwind CSS
- 💾 **Optional Database** - PostgreSQL for historical data (optional)

## Project Structure

```
lazuli/
├── src/              # Backend API (Express.js + TypeScript)
│   ├── controllers/  # Request handlers
│   ├── routes/       # API route definitions
│   ├── services/     # Business logic & exchange integrations
│   └── types/        # TypeScript type definitions
├── web/              # Frontend (Next.js 15 + Shadcn UI)
│   ├── app/          # Next.js pages (Dashboard, Exchanges, Tickers, Markets)
│   ├── components/   # React components
│   └── lib/          # API client & utilities
└── package.json      # Backend dependencies
```

## Quick Start

### Backend API

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

The API will be available at `http://localhost:3000`

### Web Frontend

1. Navigate to web directory:
```bash
cd web
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env.local
```

4. Run development server:
```bash
npm run dev
```

The web interface will be available at `http://localhost:3001`

**For detailed frontend setup and features, see [web/README.md](web/README.md)**

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

### Backend (API)
- Run development server: `npm run dev` (port 3000)
- Build for production: `npm run build`
- Run production build: `npm start`
- Type checking: `npm run lint`

### Frontend (Web)
- Run development server: `cd web && npm run dev` (port 3001)
- Build for production: `cd web && npm run build`
- Run production build: `cd web && npm start`

## Web Interface Features

The web frontend provides a beautiful interface for:

- **Dashboard** - System status, exchange overview, and quick access
- **Exchanges** - View all supported exchanges and their capabilities
- **Live Tickers** - Real-time price data with advanced search and filtering
- **Markets** - Browse all available trading pairs across exchanges

Key Features:
- 🔍 Advanced search and filtering
- 📊 Sortable tables by price, volume, and change
- 🌙 Dark mode support
- 📱 Fully responsive design
- ⚡ Real-time data updates
- 🎨 Modern UI with Shadcn components

## Documentation

- [CLAUDE.md](CLAUDE.md) - Development guidelines and project philosophy
- [TODO.md](TODO.md) - Feature roadmap and upcoming features
- [web/README.md](web/README.md) - Frontend-specific documentation
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture details

## Tech Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Exchange APIs**: CCXT (Binance, Bybit, OKX) + Hyperliquid REST API
- **Database**: Supabase (PostgreSQL) - Optional
- **Documentation**: OpenAPI 3.0 with Stoplight Elements

### Frontend
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: Shadcn UI
- **Icons**: Lucide React
- **Deployment**: Static export or Node.js server