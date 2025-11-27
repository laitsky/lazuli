/**
 * Funding Rate Service
 *
 * Fetches and analyzes funding rate data from perpetual futures exchanges.
 *
 * What is Funding Rate?
 * - A periodic payment between long and short traders in perpetual futures
 * - Designed to keep perpetual contract prices close to spot prices
 * - Positive rate: Longs pay shorts (bullish sentiment, more longs than shorts)
 * - Negative rate: Shorts pay longs (bearish sentiment, more shorts than longs)
 *
 * Why Funding Rate Matters for Traders:
 * 1. ARBITRAGE: When funding is high positive, traders can:
 *    - Go long on spot (buy the asset)
 *    - Go short on perpetual (sell the contract)
 *    - Collect funding payments while staying delta-neutral
 *
 * 2. SENTIMENT INDICATOR:
 *    - Extreme positive funding = market overleveraged long (correction incoming?)
 *    - Extreme negative funding = market overleveraged short (squeeze incoming?)
 *
 * 3. CROSS-EXCHANGE ARBITRAGE:
 *    - Different exchanges have different funding rates
 *    - Long on low-funding exchange, short on high-funding exchange
 */

import ccxt from 'ccxt';
import {
  FundingRateData,
  FundingRateResponse,
  FundingMarketStats,
  FundingSentiment,
  CrossExchangeFunding,
  CrossExchangeFundingResponse,
} from '@lazuli/shared';
import { cacheService } from './cacheService';
import { convertFromCCXTNotation } from '../utils/validation';

/**
 * Funding Rate Service class
 * Handles fetching and processing funding rate data from exchanges
 */
export class FundingRateService {
  private perpExchanges: Map<string, any>;

  constructor() {
    this.perpExchanges = new Map();
    this.initializeExchanges();
  }

  /**
   * Initialize perpetual exchange instances
   * Only perpetual markets have funding rates
   */
  private initializeExchanges(): void {
    // Binance Futures
    this.perpExchanges.set(
      'binance',
      new ccxt.binance({
        enableRateLimit: true,
        options: {
          defaultType: 'future',
        },
      })
    );

    // Bybit (swap/perpetual)
    this.perpExchanges.set(
      'bybit',
      new ccxt.bybit({
        enableRateLimit: true,
        options: {
          defaultType: 'swap',
        },
      })
    );

    // OKX (swap/perpetual)
    this.perpExchanges.set(
      'okx',
      new ccxt.okx({
        enableRateLimit: true,
        options: {
          defaultType: 'swap',
        },
      })
    );

    // Hyperliquid (perpetual only DEX)
    this.perpExchanges.set(
      'hyperliquid',
      new ccxt.hyperliquid({
        enableRateLimit: true,
        options: {
          defaultType: 'swap',
        },
      })
    );
  }

  /**
   * Get exchange instance for perpetual markets
   */
  private getExchange(exchangeId: string): any {
    const exchange = this.perpExchanges.get(exchangeId);
    if (!exchange) {
      throw new Error(`Exchange ${exchangeId} not supported for funding rates`);
    }
    return exchange;
  }

  /**
   * Calculate market sentiment based on average funding rate
   * @param avgFundingPercent - Average funding rate as percentage
   * @returns Sentiment indicator
   */
  private calculateSentiment(avgFundingPercent: number): FundingSentiment {
    // Thresholds based on typical funding rate ranges:
    // Normal range: -0.01% to +0.01%
    // Elevated: +/- 0.01% to 0.03%
    // Extreme: > +/- 0.03%
    if (avgFundingPercent > 0.03) return 'extremely_bullish';
    if (avgFundingPercent > 0.01) return 'bullish';
    if (avgFundingPercent < -0.03) return 'extremely_bearish';
    if (avgFundingPercent < -0.01) return 'bearish';
    return 'neutral';
  }

  /**
   * Parse funding rate from CCXT ticker info
   * Different exchanges return funding rate in different formats
   */
  private parseFundingRate(ticker: any, exchangeId: string): number | null {
    // Try different paths where funding rate might be stored
    const info = ticker.info || {};

    // Binance: info.lastFundingRate
    if (info.lastFundingRate !== undefined) {
      return parseFloat(info.lastFundingRate);
    }

    // Bybit: info.fundingRate
    if (info.fundingRate !== undefined) {
      return parseFloat(info.fundingRate);
    }

    // OKX: info.fundingRate
    if (info.fundingRate !== undefined) {
      return parseFloat(info.fundingRate);
    }

    // Hyperliquid: info.funding
    if (info.funding !== undefined) {
      return parseFloat(info.funding);
    }

    // Generic fallback
    if (ticker.fundingRate !== undefined && ticker.fundingRate !== null) {
      return ticker.fundingRate;
    }

    return null;
  }

  /**
   * Parse next funding time from CCXT ticker info
   */
  private parseNextFundingTime(ticker: any, exchangeId: string): number | null {
    const info = ticker.info || {};

    // Binance: info.nextFundingTime
    if (info.nextFundingTime !== undefined) {
      return parseInt(info.nextFundingTime);
    }

    // Bybit: info.nextFundingTime
    if (info.nextFundingTime !== undefined) {
      return parseInt(info.nextFundingTime);
    }

    return null;
  }

  /**
   * Extract base asset from symbol
   * Handles both CCXT notation (BTC/USDT:USDT) and our notation (BTCUSDT.P)
   */
  private extractBaseAsset(symbol: string): string {
    // Handle CCXT notation: BTC/USDT:USDT -> BTC
    if (symbol.includes('/')) {
      return symbol.split('/')[0];
    }
    // Handle our notation: BTCUSDT.P -> BTC
    if (symbol.endsWith('.P')) {
      const withoutSuffix = symbol.slice(0, -2);
      // Remove common quote currencies
      return withoutSuffix.replace(/(USDT|USDC|BUSD|USD)$/, '');
    }
    return symbol;
  }

  /**
   * Fetch funding rates for all perpetual contracts on an exchange
   * @param exchangeId - Exchange identifier (binance, bybit, okx, hyperliquid)
   * @param sortBy - Sort field (rate, volume, openInterest)
   * @param sortOrder - Sort order (asc, desc)
   * @param limit - Maximum number of results
   * @returns Funding rate response with statistics
   */
  async getFundingRates(
    exchangeId: string,
    sortBy: 'rate' | 'volume' | 'openInterest' = 'rate',
    sortOrder: 'asc' | 'desc' = 'desc',
    limit: number = 100
  ): Promise<FundingRateResponse> {
    // Check cache first
    const cacheKey = `funding:${exchangeId}:raw`;
    let cachedData = cacheService.get<FundingRateData[]>(cacheKey);

    if (!cachedData) {
      console.log(`Cache miss for ${cacheKey}, fetching from exchange...`);

      const exchange = this.getExchange(exchangeId);

      // Load markets if not loaded
      if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
        await exchange.loadMarkets();
      }

      // Fetch funding rates using the dedicated CCXT method
      // This is more reliable than extracting from tickers
      let fundingRates: Record<string, any> = {};

      try {
        // Try to use fetchFundingRates if available (preferred method)
        if (exchange.has['fetchFundingRates']) {
          fundingRates = await exchange.fetchFundingRates();
        } else if (exchange.has['fetchFundingRate']) {
          // Some exchanges only support fetching one at a time
          // In this case, we'll fetch from tickers as fallback
          fundingRates = {};
        }
      } catch (error) {
        console.log(`fetchFundingRates not available for ${exchangeId}, using tickers fallback`);
        fundingRates = {};
      }

      // Also fetch tickers for additional data (volume, price, open interest)
      const tickers = await exchange.fetchTickers();

      // Transform to our funding rate format
      cachedData = [];

      // Process perpetual markets
      for (const [ccxtSymbol, market] of Object.entries(exchange.markets)) {
        const marketData = market as any;

        // Only process perpetual/swap/future markets
        if (marketData.type !== 'swap' && marketData.type !== 'future' && !marketData.linear) {
          continue;
        }

        // Only process USDT-margined contracts (most liquid)
        if (!ccxtSymbol.includes('USDT') && !ccxtSymbol.includes('USD')) {
          continue;
        }

        // Skip inactive markets
        if (marketData.active === false) {
          continue;
        }

        // Get funding rate from fundingRates response or ticker
        let fundingRate: number | null = null;
        const fundingData = fundingRates[ccxtSymbol];
        const tickerData = tickers[ccxtSymbol] as any;

        if (fundingData) {
          // Use dedicated funding rate data
          fundingRate = fundingData.fundingRate ?? null;
        } else if (tickerData) {
          // Fallback to parsing from ticker
          fundingRate = this.parseFundingRate(tickerData, exchangeId);
        }

        // Skip if no funding rate found
        if (fundingRate === null) continue;

        // Convert to percentage (funding rate is typically a decimal like 0.0001 = 0.01%)
        const fundingRatePercent = fundingRate * 100;

        // Annualized rate: assuming 3 funding settlements per day (every 8 hours)
        // Annual rate = daily rate * 365 = (rate * 3) * 365
        const annualizedRate = fundingRatePercent * 3 * 365;

        // Convert symbol to our notation
        const standardSymbol = convertFromCCXTNotation(ccxtSymbol, 'perp');
        const baseAsset = this.extractBaseAsset(ccxtSymbol);

        // Get price and volume from ticker
        const markPrice = tickerData?.last ?? tickerData?.close ?? null;
        const volume24h = tickerData?.quoteVolume ?? null;

        // Parse open interest
        let openInterest: number | null = null;
        if (tickerData?.info?.openInterest) {
          openInterest = parseFloat(tickerData.info.openInterest);
          // Convert to USD value if we have mark price
          if (markPrice && openInterest) {
            openInterest = openInterest * markPrice;
          }
        }

        // Get next funding time
        let nextFundingTime: number | null = null;
        if (fundingData?.fundingTimestamp) {
          nextFundingTime = fundingData.fundingTimestamp;
        } else if (tickerData) {
          nextFundingTime = this.parseNextFundingTime(tickerData, exchangeId);
        }

        const fundingRateDataItem: FundingRateData = {
          symbol: standardSymbol,
          baseAsset,
          exchange: exchangeId,
          fundingRate,
          fundingRatePercent,
          annualizedRate,
          nextFundingTime,
          markPrice,
          indexPrice: fundingData?.indexPrice ?? (tickerData?.info?.indexPrice ? parseFloat(tickerData.info.indexPrice) : null),
          openInterest,
          volume24h,
          timestamp: tickerData?.timestamp || Date.now(),
        };

        cachedData.push(fundingRateDataItem);
      }

      // Cache for 30 seconds (funding rates update frequently)
      cacheService.set(cacheKey, cachedData, 30000);
    } else {
      console.log(`Cache hit for ${cacheKey}`);
    }

    // Sort the data
    const sortedData = [...cachedData].sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortBy) {
        case 'rate':
          aValue = Math.abs(a.fundingRatePercent);
          bValue = Math.abs(b.fundingRatePercent);
          break;
        case 'volume':
          aValue = a.volume24h || 0;
          bValue = b.volume24h || 0;
          break;
        case 'openInterest':
          aValue = a.openInterest || 0;
          bValue = b.openInterest || 0;
          break;
        default:
          aValue = Math.abs(a.fundingRatePercent);
          bValue = Math.abs(b.fundingRatePercent);
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    });

    // Apply limit
    const limitedData = sortedData.slice(0, limit);

    // Calculate statistics
    const stats = this.calculateStats(cachedData);

    return {
      exchange: exchangeId,
      fundingRates: limitedData,
      count: limitedData.length,
      stats,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate market statistics from funding rate data
   */
  private calculateStats(data: FundingRateData[]): FundingMarketStats {
    if (data.length === 0) {
      return {
        totalPairs: 0,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        avgFundingRate: 0,
        avgFundingPercent: 0,
        marketSentiment: 'neutral',
        highestFunding: { symbol: '', rate: 0, percent: 0 },
        lowestFunding: { symbol: '', rate: 0, percent: 0 },
      };
    }

    // Count by sentiment
    const positiveCount = data.filter((d) => d.fundingRatePercent > 0.005).length;
    const negativeCount = data.filter((d) => d.fundingRatePercent < -0.005).length;
    const neutralCount = data.length - positiveCount - negativeCount;

    // Calculate average
    const avgFundingRate = data.reduce((sum, d) => sum + d.fundingRate, 0) / data.length;
    const avgFundingPercent = data.reduce((sum, d) => sum + d.fundingRatePercent, 0) / data.length;

    // Find highest and lowest
    const highest = data.reduce((max, d) =>
      d.fundingRatePercent > max.fundingRatePercent ? d : max
    );
    const lowest = data.reduce((min, d) =>
      d.fundingRatePercent < min.fundingRatePercent ? d : min
    );

    return {
      totalPairs: data.length,
      positiveCount,
      negativeCount,
      neutralCount,
      avgFundingRate,
      avgFundingPercent,
      marketSentiment: this.calculateSentiment(avgFundingPercent),
      highestFunding: {
        symbol: highest.symbol,
        rate: highest.fundingRate,
        percent: highest.fundingRatePercent,
      },
      lowestFunding: {
        symbol: lowest.symbol,
        rate: lowest.fundingRate,
        percent: lowest.fundingRatePercent,
      },
    };
  }

  /**
   * Get cross-exchange funding rate comparison
   * Fetches funding rates from all exchanges and compares them for arbitrage opportunities
   * @param limit - Maximum number of assets to compare
   * @returns Cross-exchange funding comparison with arbitrage opportunities
   */
  async getCrossExchangeFunding(limit: number = 50): Promise<CrossExchangeFundingResponse> {
    // Fetch funding rates from all exchanges in parallel
    const exchanges = ['binance', 'bybit', 'okx', 'hyperliquid'];
    const results = await Promise.allSettled(
      exchanges.map((ex) => this.getFundingRates(ex, 'volume', 'desc', 200))
    );

    // Collect all funding data by base asset
    const assetMap = new Map<string, CrossExchangeFunding['rates']>();

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const exchangeId = exchanges[index];
        for (const rate of result.value.fundingRates) {
          const existing = assetMap.get(rate.baseAsset) || [];
          existing.push({
            exchange: exchangeId,
            symbol: rate.symbol,
            fundingRate: rate.fundingRate,
            fundingRatePercent: rate.fundingRatePercent,
            annualizedRate: rate.annualizedRate,
            markPrice: rate.markPrice,
          });
          assetMap.set(rate.baseAsset, existing);
        }
      }
    });

    // Build comparisons for assets available on multiple exchanges
    const comparisons: CrossExchangeFunding[] = [];

    for (const [baseAsset, rates] of assetMap.entries()) {
      // Only include assets available on at least 2 exchanges
      if (rates.length < 2) continue;

      // Calculate spread
      const fundingRates = rates.map((r) => r.fundingRatePercent);
      const maxRate = Math.max(...fundingRates);
      const minRate = Math.min(...fundingRates);
      const spread = maxRate - minRate;

      // Find exchanges with max and min rates
      const maxExchange = rates.find((r) => r.fundingRatePercent === maxRate)!.exchange;
      const minExchange = rates.find((r) => r.fundingRatePercent === minRate)!.exchange;

      // Significant arbitrage opportunity if spread > 0.02% (2 bps)
      const arbitrageOpportunity = spread > 0.02;

      comparisons.push({
        baseAsset,
        rates,
        spread,
        maxExchange,
        minExchange,
        arbitrageOpportunity,
      });
    }

    // Sort by spread (highest arbitrage opportunity first)
    comparisons.sort((a, b) => b.spread - a.spread);

    // Limit results
    const limitedComparisons = comparisons.slice(0, limit);

    // Extract top arbitrage opportunities
    const arbitrageOpportunities = comparisons
      .filter((c) => c.arbitrageOpportunity)
      .slice(0, 10)
      .map((c) => ({
        asset: c.baseAsset,
        spread: c.spread,
        longExchange: c.minExchange, // Go long where funding is lowest (pay less or receive)
        shortExchange: c.maxExchange, // Go short where funding is highest (receive more)
        estimatedDailyYield: c.spread * 3, // 3 funding settlements per day
      }));

    return {
      comparisons: limitedComparisons,
      count: limitedComparisons.length,
      exchanges,
      timestamp: Date.now(),
      arbitrageOpportunities,
    };
  }
}

// Export singleton instance
export const fundingRateService = new FundingRateService();
