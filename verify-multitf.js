#!/usr/bin/env node

/**
 * Verification script for MultiTF feature
 * Tests the OHLCV API endpoints to ensure they work correctly
 *
 * Usage: node verify-multitf.js
 * Note: Requires the API server to be running on http://localhost:3000
 */

const API_BASE_URL = 'http://localhost:3000/api/v1';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(name, url, expectedStatus = 200) {
  try {
    log(`\n📝 Testing: ${name}`, 'cyan');
    log(`   URL: ${url}`, 'blue');

    const response = await fetch(url);
    const data = await response.json();

    if (response.status !== expectedStatus) {
      log(`   ❌ FAIL: Expected status ${expectedStatus}, got ${response.status}`, 'red');
      log(`   Error: ${data.error}`, 'red');
      return false;
    }

    if (!data.success && expectedStatus === 200) {
      log(`   ❌ FAIL: API returned success=false`, 'red');
      log(`   Error: ${data.error}`, 'red');
      return false;
    }

    if (expectedStatus === 200) {
      log(`   ✅ PASS: Status ${response.status}, success=${data.success}`, 'green');

      // Log some response details
      if (data.data) {
        if (data.data.candles) {
          log(`   📊 Candles: ${data.data.candles.length}`, 'blue');
          if (data.data.candles.length > 0) {
            const firstCandle = data.data.candles[0];
            log(
              `   💹 First candle: O:${firstCandle.open} H:${firstCandle.high} L:${firstCandle.low} C:${firstCandle.close}`,
              'blue'
            );
          }
        } else if (data.data.timeframes) {
          log(`   📊 Timeframes: ${data.data.timeframes.length}`, 'blue');
          data.data.timeframes.forEach((tf) => {
            log(`      ${tf.timeframe}: ${tf.count} candles`, 'blue');
          });
        }
      }
    } else {
      log(`   ✅ PASS: Correctly returned error status ${response.status}`, 'green');
    }

    return true;
  } catch (error) {
    log(`   ❌ FAIL: ${error.message}`, 'red');
    return false;
  }
}

async function runTests() {
  log('\n🚀 Starting MultiTF Feature Verification\n', 'cyan');
  log('='.repeat(60), 'cyan');

  let passed = 0;
  let failed = 0;

  // Test 1: Single timeframe endpoint - Valid request
  if (
    await testEndpoint(
      'Single Timeframe OHLCV (Binance BTC/USDT 1h)',
      `${API_BASE_URL}/ohlcv/binance/BTC%2FUSDT?timeframe=1h&type=spot&limit=10`
    )
  )
    passed++;
  else failed++;

  // Test 2: Single timeframe endpoint - Different timeframe
  if (
    await testEndpoint(
      'Single Timeframe OHLCV (Binance BTC/USDT 1d)',
      `${API_BASE_URL}/ohlcv/binance/BTC%2FUSDT?timeframe=1d&type=spot&limit=5`
    )
  )
    passed++;
  else failed++;

  // Test 3: Multi-timeframe endpoint
  if (
    await testEndpoint(
      'Multi-Timeframe OHLCV (Binance BTC/USDT)',
      `${API_BASE_URL}/ohlcv/multi/binance/BTC%2FUSDT?timeframes=1m,5m,15m,1h&type=spot&limit=10`
    )
  )
    passed++;
  else failed++;

  // Test 4: Different exchange (Bybit)
  if (
    await testEndpoint(
      'Single Timeframe OHLCV (Bybit BTC/USDT 1h)',
      `${API_BASE_URL}/ohlcv/bybit/BTC%2FUSDT?timeframe=1h&type=spot&limit=10`
    )
  )
    passed++;
  else failed++;

  // Test 5: Perpetual market
  if (
    await testEndpoint(
      'Single Timeframe OHLCV (Binance Perp BTC/USDT:USDT 1h)',
      `${API_BASE_URL}/ohlcv/binance/BTC%2FUSDT%3AUSDT?timeframe=1h&type=perp&limit=10`
    )
  )
    passed++;
  else failed++;

  // Test 6: Error case - Missing timeframe
  if (
    await testEndpoint(
      'Error: Missing timeframe parameter',
      `${API_BASE_URL}/ohlcv/binance/BTC%2FUSDT?type=spot`,
      400
    )
  )
    passed++;
  else failed++;

  // Test 7: Error case - Invalid timeframe
  if (
    await testEndpoint(
      'Error: Invalid timeframe',
      `${API_BASE_URL}/ohlcv/binance/BTC%2FUSDT?timeframe=2h&type=spot`,
      400
    )
  )
    passed++;
  else failed++;

  // Test 8: Error case - Invalid exchange
  if (
    await testEndpoint(
      'Error: Invalid exchange',
      `${API_BASE_URL}/ohlcv/kraken/BTC%2FUSDT?timeframe=1h&type=spot`,
      400
    )
  )
    passed++;
  else failed++;

  // Test 9: All timeframes
  if (
    await testEndpoint(
      'Multi-Timeframe OHLCV (All 8 timeframes)',
      `${API_BASE_URL}/ohlcv/multi/binance/BTC%2FUSDT?timeframes=1m,5m,15m,1h,4h,1d,3d,1w&type=spot&limit=5`
    )
  )
    passed++;
  else failed++;

  // Print summary
  log('\n' + '='.repeat(60), 'cyan');
  log('\n📊 Test Summary:', 'cyan');
  log(`   ✅ Passed: ${passed}`, 'green');
  log(`   ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  log(
    `   📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`,
    failed === 0 ? 'green' : 'yellow'
  );

  if (failed === 0) {
    log('\n✨ All tests passed! MultiTF feature is working correctly.', 'green');
  } else {
    log('\n⚠️  Some tests failed. Please check the errors above.', 'yellow');
  }

  log('\n' + '='.repeat(60) + '\n', 'cyan');
}

// Check if API is accessible
async function checkApiHealth() {
  try {
    log('🏥 Checking API health...', 'cyan');
    const response = await fetch('http://localhost:3000/health');
    const data = await response.json();

    if (data.status === 'healthy') {
      log('✅ API is healthy and ready\n', 'green');
      return true;
    } else {
      log('⚠️  API returned non-healthy status', 'yellow');
      return false;
    }
  } catch (error) {
    log(
      '❌ Cannot connect to API. Make sure the API server is running on http://localhost:3000',
      'red'
    );
    log(`   Error: ${error.message}\n`, 'red');
    return false;
  }
}

// Main execution
(async () => {
  const isHealthy = await checkApiHealth();

  if (!isHealthy) {
    log('💡 Tip: Start the API server with: npm run dev:api', 'yellow');
    process.exit(1);
  }

  await runTests();
})();
