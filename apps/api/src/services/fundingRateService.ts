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
// Default timeout for exchange API calls (20 seconds)
const EXCHANGE_TIMEOUT = 20000;

export class FundingRateService {
  private perpExchanges: Map<string, any>;

  constructor() {
    this.perpExchanges = new Map();
    this.initializeExchanges();
  }

  /**
   * Initialize perpetual exchange instances
   * Only perpetual markets have funding rates
   * Each exchange has a timeout to prevent hanging requests
   */
  private initializeExchanges(): void {
    // Binance Futures
    this.perpExchanges.set(
      'binance',
      new ccxt.binance({
        enableRateLimit: true,
        timeout: EXCHANGE_TIMEOUT,
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
        timeout: EXCHANGE_TIMEOUT,
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
        timeout: EXCHANGE_TIMEOUT,
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
        timeout: EXCHANGE_TIMEOUT,
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

      // Initialize empty array for data
      cachedData = [];

      try {
        const exchange = this.getExchange(exchangeId);

        // Load markets if not loaded (with timeout protection)
        if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
          console.log(`Loading markets for ${exchangeId}...`);
          await exchange.loadMarkets();
          console.log(`Markets loaded for ${exchangeId}: ${Object.keys(exchange.markets).length} markets`);
        }

        // Fetch funding rates using the dedicated CCXT method
        let fundingRates: Record<string, any> = {};

        // Use fetchFundingRates - this is the most reliable method
        if (exchange.has['fetchFundingRates']) {
          console.log(`Fetching funding rates from ${exchangeId}...`);
          fundingRates = await exchange.fetchFundingRates();
          console.log(`Fetched ${Object.keys(fundingRates).length} funding rates from ${exchangeId}`);
        } else {
          console.log(`Exchange ${exchangeId} does not support fetchFundingRates`);
        }

        // If we have funding rates from the API, use them directly
        if (Object.keys(fundingRates).length > 0) {
          for (const [symbol, fundingData] of Object.entries(fundingRates)) {
            const data = fundingData as any;

            // Only process USDT-margined contracts (most liquid)
            if (!symbol.includes('USDT') && !symbol.includes('USD')) {
              continue;
            }

            // Get funding rate
            const fundingRate = data.fundingRate;
            if (fundingRate === null || fundingRate === undefined) continue;

            // Convert to percentage
            const fundingRatePercent = fundingRate * 100;

            // Annualized rate: assuming 3 funding settlements per day (every 8 hours)
            const annualizedRate = fundingRatePercent * 3 * 365;

            // Convert symbol to our notation
            const standardSymbol = convertFromCCXTNotation(symbol, 'perp');
            const baseAsset = this.extractBaseAsset(symbol);

            const fundingRateDataItem: FundingRateData = {
              symbol: standardSymbol,
              baseAsset,
              exchange: exchangeId,
              fundingRate,
              fundingRatePercent,
              annualizedRate,
              nextFundingTime: data.fundingTimestamp ?? data.nextFundingTimestamp ?? null,
              markPrice: data.markPrice ?? data.mark ?? null,
              indexPrice: data.indexPrice ?? data.index ?? null,
              openInterest: null, // Not typically in funding rate response
              volume24h: null, // Not typically in funding rate response
              timestamp: data.timestamp || Date.now(),
            };

            cachedData.push(fundingRateDataItem);
          }
        }

        // Log result
        console.log(`Processed ${cachedData.length} funding rates for ${exchangeId}`);
      } catch (error) {
        // Log error but don't throw - return empty data instead
        console.error(`Error fetching funding rates for ${exchangeId}:`, error instanceof Error ? error.message : error);
      }

      // Cache for 30 seconds (funding rates update frequently)
      // Cache even if empty to prevent repeated failed requests
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
    console.log('Fetching cross-exchange funding rates...');

    // Add a timeout wrapper for the entire operation
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Cross-exchange fetch timeout')), 60000);
    });

    const fetchPromise = Promise.allSettled(
      exchanges.map((ex) => this.getFundingRates(ex, 'volume', 'desc', 200))
    );

    let results: PromiseSettledResult<FundingRateResponse>[];
    try {
      results = await Promise.race([fetchPromise, timeoutPromise]) as PromiseSettledResult<FundingRateResponse>[];
    } catch (error) {
      console.error('Cross-exchange fetch timed out or failed:', error);
      // Return empty response on timeout
      return {
        comparisons: [],
        count: 0,
        exchanges,
        timestamp: Date.now(),
        arbitrageOpportunities: [],
      };
    }

    console.log('Cross-exchange fetch complete, processing results...');

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
