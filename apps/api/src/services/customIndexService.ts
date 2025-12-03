/**
 * Custom Index Service
 * Handles calculation of custom weighted index performance
 * and comparison against benchmarks (BTC, ETH, SOL)
 */

import { ccxtService } from './ccxtService';
import { cacheService } from './cacheService';
import {
  OHLCV,
  Timeframe,
  IndexAsset,
  IndexPerformancePoint,
  BenchmarkPerformance,
  CustomIndexResponse,
  SupportedExchange,
} from '../types';
import { invalidWeights, dataNotFound } from '../errors';

/**
 * Benchmark symbols to compare against
 * Uses USDT pairs as the base for comparison
 */
const BENCHMARK_SYMBOLS = [
  { symbol: 'BTC-USDT', name: 'Bitcoin' },
  { symbol: 'ETH-USDT', name: 'Ethereum' },
  { symbol: 'SOL-USDT', name: 'Solana' },
];

export class CustomIndexService {
  /**
   * Calculate custom index performance based on weighted assets
   * @param name - Index name
   * @param assets - Array of assets with weights
   * @param timeframe - Timeframe for calculation
   * @param exchange - Exchange to fetch data from
   * @param limit - Number of candles to fetch
   * @returns Custom index response with performance and benchmarks
   */
  async calculateIndex(
    name: string,
    assets: IndexAsset[],
    timeframe: Timeframe,
    exchange: SupportedExchange,
    limit: number = 100
  ): Promise<CustomIndexResponse> {
    // Validate weights sum to 100
    const totalWeight = assets.reduce((sum, asset) => sum + asset.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      throw invalidWeights(`Asset weights must sum to 100, got ${totalWeight.toFixed(2)}`);
    }

    // Create cache key for this specific index configuration
    const cacheKey = `custom-index:${exchange}:${timeframe}:${assets
      .map((a) => `${a.symbol}:${a.weight}`)
      .sort()
      .join(',')}`;

    // Check cache first
    const cached = cacheService.get<CustomIndexResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch OHLCV data for all assets in parallel
    const assetDataPromises = assets.map(async (asset) => {
      const data = await ccxtService.fetchOHLCV(exchange, asset.symbol, timeframe, 'spot', limit);
      return { asset, data };
    });

    const assetDataResults = await Promise.all(assetDataPromises);

    // Find common timestamps across all assets
    const commonTimestamps = this.findCommonTimestamps(assetDataResults.map((r) => r.data));

    if (commonTimestamps.length === 0) {
      throw dataNotFound(
        'No common timestamps found across assets. Assets may have different trading hours.'
      );
    }

    // Calculate index performance
    const performance = this.calculateWeightedPerformance(assetDataResults, commonTimestamps);

    // Fetch and calculate benchmark performance
    const benchmarks = await this.calculateBenchmarks(exchange, timeframe, commonTimestamps, limit);

    const startTime = commonTimestamps[0];
    const endTime = commonTimestamps[commonTimestamps.length - 1];
    const totalReturn = performance.length > 0 ? performance[performance.length - 1].change : 0;

    const response: CustomIndexResponse = {
      name,
      exchange,
      timeframe,
      assets,
      performance,
      benchmarks,
      startTime,
      endTime,
      totalReturn,
    };

    // Cache for 30 seconds
    cacheService.set(cacheKey, response, 30000);

    return response;
  }

  /**
   * Find timestamps that exist across all OHLCV data arrays
   * This ensures we only compare data points where all assets have data
   */
  private findCommonTimestamps(allData: OHLCV[][]): number[] {
    if (allData.length === 0) return [];

    // Get timestamps from first asset
    const timestamps = new Set(allData[0].map((candle) => candle.timestamp));

    // Intersect with timestamps from other assets
    for (let i = 1; i < allData.length; i++) {
      const assetTimestamps = new Set(allData[i].map((candle) => candle.timestamp));
      for (const ts of timestamps) {
        if (!assetTimestamps.has(ts)) {
          timestamps.delete(ts);
        }
      }
    }

    return Array.from(timestamps).sort((a, b) => a - b);
  }

  /**
   * Calculate weighted performance of the index
   * Normalizes to start at 100 and calculates percentage change
   */
  private calculateWeightedPerformance(
    assetData: { asset: IndexAsset; data: OHLCV[] }[],
    timestamps: number[]
  ): IndexPerformancePoint[] {
    // Create maps for quick lookup
    const assetMaps = assetData.map(({ asset, data }) => ({
      asset,
      dataMap: new Map(data.map((candle) => [candle.timestamp, candle])),
    }));

    // Get starting prices for each asset (used to normalize)
    const startTimestamp = timestamps[0];
    const startPrices: Map<string, number> = new Map();

    for (const { asset, dataMap } of assetMaps) {
      const startCandle = dataMap.get(startTimestamp);
      if (startCandle) {
        startPrices.set(asset.symbol, startCandle.close);
      }
    }

    // Calculate index value for each timestamp
    const performance: IndexPerformancePoint[] = [];

    for (const timestamp of timestamps) {
      let indexValue = 0;

      for (const { asset, dataMap } of assetMaps) {
        const candle = dataMap.get(timestamp);
        const startPrice = startPrices.get(asset.symbol);

        if (candle && startPrice) {
          // Calculate normalized price (as percentage of starting price)
          const normalizedPrice = (candle.close / startPrice) * 100;
          // Weight it according to the asset's weight in the index
          indexValue += normalizedPrice * (asset.weight / 100);
        }
      }

      // Calculate percentage change from start (which was 100)
      const change = indexValue - 100;

      performance.push({
        timestamp,
        value: indexValue,
        change,
      });
    }

    return performance;
  }

  /**
   * Calculate performance data for benchmark assets
   * Compares BTC, ETH, SOL performance over the same time period
   */
  private async calculateBenchmarks(
    exchange: SupportedExchange,
    timeframe: Timeframe,
    timestamps: number[],
    limit: number
  ): Promise<BenchmarkPerformance[]> {
    const benchmarkPromises = BENCHMARK_SYMBOLS.map(async ({ symbol, name }) => {
      try {
        const data = await ccxtService.fetchOHLCV(exchange, symbol, timeframe, 'spot', limit);

        // Create map for quick lookup
        const dataMap = new Map(data.map((candle) => [candle.timestamp, candle]));

        // Get starting price
        const startCandle = dataMap.get(timestamps[0]);
        if (!startCandle) {
          return null;
        }

        const startPrice = startCandle.close;

        // Calculate performance for each timestamp
        const performanceData: IndexPerformancePoint[] = [];

        for (const timestamp of timestamps) {
          const candle = dataMap.get(timestamp);
          if (candle) {
            const value = (candle.close / startPrice) * 100;
            const change = value - 100;

            performanceData.push({
              timestamp,
              value,
              change,
            });
          }
        }

        return {
          symbol,
          name,
          data: performanceData,
        };
      } catch (error) {
        console.error(`Error fetching benchmark ${symbol}:`, error);
        return null;
      }
    });

    const results = await Promise.all(benchmarkPromises);
    return results.filter((r): r is BenchmarkPerformance => r !== null);
  }
}

// Export singleton instance
export const customIndexService = new CustomIndexService();
