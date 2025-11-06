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

\`\`\`
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
\`\`\`

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

1. **Clone and install all dependencies:**
\`\`\`bash
git clone <repository-url>
cd lazuli
npm install
\`\`\`

This will install dependencies for all workspaces (API, Web, and Shared).

### Running the Applications

**Option 1: Run both applications together**
\`\`\`bash
npm run dev:all
\`\`\`

**Option 2: Run individually**

API only (port 3000):
\`\`\`bash
npm run dev:api
\`\`\`

Web only (port 3001):
\`\`\`bash
npm run dev:web
\`\`\`

### Environment Configuration

**Backend API:**
\`\`\`bash
cd apps/api
cp .env.example .env
# Edit .env with your configuration
\`\`\`

**Frontend Web:**
\`\`\`bash
cd apps/web
cp .env.example .env.local
# Edit .env.local - set NEXT_PUBLIC_API_URL if needed
\`\`\`

## Available Scripts

From the root directory:

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Run API in development mode |
| \`npm run dev:api\` | Run API only |
| \`npm run dev:web\` | Run Web only |
| \`npm run dev:all\` | Run both API and Web |
| \`npm run build\` | Build all workspaces |
| \`npm run build:api\` | Build API only |
| \`npm run build:web\` | Build Web only |
| \`npm run lint\` | Lint all workspaces |
| \`npm run clean\` | Clean all node_modules and build artifacts |

## Monorepo Architecture

Lazuli uses **npm workspaces** for monorepo management:

- **Shared Types**: Common TypeScript interfaces in \`packages/shared\`
- **Independent Apps**: Separate \`package.json\` for API and Web
- **Unified Dependencies**: Shared dependencies hoisted to root
- **Workspace Commands**: Run scripts across all or specific packages

### Benefits

- ✅ Type safety across frontend and backend
- ✅ Single \`npm install\` for entire project
- ✅ Consistent tooling and versions
- ✅ Easy to add new packages/apps
- ✅ Industry-standard structure

## License

ISC
