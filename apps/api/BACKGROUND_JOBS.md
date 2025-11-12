# Background Refresh Jobs

## Overview

The Lazuli API includes a powerful background refresh system that proactively fetches and caches data from exchanges **before** clients request it. This ensures:

- ⚡ **Zero-latency responses** - Data is already in cache when clients request it
- 🎯 **Controlled rate limiting** - Centralized refresh instead of random client requests
- 🔄 **Consistent freshness** - All clients see data updated every 5-10 seconds
- 📊 **Real-time monitoring** - Track job performance via API endpoints

## How It Works

```
┌─────────────────────────────────────────────────┐
│  Background Job Service (runs every 7 seconds)  │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
   ┌────▼────┐ ┌──▼──┐  ┌────▼─────┐
   │ Tickers │ │OHLCV│  │Custom    │
   │ Refresh │ │Fetch│  │Pairs Calc│
   └────┬────┘ └──┬──┘  └────┬─────┘
        │         │          │
        └─────────┼──────────┘
                  │
           ┌──────▼──────┐
           │  Cache (7s  │ ◄─── Client requests served instantly
           │    TTL)     │
           └─────────────┘
```

### Three Types of Background Jobs

1. **Ticker Refresh** - Refreshes all tickers for all exchanges
2. **OHLCV Refresh** - Refreshes candlestick data for configured symbols/timeframes
3. **Custom Pair Refresh** - Calculates synthetic pairs (e.g., BTC/ETH = BTC/USDT ÷ ETH/USDT)

## Configuration

### Method 1: Via Configuration File (Startup)

1. Copy the example config:
```bash
cp background-jobs.config.example.ts background-jobs.config.ts
```

2. Edit `background-jobs.config.ts` to configure your targets:
```typescript
export const backgroundJobConfig = {
  // Ticker refresh (all exchanges)
  enableTickerRefresh: true,
  tickerRefreshInterval: 7000, // 7 seconds
  exchanges: ['binance', 'bybit', 'okx'],

  // OHLCV refresh (specific symbols)
  enableOhlcvRefresh: true,
  ohlcvRefreshInterval: 7000,
  ohlcvTargets: [
    {
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframes: ['1m', '5m', '15m', '1h', '4h'],
      marketType: 'spot',
      limit: 100,
    },
    // Add more...
  ],

  // Custom pair refresh
  enableCustomPairRefresh: true,
  customPairRefreshInterval: 7000,
  customPairTargets: [
    {
      exchange: 'binance',
      symbol1: 'BTC/USDT',
      symbol2: 'ETH/USDT',
      timeframes: ['1m', '5m', '15m'],
      marketType: 'spot',
    },
    // Add more...
  ],
};
```

3. Import in `src/index.ts`:
```typescript
import { backgroundJobService } from './services/backgroundJobService';
import { backgroundJobConfig } from './background-jobs.config';

// Replace the default instance with configured one
const customJobService = new BackgroundJobService(backgroundJobConfig);
customJobService.startAllJobs();
```

### Method 2: Via API (Dynamic)

Add targets dynamically without restarting the server:

#### Check Job Status
```bash
curl http://localhost:3000/api/v1/jobs/status
```

#### Add OHLCV Target
```bash
curl -X POST http://localhost:3000/api/v1/jobs/ohlcv-target \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance",
    "symbol": "SOL/USDT",
    "timeframes": ["1m", "5m", "15m"],
    "marketType": "spot",
    "limit": 100
  }'
```

#### Add Custom Pair Target
```bash
curl -X POST http://localhost:3000/api/v1/jobs/custom-pair-target \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance",
    "symbol1": "BTC/USDT",
    "symbol2": "AVAX/USDT",
    "timeframes": ["1m", "5m", "15m", "1h"],
    "marketType": "spot"
  }'
```

#### Update Refresh Intervals
```bash
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{
    "tickerRefreshInterval": 5000,
    "ohlcvRefreshInterval": 10000,
    "enableCustomPairRefresh": false
  }'
```

## API Endpoints

### GET /api/v1/jobs/status
Get current job statistics and configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": {
      "ticker": {
        "totalRuns": 120,
        "successfulRuns": 118,
        "failedRuns": 2,
        "lastRunTime": 1699564321000,
        "lastError": null,
        "isRunning": false
      },
      "ohlcv": { ... },
      "customPair": { ... }
    },
    "config": {
      "ticker": {
        "enabled": true,
        "interval": 7000,
        "exchanges": ["binance", "bybit", "okx"]
      },
      "ohlcv": {
        "enabled": true,
        "interval": 7000,
        "targetCount": 5,
        "targets": [...]
      },
      "customPair": {
        "enabled": true,
        "interval": 7000,
        "targetCount": 2,
        "targets": [...]
      }
    }
  }
}
```

### POST /api/v1/jobs/ohlcv-target
Add a new OHLCV target for background refresh.

**Request Body:**
```json
{
  "exchange": "binance",
  "symbol": "BTC/USDT",
  "timeframes": ["1m", "5m", "15m", "1h"],
  "marketType": "spot",
  "limit": 100
}
```

### POST /api/v1/jobs/custom-pair-target
Add a new custom pair target for background refresh.

**Request Body:**
```json
{
  "exchange": "binance",
  "symbol1": "BTC/USDT",
  "symbol2": "ETH/USDT",
  "timeframes": ["1m", "5m", "15m"],
  "marketType": "spot",
  "limit": 100
}
```

### PUT /api/v1/jobs/config
Update background job configuration.

**Request Body:**
```json
{
  "tickerRefreshInterval": 5000,
  "enableTickerRefresh": true,
  "ohlcvRefreshInterval": 10000,
  "enableOhlcvRefresh": true
}
```

## Performance Tuning

### Recommended Intervals

| Data Type | Recommended Interval | Use Case |
|-----------|---------------------|----------|
| Tickers | 5-7 seconds | Real-time price monitoring |
| OHLCV | 7-10 seconds | Chart updates, technical analysis |
| Custom Pairs | 7-10 seconds | Ratio analysis, arbitrage |

### Target Selection Strategy

**Start Small:**
```typescript
// ✅ Good: Start with core pairs
ohlcvTargets: [
  { exchange: 'binance', symbol: 'BTC/USDT', timeframes: ['1m', '5m', '1h'] },
  { exchange: 'binance', symbol: 'ETH/USDT', timeframes: ['1m', '5m', '1h'] },
]
```

**Add More As Needed:**
- Monitor `/api/v1/jobs/status` for job performance
- Check exchange API rate limits
- Add targets incrementally via API

### Rate Limit Considerations

**Ticker Refresh:**
- 3 exchanges × 1 request per exchange = **3 API calls per interval**
- At 7s interval: **~25 calls/minute**

**OHLCV Refresh:**
- Each target × timeframes = API calls
- Example: 5 symbols × 4 timeframes = **20 API calls per interval**
- At 7s interval: **~170 calls/minute**

**Custom Pairs:**
- Each pair × timeframes × 2 (symbol1 + symbol2) = API calls
- Example: 2 pairs × 3 timeframes × 2 = **12 API calls per interval**
- At 7s interval: **~100 calls/minute**

**CCXT handles rate limiting automatically** with `enableRateLimit: true`.

## Monitoring

### Check Job Health
```bash
# Get job statistics
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats'

# Check last run times
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats.ticker.lastRunTime'

# Check for errors
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats.ticker.lastError'
```

### Server Logs
Background jobs log their activity:
```
🔄 Starting background refresh jobs...
📊 Starting ticker refresh job (interval: 7000ms)
   Exchanges: binance, bybit, okx
📈 Starting OHLCV refresh job (interval: 7000ms)
   Targets: 5 symbol(s)
✅ Background refresh jobs started successfully

🔄 [Ticker Refresh] Starting...
   Fetching tickers for binance...
   ✅ binance: 1234 tickers refreshed
   Fetching tickers for bybit...
   ✅ bybit: 567 tickers refreshed
✅ [Ticker Refresh] Completed in 823ms (3 success, 0 failed)
```

## Troubleshooting

### Jobs Not Running
Check if jobs are enabled:
```bash
curl http://localhost:3000/api/v1/jobs/status | jq '.data.config'
```

Enable via API:
```bash
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{"enableTickerRefresh": true}'
```

### High Failure Rate
Check error messages:
```bash
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats.ticker.lastError'
```

Common causes:
- Exchange API rate limits exceeded
- Network connectivity issues
- Invalid symbol names
- Exchange maintenance

### Memory Issues
Reduce targets or increase cache TTL:
```bash
# Reduce OHLCV targets
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{"enableOhlcvRefresh": false}'
```

## Best Practices

1. **Start with ticker refresh only** - Ensure basic functionality works
2. **Add OHLCV targets incrementally** - Monitor performance after each addition
3. **Use longer intervals for less-critical data** - 10s for historical charts is fine
4. **Monitor job statistics regularly** - Set up alerts for high failure rates
5. **Use API endpoints for dynamic configuration** - No need to restart server
6. **Keep timeframes minimal** - Only refresh timeframes you actually display

## Examples

### Simple Setup (Tickers Only)
```typescript
const config = {
  enableTickerRefresh: true,
  tickerRefreshInterval: 7000,
  exchanges: ['binance', 'bybit', 'okx'],
  enableOhlcvRefresh: false,
  enableCustomPairRefresh: false,
};
```

### Multi-Timeframe Dashboard
```typescript
const config = {
  enableTickerRefresh: true,
  tickerRefreshInterval: 7000,
  exchanges: ['binance'],

  enableOhlcvRefresh: true,
  ohlcvRefreshInterval: 7000,
  ohlcvTargets: [
    {
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
      marketType: 'spot',
    },
  ],
};
```

### Custom Pair Analysis
```typescript
const config = {
  enableCustomPairRefresh: true,
  customPairRefreshInterval: 7000,
  customPairTargets: [
    {
      exchange: 'binance',
      symbol1: 'BTC/USDT',
      symbol2: 'ETH/USDT',
      timeframes: ['1m', '5m', '15m', '1h'],
      marketType: 'spot',
    },
  ],
};
```

## FAQ

**Q: Do I need to configure targets for basic ticker data?**
A: No! Ticker refresh works out of the box for all exchanges. OHLCV and custom pairs need target configuration.

**Q: Can I change configuration without restarting?**
A: Yes! Use the API endpoints to add targets and update intervals dynamically.

**Q: What happens if a job fails?**
A: Jobs retry on the next interval. Failed runs are tracked in statistics.

**Q: How do I know if I'm hitting rate limits?**
A: Check job stats for high failure rates and look for rate limit errors in logs.

**Q: Can I disable background jobs temporarily?**
A: Yes! Use `PUT /api/v1/jobs/config` to set `enableTickerRefresh: false` etc.

**Q: What's the minimum recommended interval?**
A: 5 seconds minimum. Lower intervals may trigger exchange rate limits.

**Q: How much memory do background jobs use?**
A: Minimal. Cache has max 1000 entries with LRU eviction. Each entry ~1-2KB.

## Support

For issues or questions:
- Check server logs for detailed error messages
- Use `/api/v1/jobs/status` to inspect job health
- Review CLAUDE.md for project architecture details
- Report issues in the project repository
