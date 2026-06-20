/**
 * Spike Worker: CCXT on Cloudflare Workers
 *
 * Purpose: Validate whether CCXT 4.x can run inside the Cloudflare Workers
 * runtime with `nodejs_compat`. Tests the EXACT operations Lazuli needs.
 *
 * KEY FINDING / FIX:
 * CCXT detects `isNode === true` under `nodejs_compat` (because process is
 * defined but window/Deno are not). It then uses its bundled node-fetch,
 * which does NOT auto-decompress gzip responses. The fix is to explicitly
 * inject the Workers native `fetch` via the `fetchImplementation` option.
 * Native Workers fetch honors Content-Encoding and decompresses transparently.
 *
 * Each test is wrapped in a try/catch so a single failure does not abort
 * the entire probe. Results are returned as structured JSON for analysis.
 */

import { binance, bybit, okx, binanceusdm, hyperliquid } from 'ccxt';

// --- Types --------------------------------------------------------------

interface TestResult {
  name: string;
  ok: boolean;
  ms?: number;
  error?: string;
  stack?: string;
  sample?: unknown;
}

// --- Helpers ------------------------------------------------------------

async function probe<T>(
  name: string,
  fn: () => Promise<T>,
  sample?: (value: T) => unknown
): Promise<TestResult> {
  const start = Date.now();
  try {
    const value = await fn();
    return {
      name,
      ok: true,
      ms: Date.now() - start,
      sample: sample ? sample(value) : undefined,
    };
  } catch (err) {
    const e = err as { message?: string; stack?: string };
    console.error(`[${name}] FAILED`, e);
    return {
      name,
      ok: false,
      ms: Date.now() - start,
      error: e?.message ?? String(err),
      stack: e?.stack,
    };
  }
}

// --- Exchange factories -------------------------------------------------
// CRITICAL: fetchImplementation must be the Workers native `fetch`. Without
// this, CCXT picks its bundled node-fetch (because isNode=true under
// nodejs_compat), and node-fetch does not auto-decompress responses,
// producing garbled payloads (gzip magic bytes leak through).
function makeBinanceSpot() {
  return new binance({ enableRateLimit: true, fetchImplementation: fetch as any });
}
function makeBybitSpot() {
  return new bybit({ enableRateLimit: true, fetchImplementation: fetch as any });
}
function makeOkxSpot() {
  return new okx({ enableRateLimit: true, fetchImplementation: fetch as any });
}
function makeBinanceFuture() {
  return new binanceusdm({ enableRateLimit: true, fetchImplementation: fetch as any });
}
function makeHyperliquidSwap() {
  return new hyperliquid({ enableRateLimit: true, fetchImplementation: fetch as any });
}

// --- Fetch handler ------------------------------------------------------

export default {
  async fetch(_request: Request, _env: unknown, _ctx: unknown): Promise<Response> {
    const results: TestResult[] = [];
    const startedAt = Date.now();

    // --- Constructions
    results.push(await probe('construct.binance.spot', async () => makeBinanceSpot()));
    results.push(await probe('construct.bybit.spot', async () => makeBybitSpot()));
    results.push(await probe('construct.okx.spot', async () => makeOkxSpot()));
    results.push(await probe('construct.binance.future', async () => makeBinanceFuture()));
    results.push(await probe('construct.hyperliquid.swap', async () => makeHyperliquidSwap()));

    // --- Binance spot: loadMarkets
    const binanceSpot = makeBinanceSpot();
    results.push(
      await probe(
        'binance.spot.loadMarkets',
        async () => binanceSpot.loadMarkets(),
        (m) => ({ numMarkets: Object.keys(m).length })
      )
    );

    // --- Binance spot: fetchTickers (all)
    results.push(
      await probe(
        'binance.spot.fetchTickers',
        async () => binanceSpot.fetchTickers(),
        (t) => ({ numTickers: Object.keys(t).length, example: Object.keys(t).slice(0, 3) })
      )
    );

    // --- Binance spot: fetchOHLCV BTC/USDT 1h, 24 candles
    results.push(
      await probe(
        'binance.spot.fetchOHLCV(BTC/USDT,1h,24)',
        async () => binanceSpot.fetchOHLCV('BTC/USDT', '1h', undefined, 24),
        (rows) => ({ numCandles: rows.length, last: rows[rows.length - 1] })
      )
    );

    // --- Binance spot: fetchOrderBook BTC/USDT
    results.push(
      await probe(
        'binance.spot.fetchOrderBook(BTC/USDT)',
        async () => binanceSpot.fetchOrderBook('BTC/USDT'),
        (ob) => ({ bidsDepth: ob.bids.length, asksDepth: ob.asks.length, topBid: ob.bids[0] })
      )
    );

    // --- Bybit spot: fetchTicker BTC/USDT
    const bybitSpot = makeBybitSpot();
    results.push(
      await probe(
        'bybit.spot.fetchTicker(BTC/USDT)',
        async () => bybitSpot.fetchTicker('BTC/USDT'),
        (t) => ({ symbol: t.symbol, last: t.last, bid: t.bid, ask: t.ask })
      )
    );

    // --- OKX spot: fetchTickers
    const okxSpot = makeOkxSpot();
    results.push(
      await probe(
        'okx.spot.fetchTickers',
        async () => okxSpot.fetchTickers(),
        (t) => ({ numTickers: Object.keys(t).length, example: Object.keys(t).slice(0, 3) })
      )
    );

    // --- Binance USDT-M futures
    const binanceFuture = makeBinanceFuture();
    results.push(
      await probe(
        'binance.future.loadMarkets',
        async () => binanceFuture.loadMarkets(),
        (m) => ({ numMarkets: Object.keys(m).length })
      )
    );
    results.push(
      await probe(
        'binance.future.fetchFundingRates',
        async () => binanceFuture.fetchFundingRates(),
        (arr) => ({
          numRates: Array.isArray(arr) ? arr.length : Object.keys(arr as any).length,
          sample: Array.isArray(arr) ? arr[0] : Object.values(arr as any)[0],
        })
      )
    );

    // --- Hyperliquid swap
    const hl = makeHyperliquidSwap();
    results.push(
      await probe(
        'hyperliquid.swap.loadMarkets',
        async () => hl.loadMarkets(),
        (m) => ({ numMarkets: Object.keys(m).length })
      )
    );

    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      total: results.length,
    };

    const body = {
      success: true,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      runtime: { worker: true },
      summary,
      results,
    };

    return new Response(JSON.stringify(body, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
