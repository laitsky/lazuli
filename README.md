# Lazuli - Cryptocurrency Trading Tool

A modern full-stack monorepo application that provides **real-time** cryptocurrency data from multiple exchanges including Binance, Bybit, and OKX.

**🚀 Ready to use immediately** - no database setup required for live trading data!

## Features

- 📊 **Beautiful Web Interface** - Modern Next.js frontend with real-time data
- 🔌 **REST API** - Bun-native TypeScript backend with Elysia
- 💱 **Multi-Exchange Support** - Binance, Bybit, and OKX
- 🎯 **Live Trading Data** - Real-time prices, volumes, and market statistics
- 📈 **Spot & Perpetual Markets** - Support for both market types
- 🎨 **Modern UI** - Built with Shadcn UI and Tailwind CSS
- 💾 **Optional Database** - PostgreSQL for historical data (optional)
- 🏗️ **Monorepo Structure** - Industry-standard Turborepo with Bun
- ⚡ **Fast Runtime** - Built with Bun for maximum performance

## Project Structure

```
lazuli/
├── apps/
│   ├── api/              # Backend REST API (Elysia + TypeScript)
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

- Bun >= 1.0.0 (Install from https://bun.sh)

### Installation

1. **Clone and install all dependencies:**

```bash
git clone <repository-url>
cd lazuli
bun install
```

This will install dependencies for all workspaces (API, Web, and Shared) using Bun's fast package manager.

### Running the Applications

**Option 1: Run both applications together**

```bash
bun run dev
```

**Option 2: Run individually**

API only (port 3000):

```bash
bun run dev:api
```

Web only (port 3001):

```bash
bun run dev:web
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

| Command              | Description                              |
| -------------------- | ---------------------------------------- |
| `bun run dev`        | Run both API and Web in development mode |
| `bun run dev:api`    | Run API only                             |
| `bun run dev:web`    | Run Web only                             |
| `bun run build`      | Build all workspaces                     |
| `bun run build:api`  | Build API only                           |
| `bun run build:web`  | Build Web only                           |
| `bun run lint`       | Lint all workspaces                      |
| `bun run type-check` | Type check all workspaces                |
| `bun run format`     | Format all code                          |
| `bun run clean`      | Clean all build artifacts                |

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

Lazuli uses **Turborepo** with **Bun workspaces** for monorepo management:

- **Fast Builds**: Turborepo's intelligent caching and task orchestration
- **Shared Types**: Common TypeScript interfaces in `packages/shared`
- **Independent Apps**: Separate `package.json` for API and Web
- **Unified Dependencies**: Shared dependencies hoisted to root
- **Parallel Execution**: Run tasks across workspaces simultaneously

### Benefits

- ⚡ Lightning-fast package installation with Bun (up to 25x faster)
- ✅ Type safety across frontend and backend
- ✅ Single `bun install` for entire project
- 🚀 Parallel builds and incremental caching with Turborepo
- ✅ Consistent tooling and versions
- ✅ Easy to add new packages/apps
- ✅ Industry-standard structure

## Tech Stack

### Backend (apps/api)

- **Runtime**: Bun with native TypeScript support
- **Framework**: Elysia (Bun-native HTTP framework)
- **Exchange APIs**: CCXT (Binance, Bybit, OKX)
- **Database**: Supabase (PostgreSQL) - Optional
- **Documentation**: OpenAPI 3.0 with Stoplight Elements
- **Dev Mode**: Built-in watch mode with `bun --watch`

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

## Why Bun?

Lazuli has migrated from Node.js/npm to Bun for significant performance improvements:

- ⚡ **25x faster** package installation compared to npm
- 🚀 **Native TypeScript** support - no need for tsx, ts-node, or build steps in development
- 🔥 **Built-in watch mode** - faster hot reload with `bun --watch`
- 📦 **Drop-in replacement** - compatible with Node.js packages and APIs
- 💾 **Lower memory usage** - more efficient runtime
- 🛠️ **All-in-one tool** - package manager, bundler, and runtime combined

To migrate from npm to Bun:

1. Install Bun: `curl -fsSL https://bun.sh/install | bash`
2. Remove `node_modules` and `package-lock.json`
3. Run `bun install` to generate `bun.lockb`

## Contributing

1. Create feature branches
2. Write descriptive commit messages
3. Test with `bun run lint`, `bun run type-check`, and `bun run build`
4. Update documentation as needed

## License

ISC
