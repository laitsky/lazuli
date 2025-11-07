# Lazuli - Cryptocurrency Trading Tool

A modern full-stack monorepo application that provides **real-time** cryptocurrency data from multiple exchanges including Binance, Bybit, OKX, and Hyperliquid.

**🚀 Ready to use immediately** - no database setup required for live trading data!

## Features

- 📊 **Beautiful Web Interface** - Modern Next.js frontend with real-time data
- 🔌 **REST API** - Powerful TypeScript backend with Express.js
- 💱 **Multi-Exchange Support** - Binance, Bybit, OKX, and Hyperliquid
- 🎯 **Live Trading Data** - Real-time prices, volumes, and market statistics
- 📈 **Spot & Perpetual Markets** - Support for both market types
- 🎨 **Modern UI** - Built with Shadcn UI and Tailwind CSS
- 💾 **Optional Database** - PostgreSQL for historical data (optional)
- 🏗️ **Monorepo Structure** - Industry-standard npm workspaces

## Project Structure

```
lazuli/
├── apps/
│   ├── api/              # Backend REST API (Express.js + TypeScript)
│   │   ├── src/          # Source code
│   │   ├── .env.example  # Environment template
│   │   └── package.json  # API dependencies
│   └── web/              # Frontend (Next.js 16 + Shadcn UI)
│       ├── app/          # Next.js pages & routes
│       ├── components/   # React components
│       ├── lib/          # Utilities & API client
│       └── package.json  # Web dependencies
├── packages/
│   └── shared/           # Shared types between API and Web
│       └── src/          # TypeScript interfaces
├── package.json          # Root workspace configuration
└── README.md             # This file
```

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

1. **Clone and install all dependencies:**

```bash
git clone <repository-url>
cd lazuli
npm install
```

This will install dependencies for all workspaces (API, Web, and Shared).

### Running the Applications

**Option 1: Run both applications together**

```bash
npm run dev:all
```

**Option 2: Run individually**

API only (port 3000):
```bash
npm run dev:api
```

Web only (port 3001):
```bash
npm run dev:web
```

### Environment Configuration

**Backend API:**
```bash
cd apps/api
cp .env.example .env
# Edit .env with your configuration
```

**Frontend Web:**
```bash
cd apps/web
cp .env.example .env.local
# Edit .env.local - set NEXT_PUBLIC_API_URL if needed
```

## Available Scripts

From the root directory:

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API in development mode |
| `npm run dev:api` | Run API only |
| `npm run dev:web` | Run Web only |
| `npm run dev:all` | Run both API and Web |
| `npm run build` | Build all workspaces |
| `npm run build:api` | Build API only |
| `npm run build:web` | Build Web only |
| `npm run lint` | Lint all workspaces |
| `npm run clean` | Clean all node_modules and build artifacts |

## API Endpoints

Base URL: `http://localhost:3000/api/v1`

### Core Endpoints (Live Data - No DB Required)
- `GET /exchanges` - List all supported exchanges
- `GET /tickers/:exchange` - Get all tickers for an exchange
- `GET /tickers/:exchange/:symbol` - Get specific ticker data
- `GET /markets/:exchange` - Get all available markets

### Optional Database Endpoints
- `POST /data/store/:exchange` - Store live ticker data
- `GET /data/history/:symbol` - Get historical data
- `GET /data/latest/:exchange/:symbol` - Get latest stored ticker
- `DELETE /data/cleanup` - Clean up old data

## Web Interface

Access the web interface at `http://localhost:3001`

**Pages:**
- **/** - Dashboard with system status and exchange overview
- **/exchanges** - List of all supported exchanges
- **/tickers** - Live price data with search and filtering
- **/markets** - Browse all available trading pairs

**Features:**
- 🔍 Advanced search and filtering
- 📊 Sortable tables by price, volume, and change
- 🌙 Dark mode support
- 📱 Fully responsive design
- ⚡ Real-time data updates

## Monorepo Architecture

Lazuli uses **npm workspaces** for monorepo management:

- **Shared Types**: Common TypeScript interfaces in `packages/shared`
- **Independent Apps**: Separate `package.json` for API and Web
- **Unified Dependencies**: Shared dependencies hoisted to root
- **Workspace Commands**: Run scripts across all or specific packages

### Benefits

- ✅ Type safety across frontend and backend
- ✅ Single `npm install` for entire project
- ✅ Consistent tooling and versions
- ✅ Easy to add new packages/apps
- ✅ Industry-standard structure

## Tech Stack

### Backend (apps/api)
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Exchange APIs**: CCXT (Binance, Bybit, OKX) + Hyperliquid REST API
- **Database**: Supabase (PostgreSQL) - Optional
- **Documentation**: OpenAPI 3.0 with Stoplight Elements

### Frontend (apps/web)
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: Shadcn UI
- **Icons**: Lucide React
- **State**: React Hooks

### Shared (packages/shared)
- TypeScript interfaces
- API response types
- Common type definitions

## Development Guidelines

- See [apps/api/CLAUDE.md](apps/api/CLAUDE.md) for backend development guidelines
- See [apps/web/README.md](apps/web/README.md) for frontend-specific documentation
- See [apps/api/TODO.md](apps/api/TODO.md) for feature roadmap

## Database Setup (Optional)

**Only needed for advanced features:**

1. Copy `apps/api/database-setup.sql` content
2. Run in your Supabase SQL Editor (one-time setup)
3. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `apps/api/.env`
4. Use `/data/*` endpoints for historical analysis

## Contributing

1. Create feature branches
2. Write descriptive commit messages
3. Test with `npm run lint` and `npm run build`
4. Update documentation as needed

## License

ISC
