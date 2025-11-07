# Lazuli Architecture Overview

## Core Design Philosophy

**Real-time First**: Lazuli is designed to provide live cryptocurrency data directly from exchanges without requiring database storage.

## Data Flow

### Primary Path (Real-time)
```
User Request → API Endpoint → Exchange Service (CCXT/Hyperliquid) → Live Data Response
```

### Optional Path (Database Features)
```
User Request → Database Controller → Supabase → Stored Data Response
```

## Endpoints Classification

### 🔥 Core Endpoints (No Database Required)
- **Purpose**: Live trading data for immediate use
- **Data Source**: Direct exchange APIs
- **Latency**: Real-time (2-5 seconds)
- **Use Cases**: Trading bots, price monitoring, market analysis

**Endpoints:**
- `GET /exchanges` - Supported exchanges
- `GET /tickers/:exchange` - Live price data
- `GET /tickers/:exchange/:symbol` - Specific ticker
- `GET /markets/:exchange` - Available trading pairs

### 💾 Optional Endpoints (Database Required)
- **Purpose**: Historical analysis, alerts, custom features
- **Data Source**: Stored data in Supabase
- **Setup**: Requires running `database-setup.sql` once
- **Use Cases**: Backtesting, price alerts, trend analysis

**Endpoints:**
- `POST /data/store/:exchange` - Store live data
- `GET /data/history/:symbol` - Historical prices
- `GET /data/latest/:exchange/:symbol` - Latest stored
- `DELETE /data/cleanup` - Data maintenance

## When to Use Database Features

✅ **Use database features for:**
- Historical price analysis
- Setting up price alerts
- Arbitrage opportunity tracking
- Custom analytics and backtesting
- Building dashboards with historical charts

❌ **Don't use database for:**
- Live trading decisions
- Real-time price monitoring
- Simple market data queries
- High-frequency trading

## Performance Characteristics

### Live Data Endpoints
- **Latency**: 2-5 seconds (exchange API dependent)
- **Rate Limits**: Managed by CCXT and exchange policies
- **Caching**: Minimal (exchange-level only)
- **Reliability**: Direct exchange connection

### Database Endpoints
- **Latency**: 100-500ms (database query time)
- **Storage**: Unlimited historical data
- **Features**: Complex queries, aggregations, joins
- **Maintenance**: Periodic cleanup recommended

## Development Guidelines

1. **Always start with live endpoints** for new features
2. **Only add database storage** when historical data is truly needed
3. **Document clearly** whether features require database setup
4. **Keep live and stored data paths separate** for maintainability
5. **Prefer exchange APIs** over stored data for current market conditions