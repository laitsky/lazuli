# Lazuli - Cryptocurrency Trading Tool

A modern full-stack Cloudflare application that provides **real-time** cryptocurrency data from Binance, Bybit, OKX, Hyperliquid, and Upbit.

**Production is Cloudflare-native**: Workers serve the API and web app, Durable Objects cache live market data, D1 stores metadata/control-plane state, R2 stores historical OHLCV archives, and Queues/Workflows coordinate backfills.

## Features

- 📊 **Beautiful Web Interface** - Modern React + Vite frontend with real-time data
- 🔌 **REST API** - Hono API running on Cloudflare Workers
- 💱 **Multi-Exchange Support** - Binance, Bybit, OKX, Hyperliquid, and Upbit
- 🎯 **Live Trading Data** - Real-time prices, volumes, and market statistics
- 📈 **Spot & Perpetual Markets** - Support for both market types
- 🎨 **Modern UI** - Built with Shadcn UI and Tailwind CSS
- 💾 **Cloudflare Storage** - D1 metadata plus R2 historical OHLCV archives
- 🏗️ **Monorepo Structure** - Industry-standard Turborepo with Bun
- ⚡ **Edge Runtime** - Deployed on Cloudflare Workers with Bun for local tooling

## Project Structure

```
lazuli/
├── apps/
│   ├── api/              # Cloudflare Worker REST API (Hono + TypeScript)
│   │   ├── src/          # Source code
│   │   ├── migrations/   # D1 schema migrations
│   │   ├── wrangler.jsonc
│   │   └── package.json  # API dependencies
│   └── web/              # Frontend Worker + Static Assets (React + Vite)
│       ├── src/          # Source code & components
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

API only (Worker dev, port 8787):

```bash
bun run dev:api
```

Web only:

```bash
bun run dev:web
```

### Environment Configuration

**Backend API:**

```bash
cd apps/api
bunx wrangler secret put ADMIN_SIGNING_SECRET --env staging
bunx wrangler secret put ADMIN_SIGNING_SECRET --env production
```

**Frontend Web:**

```bash
cd apps/web
bun run build
```

## Available Scripts

From the root directory:

| Command                     | Description                                 |
| --------------------------- | ------------------------------------------- |
| `bun run dev`               | Run both API and Web in development mode    |
| `bun run dev:api`           | Run API only                                |
| `bun run dev:web`           | Run Web only                                |
| `bun run build`             | Build all workspaces                        |
| `bun run build:api`         | Build API only                              |
| `bun run build:web`         | Build Web only                              |
| `bun run deploy:staging`    | Deploy all Workers to Cloudflare staging    |
| `bun run deploy:production` | Deploy all Workers to Cloudflare production |
| `bun run lint`              | Lint all workspaces                         |
| `bun run type-check`        | Type check all workspaces                   |
| `bun run format`            | Format all code                             |
| `bun run clean`             | Clean all build artifacts                   |

## API Endpoints

Local base URL: `http://localhost:8787/api/v1`

Production Worker URL: `https://lazuli-api.vincent-diamond15.workers.dev/api/v1`

Production Web URL: `https://lazuli-web.vincent-diamond15.workers.dev`

### Core Endpoints (Live Data - No DB Required)

- `GET /exchanges` - List all supported exchanges
- `GET /tickers/:exchange` - Get all tickers for an exchange
- `GET /tickers/:exchange/:symbol` - Get specific ticker data
- `GET /markets/:exchange` - Get all available markets

### Historical / Advanced Endpoints

- `GET /ohlcv/:exchange/:symbol` - Query live, cached, and archived OHLCV
- `POST /admin/backfills` - Create an admin-only OHLCV archive backfill
- `GET /admin/backfills/:id` - Check backfill progress and coverage
- `POST /admin/backfills/:id/retry` - Retry failed or incomplete chunks
- `POST /admin/backfill-campaigns` - Dry-run or start a full-history campaign
- `GET /admin/backfill-campaigns/:id` - Inspect campaign waves, circuits, and gaps
- `POST /admin/backfill-campaigns/:id/{pause|resume|cancel|retry-gaps}` - Control a campaign

## Web Interface

Access the production web interface at `https://lazuli-web.vincent-diamond15.workers.dev`.

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

- **Runtime**: Cloudflare Workers with Bun for local tooling
- **Framework**: Hono
- **Exchange APIs**: CCXT (Binance, Bybit, OKX, Hyperliquid, Upbit)
- **Database**: Cloudflare D1 for metadata/control-plane state
- **Archive Storage**: Cloudflare R2 for historical OHLCV NDJSON archives
- **Coordination**: Durable Objects, Queues, and Workflows
- **Documentation**: OpenAPI 3.0 with Stoplight Elements
- **Dev Mode**: Built-in watch mode with `bun --watch`

### Frontend (apps/web)

- **Framework**: React 18 + Vite 6
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

## Cloudflare Setup

Production uses Cloudflare resources only. Apply D1 migrations before deploy:

```bash
cd apps/api
bunx wrangler d1 migrations apply lazuli-db-staging --env staging --remote
bunx wrangler d1 migrations apply lazuli-db-prod --env production --remote
```

Deploy:

```bash
bun run deploy:staging
bun run deploy:production
```

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
