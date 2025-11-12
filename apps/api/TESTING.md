# Testing the Background Refresh System

## Prerequisites

```bash
# Install dependencies
bun install

# Ensure all exchanges are accessible
# Check your network allows connections to:
# - binance.com
# - bybit.com
# - okx.com
```

## Step 1: Start the Development Server

```bash
# From the root directory
bun run dev:api

# Or from apps/api directory
cd apps/api
bun run dev
```

Expected output:
```
🚀 Lazuli API server running on port 3000
...
🔄 Starting background refresh jobs...
📊 Starting ticker refresh job (interval: 7000ms)
   Exchanges: binance, bybit, okx
✅ Background refresh jobs started successfully
```

You should see background jobs start automatically and begin refreshing data every 7 seconds.

## Step 2: Monitor Background Jobs

### Check Job Status
```bash
curl http://localhost:3000/api/v1/jobs/status | jq
```

Expected response:
```json
{
  "success": true,
  "data": {
    "stats": {
      "ticker": {
        "totalRuns": 10,
        "successfulRuns": 10,
        "failedRuns": 0,
        "lastRunTime": 1699564321000,
        "lastError": null,
        "isRunning": false
      },
      ...
    }
  }
}
```

### Watch Job Execution in Real-Time
```bash
# Terminal 1: Start server with verbose logging
bun run dev:api

# Terminal 2: Watch job status updates
watch -n 2 'curl -s http://localhost:3000/api/v1/jobs/status | jq ".data.stats"'
```

## Step 3: Test Ticker Refresh

### Verify Tickers Are Cached
```bash
# First request - should be instant (served from cache)
time curl http://localhost:3000/api/v1/tickers/binance | jq '.data | length'

# Check cache hit
curl http://localhost:3000/api/v1/tickers/binance | jq '.success'
```

Expected: Response time < 100ms (data already in cache)

### Wait for Next Refresh Cycle
```bash
# Wait 8 seconds (1 refresh cycle + buffer)
sleep 8

# Request again - should still be instant
time curl http://localhost:3000/api/v1/tickers/binance | jq '.data | length'
```

## Step 4: Test OHLCV Refresh

### Add OHLCV Target
```bash
curl -X POST http://localhost:3000/api/v1/jobs/ohlcv-target \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance",
    "symbol": "BTC/USDT",
    "timeframes": ["1m", "5m", "15m"],
    "marketType": "spot",
    "limit": 100
  }' | jq
```

Expected:
```json
{
  "success": true,
  "data": {
    "message": "OHLCV target added successfully",
    "target": {
      "exchange": "binance",
      "symbol": "BTC/USDT",
      "timeframes": ["1m", "5m", "15m"],
      "marketType": "spot",
      "limit": 100
    }
  }
}
```

### Verify OHLCV Refresh is Running
```bash
# Check server logs for OHLCV refresh messages
# You should see:
# 🔄 [OHLCV Refresh] Starting...
# ✅ [OHLCV Refresh] Completed in XXXms

# Check job status
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats.ohlcv'
```

### Test OHLCV Data Retrieval
```bash
# Wait for one refresh cycle
sleep 8

# Request OHLCV data - should be instant
time curl 'http://localhost:3000/api/v1/ohlcv/binance/BTC/USDT?timeframe=1m' | jq '.data.candles | length'
```

Expected: Response time < 100ms

## Step 5: Test Custom Pair Refresh

### Add Custom Pair Target
```bash
curl -X POST http://localhost:3000/api/v1/jobs/custom-pair-target \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance",
    "symbol1": "BTC/USDT",
    "symbol2": "ETH/USDT",
    "timeframes": ["1m", "5m"],
    "marketType": "spot"
  }' | jq
```

### Verify Custom Pair Refresh
```bash
# Wait for refresh cycle
sleep 8

# Request custom pair data
time curl 'http://localhost:3000/api/v1/custom-pair/binance/BTC-USDT/ETH-USDT?timeframe=1m' | jq '.data'
```

Expected: Response time < 100ms

## Step 6: Test Configuration Updates

### Change Refresh Interval
```bash
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{
    "tickerRefreshInterval": 5000,
    "ohlcvRefreshInterval": 10000
  }' | jq
```

Verify in server logs:
```
🔧 Updating background job configuration...
📊 Starting ticker refresh job (interval: 5000ms)
✅ Configuration updated successfully
```

### Disable a Job
```bash
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{
    "enableCustomPairRefresh": false
  }' | jq
```

Verify: Custom pair refresh should stop

## Step 7: Performance Testing

### Measure Response Times
```bash
# Create test script
cat > test_performance.sh << 'EOF'
#!/bin/bash

echo "Testing ticker endpoint performance..."
for i in {1..10}; do
  echo "Request $i:"
  time curl -s http://localhost:3000/api/v1/tickers/binance > /dev/null
done

echo ""
echo "Testing OHLCV endpoint performance..."
for i in {1..10}; do
  echo "Request $i:"
  time curl -s 'http://localhost:3000/api/v1/ohlcv/binance/BTC/USDT?timeframe=1m' > /dev/null
done
EOF

chmod +x test_performance.sh
./test_performance.sh
```

Expected: All requests < 100ms (served from cache)

### Monitor Cache Hit Rate
```bash
# Add this endpoint to your dev environment for cache stats
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats'
```

Expected: High hit rate (>90%) after jobs are running

## Step 8: Stress Testing

### Concurrent Requests Test
```bash
# Install apache bench if not available
# sudo apt-get install apache2-utils

# Test with 100 concurrent requests
ab -n 1000 -c 100 http://localhost:3000/api/v1/tickers/binance

# Expected: All requests succeed with low latency
```

### Multiple Timeframes Test
```bash
# Add multiple OHLCV targets
for tf in 1m 5m 15m 1h 4h 1d; do
  curl -X POST http://localhost:3000/api/v1/jobs/ohlcv-target \
    -H "Content-Type: application/json" \
    -d "{
      \"exchange\": \"binance\",
      \"symbol\": \"BTC/USDT\",
      \"timeframes\": [\"$tf\"],
      \"marketType\": \"spot\"
    }"
  sleep 1
done

# Monitor job performance
watch -n 1 'curl -s http://localhost:3000/api/v1/jobs/status | jq ".data.stats.ohlcv"'
```

## Step 9: Error Handling Tests

### Test Invalid Symbol
```bash
curl -X POST http://localhost:3000/api/v1/jobs/ohlcv-target \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "binance",
    "symbol": "INVALID/PAIR",
    "timeframes": ["1m"],
    "marketType": "spot"
  }' | jq
```

Expected: Target added but jobs should log errors for invalid symbol

### Test Network Interruption
```bash
# Simulate by temporarily blocking exchange domains
# (requires sudo)
sudo iptables -A OUTPUT -d binance.com -j DROP

# Monitor job status - should show failures
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats.ticker'

# Restore connection
sudo iptables -D OUTPUT -d binance.com -j DROP
```

Expected: Job failures logged, but jobs continue retrying

## Step 10: Graceful Shutdown Test

```bash
# Start server
bun run dev:api

# Send SIGINT (Ctrl+C)
# OR send SIGTERM
kill -TERM <server_pid>
```

Expected output:
```
⚠️  SIGTERM signal received: closing HTTP server and stopping background jobs
🛑 Stopping background refresh jobs...
✅ All background jobs stopped
✅ HTTP server closed
```

## Automated Test Suite

Create a comprehensive test:

```bash
cat > test_background_jobs.sh << 'EOF'
#!/bin/bash

API_BASE="http://localhost:3000/api/v1"

echo "🧪 Testing Background Refresh System"
echo "===================================="

# Test 1: Check server is running
echo "Test 1: Server health check..."
curl -s "$API_BASE/../health" | jq -e '.data.status == "ok"' && echo "✅ Passed" || echo "❌ Failed"

# Test 2: Check jobs are running
echo "Test 2: Background jobs status..."
curl -s "$API_BASE/jobs/status" | jq -e '.success == true' && echo "✅ Passed" || echo "❌ Failed"

# Test 3: Verify ticker refresh is working
echo "Test 3: Ticker refresh..."
BEFORE=$(curl -s "$API_BASE/jobs/status" | jq '.data.stats.ticker.totalRuns')
sleep 8
AFTER=$(curl -s "$API_BASE/jobs/status" | jq '.data.stats.ticker.totalRuns')
[ "$AFTER" -gt "$BEFORE" ] && echo "✅ Passed (runs: $BEFORE -> $AFTER)" || echo "❌ Failed"

# Test 4: Add OHLCV target
echo "Test 4: Add OHLCV target..."
curl -s -X POST "$API_BASE/jobs/ohlcv-target" \
  -H "Content-Type: application/json" \
  -d '{"exchange":"binance","symbol":"BTC/USDT","timeframes":["1m"],"marketType":"spot"}' \
  | jq -e '.success == true' && echo "✅ Passed" || echo "❌ Failed"

# Test 5: Verify OHLCV refresh works
echo "Test 5: OHLCV refresh..."
sleep 8
curl -s "$API_BASE/jobs/status" | jq -e '.data.stats.ohlcv.totalRuns > 0' && echo "✅ Passed" || echo "❌ Failed"

# Test 6: Update configuration
echo "Test 6: Update job config..."
curl -s -X PUT "$API_BASE/jobs/config" \
  -H "Content-Type: application/json" \
  -d '{"tickerRefreshInterval":10000}' \
  | jq -e '.success == true' && echo "✅ Passed" || echo "❌ Failed"

# Test 7: Verify cache performance
echo "Test 7: Cache performance..."
START=$(date +%s%N)
curl -s "$API_BASE/tickers/binance" > /dev/null
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))
[ "$DURATION" -lt 200 ] && echo "✅ Passed (${DURATION}ms)" || echo "❌ Failed (${DURATION}ms)"

echo "===================================="
echo "✅ All tests completed!"
EOF

chmod +x test_background_jobs.sh
./test_background_jobs.sh
```

## Troubleshooting

### Jobs Not Executing
```bash
# Check if jobs are enabled
curl http://localhost:3000/api/v1/jobs/status | jq '.data.config'

# Check for errors in logs
grep -i "error" logs/api.log

# Verify exchanges are accessible
curl -I https://api.binance.com/api/v3/ping
```

### High Failure Rate
```bash
# Check last error
curl http://localhost:3000/api/v1/jobs/status | jq '.data.stats.ticker.lastError'

# Reduce load by increasing interval
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{"tickerRefreshInterval": 10000}'
```

### Memory Issues
```bash
# Monitor memory usage
ps aux | grep node

# Reduce targets
curl -X PUT http://localhost:3000/api/v1/jobs/config \
  -H "Content-Type: application/json" \
  -d '{"enableOhlcvRefresh": false}'
```

## Success Criteria

✅ All background jobs start automatically on server startup
✅ Ticker refresh executes every 7 seconds with >95% success rate
✅ OHLCV refresh works for configured targets
✅ Custom pair refresh calculates synthetic pairs correctly
✅ API requests served from cache in <100ms
✅ Jobs can be configured dynamically via API
✅ Server shuts down gracefully, stopping all jobs
✅ No memory leaks during extended operation
✅ Jobs handle exchange errors gracefully and retry

## Next Steps

After successful testing:
1. Configure production targets in background-jobs.config.ts
2. Set up monitoring for job health
3. Configure alerting for high failure rates
4. Optimize refresh intervals based on usage patterns
5. Consider implementing request coalescing for high-traffic endpoints
